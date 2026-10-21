/** Comment normalization and weighted selection used by `get_post_context`. */
import { stripHtml } from "./post.js";

export interface RawComment {
  commentid?: number | string;
  userid?: number | string;
  create_at?: number;
  text?: string;
  up?: number;
  child_num?: number;
  floor_num?: number;
  is_cy?: number;
  is_meaningless?: number;
  is_link_owner?: number;
  user?: { username?: string; userid?: string };
}

export interface CommentItem {
  commentId: string;
  author: string;
  authorId: string;
  text: string;
  likeCount: number;
  createdAt: number;
  floor: number;
  isAuthor: boolean;
  replyCount: number;
}

export interface SelectionWeights {
  like: number;
  time: number;
  /** RRF smoothing constant; higher flattens the ranking. */
  k: number;
}

export const DEFAULT_WEIGHTS: SelectionWeights = { like: 0.6, time: 0.4, k: 10 };

/** Flatten `result.comments` groups (`[{ comment: [...] }]`) into comment items. */
export function normalizeComments(groups: unknown): CommentItem[] {
  if (!Array.isArray(groups)) return [];
  const items: CommentItem[] = [];
  for (const group of groups) {
    if (!group) continue;
    const container = group as { comment?: unknown; comments?: unknown };
    const list = Array.isArray(container.comment)
      ? container.comment
      : Array.isArray(container.comments)
        ? container.comments
        : Array.isArray(group)
          ? group
          : [group];
    for (const entry of list) {
      const comment = entry as RawComment;
      if (!comment || comment.commentid === undefined) continue;
      if (comment.is_cy === 1 || comment.is_meaningless === 1) continue;
      const text = stripHtml(String(comment.text ?? ""));
      if (text.length < 2) continue;
      items.push({
        commentId: String(comment.commentid),
        author: comment.user?.username ?? "",
        authorId: String(comment.userid ?? comment.user?.userid ?? ""),
        text,
        likeCount: Number(comment.up ?? 0),
        createdAt: Number(comment.create_at ?? 0),
        floor: Number(comment.floor_num ?? 0),
        isAuthor: comment.is_link_owner === 1,
        replyCount: Number(comment.child_num ?? 0),
      });
    }
  }
  return items;
}

interface Ranked extends CommentItem {
  score: number;
}

/**
 * Rank by likes and by recency separately, then fuse with reciprocal-rank fusion.
 * Ties fall back to the other dimension so a zero-like fresh comment still competes.
 */
export function selectTopComments(
  comments: CommentItem[],
  options: { limit?: number; weights?: Partial<SelectionWeights> } = {},
): { selected: CommentItem[]; meta: { considered: number; selected: number; weights: SelectionWeights } } {
  const limit = options.limit ?? 20;
  const weights: SelectionWeights = { ...DEFAULT_WEIGHTS, ...options.weights };
  if (comments.length === 0) {
    return { selected: [], meta: { considered: 0, selected: 0, weights } };
  }

  const byLikes = [...comments].sort((a, b) => b.likeCount - a.likeCount || b.createdAt - a.createdAt);
  const byTime = [...comments].sort((a, b) => b.createdAt - a.createdAt || b.likeCount - a.likeCount);
  const likeRank = new Map(byLikes.map((item, index) => [item.commentId, index]));
  const timeRank = new Map(byTime.map((item, index) => [item.commentId, index]));

  const ranked: Ranked[] = comments.map((item) => {
    const lr = likeRank.get(item.commentId) ?? comments.length;
    const tr = timeRank.get(item.commentId) ?? comments.length;
    const score = weights.like / (weights.k + lr) + weights.time / (weights.k + tr);
    return { ...item, score };
  });

  ranked.sort((a, b) => b.score - a.score);
  const selected = ranked.slice(0, limit).sort((a, b) => a.createdAt - b.createdAt);
  return {
    selected: selected.map(({ score, ...rest }) => rest),
    meta: { considered: comments.length, selected: selected.length, weights },
  };
}
