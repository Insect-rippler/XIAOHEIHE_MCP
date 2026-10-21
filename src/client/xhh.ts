/** Domain calls for xiaoheihe: feeds, link detail, messages, comments. */
import type { XhhHttp } from "./http.js";

export interface FeedLink {
  linkid?: number | string;
  link_id?: number | string;
  title?: string;
  description?: string;
  text?: string;
  imgs?: string[];
  up?: number;
  comment_num?: number;
  create_at?: number;
  user?: { username?: string; userid?: string; [key: string]: unknown };
  hashtags?: Array<string | { text?: string; name?: string }>;
  [key: string]: unknown;
}

export interface FeedsResponse {
  status: string;
  result?: { links?: FeedLink[]; [key: string]: unknown };
}

export interface LinkTreeResponse {
  status: string;
  result?: { link?: FeedLink; comments?: unknown[]; [key: string]: unknown };
}

export interface MessageResponse {
  status: string;
  result?: { messages?: Array<Record<string, unknown>> };
}

export interface CommentCreateResponse {
  status: string;
  commentid?: number | string;
  floor?: number;
  msg?: string;
  result?: Record<string, unknown>;
}

export interface SearchResponse {
  status: string;
  result?: {
    items?: Array<{ type?: string; info?: Record<string, unknown> }>;
    [key: string]: unknown;
  };
}

export interface SessionInfo {
  loggedIn: boolean;
  heyboxId: string;
}

/** Stateless facade over the signed transport. */
export class XhhClient {
  constructor(readonly http: XhhHttp) {}

  get heyboxId(): string {
    return this.http.heyboxId;
  }

  /** Cheapest authenticated call: one message row. Throws `not_logged_in` when the cookie is stale. */
  async session(): Promise<SessionInfo> {
    await this.http.get<MessageResponse>("/bbs/app/user/message", {
      query: { list_type: 0, offset: 0, limit: 1, no_more: "false" },
    });
    return { loggedIn: true, heyboxId: this.http.heyboxId };
  }

  listFeeds(options: { offset?: number; pull?: number; limit?: number } = {}): Promise<FeedsResponse> {
    return this.http.get<FeedsResponse>("/bbs/app/feeds", {
      query: {
        offset: options.offset ?? 0,
        pull: options.pull ?? 0,
        limit: options.limit ?? 20,
      },
    });
  }

  getLinkTree(options: { linkId: string | number; page?: number; limit?: number; isFirst?: boolean }): Promise<LinkTreeResponse> {
    const page = options.page ?? 1;
    const isFirst = options.isFirst ?? page === 1;
    return this.http.get<LinkTreeResponse>("/bbs/app/link/tree", {
      insertHSrc: true,
      query: {
        link_id: String(options.linkId),
        is_first: isFirst ? "1" : "0",
        page: page,
        index: 1,
        limit: options.limit ?? 20,
        owner_only: 0,
      },
    });
  }

  listMessages(options: { listType?: number; offset?: number; limit?: number; messageType?: number } = {}): Promise<MessageResponse> {
    return this.http.get<MessageResponse>("/bbs/app/user/message", {
      query: {
        list_type: options.listType ?? 0,
        offset: options.offset ?? 0,
        limit: options.limit ?? 20,
        no_more: "false",
        ...(options.messageType === undefined ? {} : { message_type: options.messageType }),
      },
    });
  }

  listFavours(options: { offset?: number; limit?: number } = {}): Promise<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>("/bbs/web/profile/favours", {
      query: {
        heybox_id: this.http.heyboxId,
        userid: this.http.heyboxId,
        offset: options.offset ?? 0,
        limit: options.limit ?? 20,
      },
    });
  }

  /** Site-wide search; results mix `link`, `topic`, `mini_app` and spacer entries. */
  searchGeneral(options: { keyword: string; offset?: number; limit?: number }): Promise<SearchResponse> {
    return this.http.get<SearchResponse>("/bbs/app/api/general/search/v1", {
      webVersion: "3.0",
      query: {
        q: options.keyword,
        search_type: "general",
        is_pull_down: 0,
        offset: options.offset ?? 0,
        limit: options.limit ?? 30,
        dw: 628,
      },
    });
  }

  /** Stranger DM conversation list (read-only; sending is not exposed as an HTTP API). */
  listStrangerMessages(options: { offset?: number; limit?: number } = {}): Promise<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>("/chat/stranger_messages/", {
      webVersion: "3.0",
      query: { offset: options.offset ?? 0, limit: options.limit ?? 20 },
    });
  }

  /** Communities and hashtags offered by the editor. */
  listEditorTopics(): Promise<{
    result?: {
      topic_list?: Array<{ name?: string; topic_id?: number }>;
      hashtag_list?: Array<{ name?: string; hashtag_id?: number }>;
    };
  }> {
    return this.http.get("/bbs/app/api/post_editor/topic_selection/index", { webVersion: "3.0" });
  }

  /** Search communities by name; returns exact and fuzzy matches. */
  searchEditorTopics(keyword: string): Promise<{
    result?: { search_result?: Array<{ name?: string; topic_id?: number; search_type?: string }> };
  }> {
    return this.http.get("/bbs/app/api/post_editor/topic_selection/search", {
      webVersion: "3.0",
      query: { q: keyword, only_hashtag: 0 },
    });
  }

  /** Publish a post (image-text) with an already-uploaded image URL. */
  publishPost(form: Record<string, string | number>): Promise<{ status: string; link_id?: number | string; msg?: string }> {
    return this.http.postForm("/bbs/app/api/link/post", { webVersion: "3.0", form });
  }

  /** Like (support_type=1) or un-like (support_type=0) a comment. */
  supportComment(options: { commentId: string; supportType?: 0 | 1 }): Promise<Record<string, unknown>> {
    return this.http.postForm("/bbs/app/comment/support", {
      webVersion: "3.0",
      form: { comment_id: options.commentId, support_type: options.supportType ?? 1 },
    });
  }

  /** Create a top-level comment (`replyId=-1`) or a reply inside a thread. */
  createComment(options: {
    linkId: string | number;
    text: string;
    replyId?: string | number;
    rootId?: string | number;
    isCy?: 0 | 1;
  }): Promise<CommentCreateResponse> {
    return this.http.postForm<CommentCreateResponse>("/bbs/app/comment/create", {
      workshop: true,
      form: {
        is_cy: options.isCy ?? 0,
        link_id: String(options.linkId),
        reply_id: String(options.replyId ?? -1),
        root_id: String(options.rootId ?? -1),
        text: options.text,
      },
    });
  }
}
