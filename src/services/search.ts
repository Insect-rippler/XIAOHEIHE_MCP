/** Three search modes: keyword, random browsing, and direct link lookup. */
import type { FeedLink, XhhClient } from "../client/xhh.js";
import { parseRichText, postUrl, resolvePostId, stripHtml, type PostBrief } from "./post.js";

type SearchItem = { type?: string; info?: Record<string, unknown> };

function tagNames(source: unknown): string[] {
  if (!Array.isArray(source)) return [];
  const names: string[] = [];
  for (const entry of source) {
    if (typeof entry === "string") names.push(stripHtml(entry));
    else if (entry && typeof entry === "object") {
      const tag = entry as { name?: string; text?: string };
      const name = tag.name ?? tag.text;
      if (name) names.push(stripHtml(name));
    }
  }
  return [...new Set(names.filter(Boolean))];
}

function briefFromFeed(link: FeedLink, source: PostBrief["source"]): PostBrief {
  const rich = parseRichText(link.text);
  const postId = String(link.linkid ?? link.link_id ?? "");
  return {
    postId,
    title: stripHtml(String(link.title ?? "")),
    author: link.user?.username ?? "",
    authorId: String(link.user?.userid ?? ""),
    textPreview: (rich.text || stripHtml(String(link.description ?? ""))).slice(0, 200),
    images: [...new Set([...(link.imgs ?? []), ...rich.images])].slice(0, 9),
    tags: tagNames(link.hashtags),
    stats: { likes: Number(link.up ?? 0), comments: Number(link.comment_num ?? 0) },
    createdAt: Number(link.create_at ?? 0),
    url: postId ? postUrl(postId) : "",
    source,
  };
}

function briefFromSearchItem(item: SearchItem): PostBrief | null {
  if (item.type !== "link") return null;
  const info = (item.info ?? {}) as Record<string, unknown>;
  const postId = String(info.linkid ?? info.link_id ?? "");
  if (!postId) return null;
  const user = (info.user ?? {}) as { username?: string; userid?: string | number };
  return {
    postId,
    title: stripHtml(String(info.title ?? "")),
    author: user.username ?? "",
    authorId: String(user.userid ?? info.userid ?? ""),
    textPreview: stripHtml(String(info.description ?? "")).slice(0, 200),
    images: Array.isArray(info.imgs) ? (info.imgs as string[]).slice(0, 9) : [],
    tags: tagNames(info.hashtags ?? info.topics),
    stats: { likes: Number(info.up ?? 0), comments: Number(info.comment_num ?? 0) },
    createdAt: Number(info.create_at ?? 0),
    url: postUrl(postId),
    source: "search",
  };
}

/** Keyword search over the site's general search endpoint. */
export async function searchByKeyword(
  client: XhhClient,
  options: { keyword: string; offset?: number; limit?: number },
): Promise<PostBrief[]> {
  const wanted = options.limit ?? 10;
  // Results mix links, topics and mini-apps, so over-fetch before filtering.
  const response = await client.searchGeneral({
    keyword: options.keyword,
    offset: options.offset ?? 0,
    limit: Math.min(50, Math.max(20, wanted * 3)),
  });
  const items = (response.result?.items ?? []) as SearchItem[];
  return items
    .map(briefFromSearchItem)
    .filter((item): item is PostBrief => item !== null)
    .slice(0, wanted);
}

/** Random browsing: pool a few feed pages, dedupe, shuffle, take `limit`. */
export async function searchRandom(client: XhhClient, options: { limit?: number; batches?: number } = {}): Promise<PostBrief[]> {
  const limit = options.limit ?? 10;
  const offsets = [0, 20, 40, 60].slice(0, Math.max(1, options.batches ?? 3));
  const settled = await Promise.allSettled(offsets.map((offset) => client.listFeeds({ offset, limit: 20 })));

  const pool = new Map<string, PostBrief>();
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const link of result.value.result?.links ?? []) {
      const brief = briefFromFeed(link, "feed");
      if (brief.postId && !pool.has(brief.postId)) pool.set(brief.postId, brief);
    }
  }

  const all = [...pool.values()];
  for (let i = all.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j]!, all[i]!];
  }
  return all.slice(0, limit);
}

/** Direct link lookup: accepts a post URL, a `link_id` query or a bare id. */
export async function searchByLink(client: XhhClient, input: string): Promise<PostBrief | null> {
  const postId = resolvePostId(input);
  if (!postId) return null;
  const response = await client.getLinkTree({ linkId: postId });
  const link = response.result?.link;
  if (!link) return null;
  return briefFromFeed(link, "link");
}
