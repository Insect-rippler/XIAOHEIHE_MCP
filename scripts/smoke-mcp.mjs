// Smoke test: spawn the built MCP server over stdio and call its tools.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js", "serve"],
  cwd: process.cwd(),
  stderr: "inherit"
});

const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(transport);

const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));

const session = await client.callTool({ name: "session_status", arguments: {} });
console.log("session_status:", session.content?.[0]?.text?.replace(/\s+/g, " "));

const feeds = await client.callTool({ name: "list_feeds", arguments: { limit: 3 } });
const parsed = JSON.parse(feeds.content?.[0]?.text ?? "{}");
console.log("list_feeds count:", parsed.count, "| first:", parsed.posts?.[0]?.postId);

const search = await client.callTool({ name: "search_posts", arguments: { mode: "keyword", query: "原神", limit: 5 } });
const found = JSON.parse(search.content?.[0]?.text ?? "{}");
console.log("search_posts keyword:", found.count, "| first:", found.posts?.[0]?.postId);

const postId = parsed.posts?.[0]?.postId ?? found.posts?.[0]?.postId;
if (postId) {
  const context = await client.callTool({ name: "get_post_context", arguments: { postId, pages: 2, limit: 20 } });
  const ctx = JSON.parse(context.content?.[0]?.text ?? "{}");
  console.log("get_post_context comments:", ctx.comments?.length, "| considered:", ctx.meta?.considered);

  const dry = await client.callTool({
    name: "create_comment",
    arguments: { postId, text: "接口联调测试（dryRun）", dryRun: true },
  });
  const dryResult = JSON.parse(dry.content?.[0]?.text ?? "{}");
  console.log("create_comment dryRun:", dryResult.dryRun, "| reply_id:", dryResult.request?.reply_id);

  const target = ctx.comments?.[0]?.text?.slice(0, 8);
  if (target) {
    const replyDry = await client.callTool({
      name: "reply_comment",
      arguments: { postId, text: "回复联调（dryRun）", targetText: target, dryRun: true },
    });
    const replyResult = JSON.parse(replyDry.content?.[0]?.text ?? "{}");
    console.log("reply_comment dryRun:", replyResult.dryRun, "| target:", replyResult.target?.commentId);
  }
}

await client.close();
