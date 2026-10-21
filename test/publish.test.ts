import { afterEach, describe, expect, it, vi } from "vitest";
import type { XhhClient } from "../src/client/xhh.js";
import { XhhError } from "../src/client/errors.js";
import { publishImageText } from "../src/services/publish.js";
import { cosAuthorization } from "../src/services/upload.js";
import { assertNotChallenged, captchaError, noteCaptcha, resetCaptcha } from "../src/services/captcha.js";

function fakeClient(overrides: Partial<Record<keyof XhhClient, unknown>> = {}): XhhClient {
  return {
    searchEditorTopics: async () => ({ result: { search_result: [{ name: "盒友杂谈", topic_id: 7214 }] } }),
    listEditorTopics: async () => ({
      result: { topic_list: [{ name: "盒友杂谈", topic_id: 7214 }, { name: "数码硬件", topic_id: 18745 }] },
    }),
    publishPost: vi.fn(async () => ({ status: "ok", link_id: 194357012 })),
    http: {},
    ...overrides,
  } as unknown as XhhClient;
}

describe("publishImageText", () => {
  it("dry run builds the form with topic ids and text segments", async () => {
    const result = await publishImageText(fakeClient(), {
      title: "测试标题",
      content: "正文内容",
      topicIds: [7214],
      dryRun: true,
    });
    expect(result.dryRun).toBe(true);
    expect(result.request?.topic_ids).toBe("7214");
    expect(String(result.request?.text)).toContain('"type":"text"');
    expect(result.request?.title).toBe("测试标题");
  });

  it("resolves a community name to its topic id", async () => {
    const result = await publishImageText(fakeClient(), {
      title: "测试",
      content: "正文",
      community: "盒友杂谈",
      dryRun: true,
    });
    expect(result.request?.topic_ids).toBe("7214");
  });

  it("rejects an unknown community with the available names", async () => {
    await expect(
      publishImageText(fakeClient(), { title: "t", content: "c", community: "不存在的社区", dryRun: true }),
    ).rejects.toMatchObject({ kind: "config" });
  });

  it("resolves a community through the search endpoint", async () => {
    const searched = vi.fn(async () => ({ result: { search_result: [{ name: "盒友杂谈", topic_id: 7214 }] } }));
    const client = fakeClient({ searchEditorTopics: searched, listEditorTopics: async () => ({ result: {} }) });
    const result = await publishImageText(client, { title: "t", content: "c", community: "盒友杂谈", dryRun: true });
    expect(result.request?.topic_ids).toBe("7214");
    expect(searched).toHaveBeenCalledOnce();
  });

  it("does not silently pick a fuzzy match", async () => {
    const client = fakeClient({
      searchEditorTopics: async () => ({ result: { search_result: [{ name: "盒友杂谈", topic_id: 7214 }] } }),
      listEditorTopics: async () => ({ result: {} }),
    });
    await expect(
      publishImageText(client, { title: "t", content: "c", community: "盒友", dryRun: true }),
    ).rejects.toMatchObject({ kind: "config" });
  });

  it("requires a community or topic ids", async () => {
    await expect(publishImageText(fakeClient(), { title: "t", content: "c", dryRun: true })).rejects.toBeInstanceOf(
      XhhError,
    );
  });

  it("rejects titles over 30 characters", async () => {
    await expect(
      publishImageText(fakeClient(), { title: "x".repeat(31), content: "c", topicIds: [1], dryRun: true }),
    ).rejects.toMatchObject({ kind: "content_rejected" });
  });

  it("returns the post id and url when publishing", async () => {
    const result = await publishImageText(fakeClient(), { title: "t", content: "c", topicIds: [7214] });
    expect(result.postId).toBe("194357012");
    expect(result.url).toContain("/bbs/link/194357012");
  });
});

describe("cosAuthorization", () => {
  const base = {
    secretId: "AKIDtest",
    secretKey: "secret",
    method: "PUT",
    pathname: "/web/bbs/a.png",
    host: "bucket.cos.ap-shanghai.myqcloud.com",
    signTime: "1700000000;1700000600",
  };

  it("is deterministic for fixed inputs", () => {
    expect(cosAuthorization(base)).toBe(cosAuthorization(base));
  });

  it("changes when the secret changes", () => {
    expect(cosAuthorization(base)).not.toBe(cosAuthorization({ ...base, secretKey: "other" }));
  });

  it("includes the required signature fields", () => {
    const value = cosAuthorization(base);
    expect(value).toContain("q-sign-algorithm=sha1");
    expect(value).toContain("q-ak=AKIDtest");
    expect(value).toContain("q-header-list=host");
    expect(value).toMatch(/q-signature=[0-9a-f]{40}$/);
  });
});

describe("captcha breaker", () => {
  afterEach(() => resetCaptcha());

  it("blocks calls after a challenge and recovers after reset", () => {
    resetCaptcha();
    expect(() => assertNotChallenged()).not.toThrow();
    noteCaptcha();
    expect(() => assertNotChallenged()).toThrow(/人机验证/);
    resetCaptcha();
    expect(() => assertNotChallenged()).not.toThrow();
  });

  it("returns retryAfterSeconds and a hint while cooling down", () => {
    resetCaptcha();
    noteCaptcha();
    try {
      assertNotChallenged();
      throw new Error("expected throw");
    } catch (error) {
      const xhh = error as XhhError;
      expect(xhh.kind).toBe("captcha_required");
      expect(xhh.retryable).toBe(true);
      expect(xhh.details?.retryAfterSeconds).toBeGreaterThan(0);
      expect(String(xhh.details?.hint)).toContain("浏览器");
    }
    resetCaptcha();
  });

  it("describes the upstream show_captcha rejection", () => {
    const error = captchaError();
    expect(error.kind).toBe("captcha_required");
    expect(error.message).toContain("show_captcha");
    expect(error.details?.upstreamStatus).toBe("show_captcha");
    expect(error.toJSON().details?.hint).toContain("降低请求频率");
  });
});
