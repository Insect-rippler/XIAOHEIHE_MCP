/** Publish an image-text post entirely over HTTP (upload + link/post). */
import { XhhError } from "../client/errors.js";
import type { XhhClient } from "../client/xhh.js";
import { postUrl } from "./post.js";
import { uploadImage, type UploadedImage } from "./upload.js";
export interface PublishOptions {
  title: string;
  content: string;
  images?: string[];
  topicIds?: number[];
  community?: string;
  dryRun?: boolean;
}

export interface PublishResult {
  ok: boolean;
  dryRun: boolean;
  postId?: string;
  url?: string;
  uploaded?: string[];
  request?: Record<string, string | number>;
}

const TITLE_LIMIT = 30;

async function resolveTopicIds(
  client: XhhClient,
  options: { topicIds?: number[]; community?: string },
): Promise<number[]> {
  if (options.topicIds?.length) return options.topicIds;
  if (!options.community) return [];

  const target = options.community.trim();

  // The editor's search endpoint resolves any community name, not just the recommended few.
  // Only an exact name match is accepted: a fuzzy hit could publish to the wrong community.
  const search = await client.searchEditorTopics(target);
  const hits = search.result?.search_result ?? [];
  const exact = hits.find((topic) => (topic.name ?? "").trim() === target);
  if (exact?.topic_id) return [exact.topic_id];

  const list = (await client.listEditorTopics()).result?.topic_list ?? [];
  const fallback = list.find((topic) => (topic.name ?? "").trim() === target);
  if (fallback?.topic_id) return [fallback.topic_id];

  const available = hits
    .slice(0, 8)
    .map((topic) => topic.name)
    .filter(Boolean)
    .join("、");
  throw new XhhError(
    "config",
    `社区「${options.community}」没有匹配到。${available ? `相近结果：${available}。` : ""}请改用更准确的名称，或直接传 topicIds`,
  );
}

/** Publish one image-text post. Images are uploaded first, then the post is created. */
export async function publishImageText(client: XhhClient, options: PublishOptions): Promise<PublishResult> {
  const title = options.title.trim();
  const content = options.content.trim();
  if (!title) throw new XhhError("config", "标题不能为空");
  if (title.length > TITLE_LIMIT) throw new XhhError("content_rejected", `标题最多 ${TITLE_LIMIT} 字`);
  if (!content && !options.images?.length) throw new XhhError("config", "正文和图片不能同时为空");

  const topicIds = await resolveTopicIds(client, options);
  if (topicIds.length === 0) {
    throw new XhhError("config", "需要指定社区（community 或 topicIds），否则无法发布");
  }

  const uploaded: UploadedImage[] = [];
  if (!options.dryRun) {
    for (const imagePath of options.images ?? []) {
      uploaded.push(await uploadImage(client.http, imagePath));
    }
  }

  const segments: Array<Record<string, string | number>> = [];
  if (content) segments.push({ type: "text", text: content });
  for (const image of uploaded) {
    segments.push({ type: "img", url: image.url, width: image.width, height: image.height });
  }

  const form: Record<string, string | number> = {
    link_tag: 27,
    text: JSON.stringify(segments),
    title,
    desc: content.slice(0, 100),
    words_count: content.length,
    topic_ids: topicIds.join(","),
    hashtags: "[]",
    schedule_ts: 0,
    view_limit: 1,
    post_type: 1,
    original: 1,
    declaration: 0,
  };

  if (options.dryRun) {
    return { ok: true, dryRun: true, uploaded: options.images ?? [], request: form };
  }

  const response = await client.publishPost(form);
  const postId = response.link_id === undefined ? undefined : String(response.link_id);
  return {
    ok: true,
    dryRun: false,
    postId,
    url: postId ? postUrl(postId) : undefined,
    uploaded: uploaded.map((image) => image.url),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Convert plain paragraphs into the article editor's HTML segment format. */
export function paragraphsToHtml(content: string): string {
  const blocks = content
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (blocks.length === 0) return "";
  return blocks.map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`).join("");
}

export interface ArticleOptions {
  title: string;
  content: string;
  images?: string[];
  topicIds?: number[];
  community?: string;
  dryRun?: boolean;
}

const ARTICLE_TITLE_LIMIT = 60;

/** Publish a long-form article (`link_tag=11`, HTML body). */
export async function publishArticle(client: XhhClient, options: ArticleOptions): Promise<PublishResult> {
  const title = options.title.trim();
  const content = options.content.trim();
  if (!title) throw new XhhError("config", "标题不能为空");
  if (title.length > ARTICLE_TITLE_LIMIT) {
    throw new XhhError("content_rejected", `文章标题最多 ${ARTICLE_TITLE_LIMIT} 字`);
  }
  if (!content) throw new XhhError("config", "文章正文不能为空");

  const topicIds = await resolveTopicIds(client, options);
  if (topicIds.length === 0) {
    throw new XhhError("config", "需要指定社区（community 或 topicIds），否则无法发布");
  }

  const uploaded: UploadedImage[] = [];
  if (!options.dryRun) {
    for (const imagePath of options.images ?? []) {
      uploaded.push(await uploadImage(client.http, imagePath));
    }
  }

  const imagesHtml = uploaded
    .map((image) => `<p><img src="${image.url}" width="${image.width}" height="${image.height}"></p>`)
    .join("");
  const html = paragraphsToHtml(content) + imagesHtml;

  const form: Record<string, string | number> = {
    link_tag: 11,
    text: JSON.stringify([{ type: "html", text: html }]),
    title,
    desc: content.replace(/\s+/g, " ").slice(0, 100),
    words_count: content.length,
    topic_ids: topicIds.join(","),
    hashtags: "[]",
    schedule_ts: 0,
    view_limit: 1,
    post_type: 1,
    original: 1,
    declaration: 0,
  };

  if (options.dryRun) {
    return { ok: true, dryRun: true, uploaded: options.images ?? [], request: form };
  }

  const response = await client.publishPost(form);
  const postId = response.link_id === undefined ? undefined : String(response.link_id);
  return {
    ok: true,
    dryRun: false,
    postId,
    url: postId ? postUrl(postId) : undefined,
    uploaded: uploaded.map((image) => image.url),
  };
}
