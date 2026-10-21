/** MCP server: exposes the client as tools, with no prompts and no generated text. */
import { createServer, type IncomingMessage } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { XhhError } from "../client/errors.js";
import { makeClient } from "../client/factory.js";
import type { XhhClient } from "../client/xhh.js";
import { buildPostContext } from "../services/context.js";
import { createComment, likeComment, replyToComment } from "../services/actions.js";
import { publishArticle, publishImageText } from "../services/publish.js";
import { parseRichText } from "../services/post.js";
import { searchByKeyword, searchByLink, searchRandom } from "../services/search.js";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function ok(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function fail(error: unknown): ToolResult {
  const payload = error instanceof XhhError ? error.toJSON() : { kind: "unknown", message: String(error) };
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], isError: true };
}

async function guard(action: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await action());
  } catch (error) {
    return fail(error);
  }
}

function registerTools(server: McpServer, client: XhhClient): void {
  server.registerTool(
    "session_status",
    {
      title: "Session status",
      description: "检查当前 Cookie 是否有效，返回登录账号的 heybox_id。",
      inputSchema: {},
    },
    async () => guard(() => client.session()),
  );

  server.registerTool(
    "list_feeds",
    {
      title: "List home feed",
      description: "读取首页推荐信息流。offset 用于翻页，pull=0 为推荐流。",
      inputSchema: {
        offset: z.number().int().min(0).optional().describe("分页偏移量，默认 0"),
        limit: z.number().int().min(1).max(50).optional().describe("返回条数，默认 20"),
        pull: z.number().int().min(0).max(1).optional().describe("0 推荐 / 1 刷新"),
      },
    },
    async (args) =>
      guard(async () => {
        const response = await client.listFeeds(args);
        const links = response.result?.links ?? [];
        return {
          count: links.length,
          posts: links.map((link) => ({
            postId: String(link.linkid ?? link.link_id ?? ""),
            title: link.title ?? "",
            author: link.user?.username ?? "",
            likes: Number(link.up ?? 0),
            comments: Number(link.comment_num ?? 0),
            createdAt: Number(link.create_at ?? 0),
          })),
        };
      }),
  );

  server.registerTool(
    "get_post",
    {
      title: "Get post",
      description: "按帖子 ID 读取详情与首屏评论分组（原始结构，未做摘要）。",
      inputSchema: {
        postId: z.string().min(1).describe("帖子 ID"),
        page: z.number().int().min(1).optional().describe("评论页码，默认 1"),
        limit: z.number().int().min(1).max(50).optional().describe("每页评论数，默认 20"),
      },
    },
    async (args) =>
      guard(async () => {
        const response = await client.getLinkTree({ linkId: args.postId, page: args.page, limit: args.limit });
        const link = response.result?.link ?? {};
        return {
          post: {
            postId: String(link.linkid ?? link.link_id ?? args.postId),
            title: link.title ?? "",
            text: link.text ?? "",
            description: link.description ?? "",
            author: link.user?.username ?? "",
            tags: link.hashtags ?? [],
            images: link.imgs ?? [],
            likes: Number(link.up ?? 0),
            comments: Number(link.comment_num ?? 0),
            createdAt: Number(link.create_at ?? 0),
          },
          commentGroups: response.result?.comments?.length ?? 0,
          raw: response.result?.comments ?? [],
        };
      }),
  );

  server.registerTool(
    "list_messages",
    {
      title: "List messages",
      description: "读取消息列表。messageType=16 为 @我；不传则返回混合消息（含评论回复）。",
      inputSchema: {
        messageType: z.number().int().optional().describe("消息类型，16=@我"),
        offset: z.number().int().min(0).optional().describe("偏移量，默认 0"),
        limit: z.number().int().min(1).max(50).optional().describe("条数，默认 20"),
      },
    },
    async (args) => guard(() => client.listMessages(args)),
  );

  server.registerTool(
    "search_posts",
    {
      title: "Search posts",
      description:
        "三种搜索：keyword=按关键词站内搜索；random=随机浏览首页信息流；link=按帖子链接或 ID 定向获取。",
      inputSchema: {
        mode: z.enum(["keyword", "random", "link"]).describe("搜索方式"),
        query: z.string().optional().describe("keyword 模式的关键词"),
        link: z.string().optional().describe("link 模式的帖子链接或 ID"),
        offset: z.number().int().min(0).optional().describe("keyword 模式的分页偏移，默认 0"),
        limit: z.number().int().min(1).max(50).optional().describe("返回条数，默认 10"),
      },
    },
    async (args) =>
      guard(async () => {
        const limit = args.limit ?? 10;
        if (args.mode === "keyword") {
          if (!args.query) throw new XhhError("config", "keyword 模式需要 query");
          const posts = await searchByKeyword(client, { keyword: args.query, offset: args.offset, limit });
          return { mode: args.mode, query: args.query, count: posts.length, posts };
        }
        if (args.mode === "link") {
          if (!args.link) throw new XhhError("config", "link 模式需要 link（URL 或帖子 ID）");
          const post = await searchByLink(client, args.link);
          return { mode: args.mode, link: args.link, count: post ? 1 : 0, posts: post ? [post] : [] };
        }
        const posts = await searchRandom(client, { limit });
        return { mode: args.mode, count: posts.length, posts };
      }),
  );

  server.registerTool(
    "get_post_context",
    {
      title: "Get post context",
      description:
        "组装帖子上下文：帖子正文 + 按点赞/时间加权选出的评论（默认 Top 20）。只返回数据，不做总结。",
      inputSchema: {
        postId: z.string().min(1).describe("帖子 ID"),
        pages: z.number().int().min(1).max(10).optional().describe("最多抓取评论页数，默认 3"),
        limit: z.number().int().min(1).max(50).optional().describe("返回评论条数，默认 20"),
      },
    },
    async (args) =>
      guard(async () => {
        const context = await buildPostContext(client, {
          postId: args.postId,
          pages: args.pages,
          limit: args.limit,
        });
        if (!context) throw new XhhError("not_found", `帖子不存在或不可见：${args.postId}`);
        return context;
      }),
  );

  server.registerTool(
    "create_comment",
    {
      title: "Create comment",
      description: "在帖子下发表一条主评论。dryRun=true 时只返回将发送的请求，不实际提交。",
      inputSchema: {
        postId: z.string().min(1).describe("帖子 ID"),
        text: z.string().min(1).describe("评论内容"),
        dryRun: z.boolean().optional().describe("仅演练，不提交"),
      },
    },
    async (args) =>
      guard(() =>
        createComment(client, { postId: args.postId, text: args.text, dryRun: args.dryRun ?? false }),
      ),
  );

  server.registerTool(
    "reply_comment",
    {
      title: "Reply to comment",
      description:
        "回复帖子下的某条评论。可用 commentId 指定，或用 targetText 在评论区按文本匹配（默认第一页）。dryRun=true 时只返回请求。",
      inputSchema: {
        postId: z.string().min(1).describe("帖子 ID"),
        text: z.string().min(1).describe("回复内容"),
        commentId: z.string().optional().describe("目标评论 ID"),
        targetText: z.string().optional().describe("目标评论文本片段，用于定位"),
        dryRun: z.boolean().optional().describe("仅演练，不提交"),
      },
    },
    async (args) =>
      guard(() =>
        replyToComment(client, {
          postId: args.postId,
          text: args.text,
          commentId: args.commentId,
          targetText: args.targetText,
          dryRun: args.dryRun ?? false,
        }),
      ),
  );
  server.registerTool(
    "list_dm_conversations",
    {
      title: "List DM conversations",
      description: "读取陌生人私信会话列表（只读）。发送私信当前没有可用的 HTTP 接口。",
      inputSchema: {
        offset: z.number().int().min(0).optional().describe("偏移量，默认 0"),
        limit: z.number().int().min(1).max(50).optional().describe("条数，默认 20"),
      },
    },
    async (args) => guard(() => client.listStrangerMessages(args)),
  );

  server.registerTool(
    "like_comment",
    {
      title: "Like a comment",
      description: "给评论点赞或取消点赞（undo=true）。",
      inputSchema: {
        commentId: z.string().min(1).describe("评论 ID"),
        undo: z.boolean().optional().describe("true 表示取消点赞"),
      },
    },
    async (args) => guard(() => likeComment(client, { commentId: args.commentId, undo: args.undo })),
  );

  server.registerTool(
    "publish_post",
    {
      title: "Publish image-text post",
      description:
        "发布图文帖：先上传本地图片，再调用发布接口。需要 community（编辑器推荐社区名）或 topicIds。dryRun=true 只返回请求。",
      inputSchema: {
        title: z.string().min(1).max(30).describe("标题，最多 30 字"),
        content: z.string().describe("正文"),
        images: z.array(z.string()).optional().describe("本地图片绝对路径列表"),
        community: z.string().optional().describe("社区名，如 盒友杂谈"),
        topicIds: z.array(z.number().int()).optional().describe("社区 ID 列表（优先于 community）"),
        dryRun: z.boolean().optional().describe("仅演练，不上传也不发布"),
      },
    },
    async (args) =>
      guard(() =>
        publishImageText(client, {
          title: args.title,
          content: args.content,
          images: args.images,
          community: args.community,
          topicIds: args.topicIds,
          dryRun: args.dryRun ?? false,
        }),
      ),
  );

  server.registerTool(
    "publish_article",
    {
      title: "Publish article",
      description:
        "发布长文章（link_tag=11，HTML 正文）。内容按空行分段；需要 community 或 topicIds。dryRun=true 只返回请求。",
      inputSchema: {
        title: z.string().min(1).max(60).describe("标题，最多 60 字"),
        content: z.string().min(1).describe("正文，空行分段"),
        images: z.array(z.string()).optional().describe("本地图片绝对路径列表，追加在正文末尾"),
        community: z.string().optional().describe("社区名，如 盒友杂谈"),
        topicIds: z.array(z.number().int()).optional().describe("社区 ID 列表（优先于 community）"),
        dryRun: z.boolean().optional().describe("仅演练，不上传也不发布"),
      },
    },
    async (args) =>
      guard(() =>
        publishArticle(client, {
          title: args.title,
          content: args.content,
          images: args.images,
          community: args.community,
          topicIds: args.topicIds,
          dryRun: args.dryRun ?? false,
        }),
      ),
  );
}

/** Start the MCP server on stdio. */
export async function startStandalone(mode: "stdio" | "http", options: { port?: number } = {}): Promise<void> {
  if (mode === "http") {
    await startHttp(options);
    return;
  }
  const server = buildServer(makeClient());
  await server.connect(new StdioServerTransport());
  process.stderr.write("xiaoheihe-mcp ready on stdio\n");
}

function buildServer(client: XhhClient): McpServer {
  const server = new McpServer({ name: "xiaoheihe", version: "0.1.0" });
  registerTools(server, client);
  return server;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > 4 * 1024 * 1024) throw new Error("request body too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Stateless Streamable HTTP transport: one server instance per request. */
export async function startHttp(options: { port?: number; host?: string } = {}): Promise<void> {
  const port = options.port ?? Number(process.env.XHH_HTTP_PORT ?? 8757);
  const host = options.host ?? process.env.XHH_HTTP_HOST ?? "127.0.0.1";
  const client = makeClient();

  const httpServer = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? host}`);
    if (url.pathname !== "/mcp") {
      response.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405, { allow: "POST" }).end();
      return;
    }

    try {
      const body = await readJsonBody(request);
      const server = buildServer(client);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      response.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(request, response, body);
    } catch (error) {
      process.stderr.write(`http handler error: ${String(error)}\n`);
      if (!response.headersSent) response.writeHead(500).end("internal error");
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, resolve);
  });
  process.stderr.write(`xiaoheihe-mcp ready on http://${host}:${port}/mcp\n`);
}

/** Backwards-compatible entry point used by the CLI. */
export async function startServer(mode: "stdio" | "http", options: { port?: number } = {}): Promise<void> {
  return startStandalone(mode, options);
}
