/** Assemble a post plus its highest-signal comments for downstream use. */
import type { XhhClient } from "../client/xhh.js";
import { normalizeComments, selectTopComments, type CommentItem, type SelectionWeights } from "./comments.js";
import { parseRichText, postUrl, stripHtml } from "./post.js";

export interface PostContext {
  post: {
    postId: string;
    title: string;
    author: string;
    authorId: string;
    text: string;
    images: string[];
    tags: string[];
    stats: { likes: number; comments: number };
    createdAt: number;
    ipLocation: string;
    isArticle: boolean;
    url: string;
  };
  comments: CommentItem[];
  meta: {
    fetchedPages: number;
    totalPage: number;
    considered: number;
    selected: number;
    weights: SelectionWeights;
  };
}

function namesOf(source: unknown): string[] {
  if (!Array.isArray(source)) return [];
  return source
    .map((entry) =>
      typeof entry === "string" ? entry : stripHtml(String((entry as { name?: string; text?: string })?.name ?? (entry as { text?: string })?.text ?? "")),
    )
    .filter(Boolean);
}

/** Fetch up to `pages` comment pages, then keep the weighted top `limit`. */
export async function buildPostContext(
  client: XhhClient,
  options: { postId: string; pages?: number; limit?: number; weights?: Partial<SelectionWeights> },
): Promise<PostContext | null> {
  const maxPages = options.pages ?? 3;
  const first = await client.getLinkTree({ linkId: options.postId, page: 1 });
  const link = first.result?.link;
  if (!link) return null;

  const groups: unknown[] = [...(first.result?.comments ?? [])];
  const totalPage = Number((first.result as { total_page?: number } | undefined)?.total_page ?? 1);
  let fetchedPages = 1;

  while (fetchedPages < maxPages && fetchedPages < totalPage) {
    const nextPage = fetchedPages + 1;
    const next = await client.getLinkTree({ linkId: options.postId, page: nextPage });
    const nextGroups = next.result?.comments ?? [];
    if (nextGroups.length === 0) break;
    groups.push(...nextGroups);
    fetchedPages = nextPage;
  }

  const normalized = normalizeComments(groups);
  const { selected, meta } = selectTopComments(normalized, { limit: options.limit ?? 20, weights: options.weights });
  const rich = parseRichText(link.text);
  const postId = String(link.linkid ?? link.link_id ?? options.postId);

  return {
    post: {
      postId,
      title: stripHtml(String(link.title ?? "")),
      author: link.user?.username ?? "",
      authorId: String(link.user?.userid ?? ""),
      text: rich.text || stripHtml(String(link.description ?? "")),
      images: [...new Set([...(link.imgs ?? []), ...rich.images])],
      tags: namesOf(link.hashtags ?? link.topics),
      stats: { likes: Number(link.up ?? 0), comments: Number(link.comment_num ?? 0) },
      createdAt: Number(link.create_at ?? 0),
      ipLocation: String(link.ip_location ?? ""),
      isArticle: Boolean(link.is_article),
      url: postUrl(postId),
    },
    comments: selected,
    meta: { fetchedPages, totalPage, ...meta },
  };
}
