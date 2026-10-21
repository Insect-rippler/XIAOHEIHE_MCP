/** Write actions: comment, reply, with dry-run and throttling. */
import { XhhError } from "../client/errors.js";
import type { XhhClient } from "../client/xhh.js";
import { normalizeComments } from "./comments.js";
import { writeLimiter, type ActionLimiter } from "./ratelimit.js";

export interface WriteResult {
  ok: boolean;
  dryRun: boolean;
  commentId?: string;
  floor?: number;
  target?: { commentId: string; author: string; text: string };
  request?: Record<string, string | number>;
}

export interface CommentTarget {
  commentId: string;
  rootId: string;
  author: string;
  text: string;
}

/** Find a main comment whose text contains `needle` (first page by default). */
export async function findCommentByText(
  client: XhhClient,
  options: { postId: string; needle: string; pages?: number },
): Promise<CommentTarget | null> {
  const needle = options.needle.trim();
  if (!needle) return null;
  const pages = options.pages ?? 1;
  for (let page = 1; page <= pages; page += 1) {
    const response = await client.getLinkTree({ linkId: options.postId, page });
    const groups = response.result?.comments ?? [];
    if (groups.length === 0) return null;
    const match = normalizeComments(groups).find((comment) => comment.text.includes(needle));
    if (match) {
      return { commentId: match.commentId, rootId: match.commentId, author: match.author, text: match.text };
    }
  }
  return null;
}

function checkText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new XhhError("config", "评论内容不能为空");
  if (trimmed.length > 2000) throw new XhhError("content_rejected", "评论内容超过 2000 字");
  return trimmed;
}

/** Publish a top-level comment on a post. */
export async function createComment(
  client: XhhClient,
  options: { postId: string; text: string; dryRun?: boolean; limiter?: ActionLimiter },
): Promise<WriteResult> {
  const text = checkText(options.text);
  const request = { link_id: options.postId, reply_id: -1, root_id: -1, text };
  if (options.dryRun) return { ok: true, dryRun: true, request };

  const limiter = options.limiter ?? writeLimiter;
  limiter.assertAllowed("comment");
  const response = await client.createComment({ linkId: options.postId, text });
  limiter.record("comment");

  return {
    ok: true,
    dryRun: false,
    commentId: response.commentid === undefined ? undefined : String(response.commentid),
    floor: response.floor,
  };
}

/** Reply to a comment, located either by id or by a text fragment. */export async function replyToComment(
  client: XhhClient,
  options: {
    postId: string;
    text: string;
    commentId?: string;
    targetText?: string;
    dryRun?: boolean;
    limiter?: ActionLimiter;
  },
): Promise<WriteResult> {
  const text = checkText(options.text);
  let target: CommentTarget | null = null;

  if (options.commentId) {
    target = { commentId: options.commentId, rootId: options.commentId, author: "", text: "" };
  } else if (options.targetText) {
    target = await findCommentByText(client, { postId: options.postId, needle: options.targetText });
    if (!target) throw new XhhError("not_found", `没有找到包含「${options.targetText}」的评论`);
  } else {
    throw new XhhError("config", "需要 commentId 或 targetText 之一");
  }

  const request = { link_id: options.postId, reply_id: target.commentId, root_id: target.rootId, text };
  if (options.dryRun) {
    return { ok: true, dryRun: true, target: { commentId: target.commentId, author: target.author, text: target.text }, request };
  }

  const limiter = options.limiter ?? writeLimiter;
  limiter.assertAllowed("reply");
  const response = await client.createComment({
    linkId: options.postId,
    text,
    replyId: target.commentId,
    rootId: target.rootId,
  });
  limiter.record("reply");

  return {
    ok: true,
    dryRun: false,
    commentId: response.commentid === undefined ? undefined : String(response.commentid),
    floor: response.floor,
    target: { commentId: target.commentId, author: target.author, text: target.text },
  };
}

/** Like or un-like a comment (`support_type` 1 / 0). */
export async function likeComment(
  client: XhhClient,
  options: { commentId: string; undo?: boolean; limiter?: ActionLimiter },
): Promise<{ ok: boolean; commentId: string; supportType: 0 | 1 }> {
  const supportType: 0 | 1 = options.undo ? 0 : 1;
  const limiter = options.limiter ?? writeLimiter;
  limiter.assertAllowed("like");
  await client.supportComment({ commentId: options.commentId, supportType });
  limiter.record("like");
  return { ok: true, commentId: options.commentId, supportType };
}
