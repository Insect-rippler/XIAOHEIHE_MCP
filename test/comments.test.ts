import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeComments, selectTopComments } from "../src/services/comments.js";
import { parseRichText, resolvePostId, stripHtml } from "../src/services/post.js";

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), "test/fixtures/link-tree-193565384.json"), "utf8"),
) as Array<{ result?: { comments?: unknown[]; link?: Record<string, unknown> } }>;

const groups = fixture.flatMap((page) => page.result?.comments ?? []);
const comments = normalizeComments(groups);

describe("normalizeComments", () => {
  it("flattens every page into unique comment items", () => {
    expect(comments.length).toBeGreaterThan(30);
    const ids = new Set(comments.map((comment) => comment.commentId));
    expect(ids.size).toBe(comments.length);
  });

  it("drops empty text and keeps author/likes/time", () => {
    for (const comment of comments) {
      expect(comment.text.length).toBeGreaterThanOrEqual(2);
      expect(comment.commentId).not.toBe("");
      expect(Number.isFinite(comment.likeCount)).toBe(true);
    }
  });

  it("returns an empty list for malformed input", () => {
    expect(normalizeComments(null)).toEqual([]);
    expect(normalizeComments([null, {}])).toEqual([]);
  });
});

describe("selectTopComments", () => {
  it("returns at most the requested number, ordered by time ascending", () => {
    const { selected, meta } = selectTopComments(comments, { limit: 20 });
    expect(selected.length).toBe(20);
    expect(meta.considered).toBe(comments.length);
    for (let i = 1; i < selected.length; i += 1) {
      expect(selected[i]!.createdAt).toBeGreaterThanOrEqual(selected[i - 1]!.createdAt);
    }
  });

  it("keeps the most-liked comment and a recent one", () => {
    const { selected } = selectTopComments(comments, { limit: 20 });
    const mostLiked = [...comments].sort((a, b) => b.likeCount - a.likeCount)[0]!;
    const newest = [...comments].sort((a, b) => b.createdAt - a.createdAt)[0]!;
    const ids = new Set(selected.map((comment) => comment.commentId));
    expect(ids.has(mostLiked.commentId)).toBe(true);
    expect(ids.has(newest.commentId)).toBe(true);
  });

  it("respects custom weights and reports them in meta", () => {
    const { meta } = selectTopComments(comments, { limit: 5, weights: { like: 0.9, time: 0.1 } });
    expect(meta.weights).toEqual({ like: 0.9, time: 0.1, k: 10 });
  });

  it("handles an empty input", () => {
    const { selected, meta } = selectTopComments([]);
    expect(selected).toEqual([]);
    expect(meta.selected).toBe(0);
  });
});

describe("post helpers", () => {
  it("resolves ids from urls, query strings and bare ids", () => {
    expect(resolvePostId("https://www.xiaoheihe.cn/app/bbs/link/193565384")).toBe("193565384");
    expect(resolvePostId("https://x.cn/x?link_id=42")).toBe("42");
    expect(resolvePostId(" 123 ")).toBe("123");
    expect(resolvePostId("no-id")).toBeNull();
  });

  it("strips html and decodes entities", () => {
    expect(stripHtml("<p>a &amp; b</p><br/>c")).toBe("a & b\nc");
  });

  it("parses rich text json segments", () => {
    const raw = JSON.stringify([
      { type: "text", text: "hello" },
      { type: "img", url: "https://img/1.png" },
      { type: "html", text: "<p>world</p>" },
    ]);
    const parsed = parseRichText(raw);
    expect(parsed.text).toContain("hello");
    expect(parsed.text).toContain("world");
    expect(parsed.images).toContain("https://img/1.png");
  });

  it("falls back to plain text for non-json input", () => {
    expect(parseRichText("plain <b>text</b>").text).toBe("plain text");
    expect(parseRichText("").text).toBe("");
  });
});
