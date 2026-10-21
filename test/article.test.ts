import { describe, expect, it, vi } from "vitest";
import type { XhhClient } from "../src/client/xhh.js";
import { paragraphsToHtml, publishArticle } from "../src/services/publish.js";

function fakeClient(): XhhClient {
  return {
    searchEditorTopics: async () => ({ result: { search_result: [{ name: "盒友杂谈", topic_id: 7214 }] } }),
    listEditorTopics: async () => ({ result: { topic_list: [{ name: "盒友杂谈", topic_id: 7214 }] } }),
    publishPost: vi.fn(async () => ({ status: "ok", link_id: 194357400 })),
    http: {},
  } as unknown as XhhClient;
}

describe("paragraphsToHtml", () => {
  it("splits on blank lines and wraps each block", () => {
    expect(paragraphsToHtml("第一段\n\n第二段")).toBe("<p>第一段</p><p>第二段</p>");
  });

  it("escapes html and keeps single newlines as breaks", () => {
    expect(paragraphsToHtml("a<b\nc")).toBe("<p>a&lt;b<br>c</p>");
  });

  it("returns an empty string for blank input", () => {
    expect(paragraphsToHtml("   \n\n  ")).toBe("");
  });
});

describe("publishArticle", () => {
  it("dry run builds an article payload with link_tag 11 and html segments", async () => {
    const result = await publishArticle(fakeClient(), {
      title: "标题",
      content: "第一段\n\n第二段",
      topicIds: [7214],
      dryRun: true,
    });
    expect(result.dryRun).toBe(true);
    expect(result.request?.link_tag).toBe(11);
    const text = JSON.parse(String(result.request?.text)) as Array<{ type: string; text: string }>;
    expect(text[0]?.type).toBe("html");
    expect(text[0]?.text).toContain("<p>第一段</p>");
    expect(result.request?.topic_ids).toBe("7214");
  });

  it("resolves the community name", async () => {
    const result = await publishArticle(fakeClient(), {
      title: "标题",
      content: "正文",
      community: "盒友杂谈",
      dryRun: true,
    });
    expect(result.request?.topic_ids).toBe("7214");
  });

  it("rejects titles over 60 characters", async () => {
    await expect(
      publishArticle(fakeClient(), { title: "x".repeat(61), content: "c", topicIds: [1], dryRun: true }),
    ).rejects.toMatchObject({ kind: "content_rejected" });
  });

  it("requires content", async () => {
    await expect(
      publishArticle(fakeClient(), { title: "t", content: "  ", topicIds: [1], dryRun: true }),
    ).rejects.toMatchObject({ kind: "config" });
  });

  it("returns the article id when publishing", async () => {
    const result = await publishArticle(fakeClient(), { title: "t", content: "c", topicIds: [7214] });
    expect(result.postId).toBe("194357400");
    expect(result.url).toContain("/bbs/link/194357400");
  });
});
