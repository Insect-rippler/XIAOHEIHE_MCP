import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { XhhError } from "../src/client/errors.js";
import type { XhhClient } from "../src/client/xhh.js";
import { findCommentByText, createComment, replyToComment } from "../src/services/actions.js";
import { ActionLimiter } from "../src/services/ratelimit.js";

const pages = JSON.parse(
  readFileSync(join(process.cwd(), "test/fixtures/link-tree-193565384.json"), "utf8"),
) as Array<{ result?: { comments?: unknown[] } }>;

function fakeClient(overrides: Partial<Record<keyof XhhClient, unknown>> = {}): XhhClient {
  return {
    getLinkTree: async ({ page = 1 }: { page?: number }) => pages[page - 1] ?? { result: { comments: [] } },
    createComment: vi.fn(async () => ({ status: "ok", commentid: 123456, floor: 42 })),
    ...overrides,
  } as unknown as XhhClient;
}

describe("findCommentByText", () => {
  it("finds a comment by text fragment", async () => {
    const target = await findCommentByText(fakeClient(), { postId: "1", needle: "博士在泰拉" });
    expect(target).not.toBeNull();
    expect(target!.commentId).toMatch(/^\d+$/);
    expect(target!.rootId).toBe(target!.commentId);
  });

  it("returns null for a missing fragment", async () => {
    const target = await findCommentByText(fakeClient(), { postId: "1", needle: "不存在的文本zzz" });
    expect(target).toBeNull();
  });
});

describe("createComment", () => {
  it("dry run returns the request without sending", async () => {
    const client = fakeClient();
    const result = await createComment(client, { postId: "42", text: "hi", dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.request).toMatchObject({ link_id: "42", reply_id: -1, root_id: -1, text: "hi" });
    expect(client.createComment).not.toHaveBeenCalled();
  });

  it("sends and returns the comment id", async () => {
    const client = fakeClient();
    const result = await createComment(client, { postId: "42", text: "hi", limiter: new ActionLimiter() });
    expect(result.commentId).toBe("123456");
    expect(result.floor).toBe(42);
    expect(client.createComment).toHaveBeenCalledOnce();
  });

  it("rejects empty text", async () => {
    await expect(createComment(fakeClient(), { postId: "42", text: "   " })).rejects.toBeInstanceOf(XhhError);
  });
});

describe("replyToComment", () => {
  it("resolves the target by text and dry-runs the reply", async () => {
    const client = fakeClient();
    const result = await replyToComment(client, {
      postId: "42",
      text: "reply",
      targetText: "博士在泰拉",
      dryRun: true,
    });
    expect(result.dryRun).toBe(true);
    expect(String(result.request?.reply_id)).toBe(result.target?.commentId);
    expect(client.createComment).not.toHaveBeenCalled();
  });

  it("requires an id or a text fragment", async () => {
    await expect(replyToComment(fakeClient(), { postId: "42", text: "x" })).rejects.toBeInstanceOf(XhhError);
  });

  it("surfaces a not_found error when text does not match", async () => {
    await expect(
      replyToComment(fakeClient(), { postId: "42", text: "x", targetText: "没有这条" }),
    ).rejects.toMatchObject({ kind: "not_found" });
  });
});

describe("ActionLimiter", () => {
  it("blocks a second action inside the minimum interval", () => {
    let now = 1_000_000;
    const limiter = new ActionLimiter({ minIntervalMs: 5000, maxPerHour: 10, now: () => now });
    limiter.assertAllowed("comment");
    limiter.record("comment");
    expect(() => limiter.assertAllowed("comment")).toThrow(/过于频繁/);
    now += 6000;
    expect(() => limiter.assertAllowed("comment")).not.toThrow();
  });

  it("enforces the hourly ceiling", () => {
    let now = 0;
    const limiter = new ActionLimiter({ minIntervalMs: 0, maxPerHour: 2, now: () => now });
    limiter.assertAllowed("x");
    limiter.record("x");
    limiter.assertAllowed("x");
    limiter.record("x");
    expect(() => limiter.assertAllowed("x")).toThrow(/上限/);
    now += 3_700_000;
    expect(() => limiter.assertAllowed("x")).not.toThrow();
  });
});
