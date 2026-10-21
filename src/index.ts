#!/usr/bin/env node
/** CLI: credentials management plus a read-only probe used to verify the API surface. */
import { importCredentialsFrom, missingCookieFields, saveCredentials, credentialsPath } from "./auth/credentials.js";
import { XhhError } from "./client/errors.js";
import { makeClient } from "./client/factory.js";
import type { FeedLink } from "./client/xhh.js";

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function summarizePost(link: FeedLink): Record<string, unknown> {
  return {
    postId: String(link.linkid ?? link.link_id ?? ""),
    title: String(link.title ?? "").slice(0, 40),
    author: link.user?.username ?? "",
    likes: Number(link.up ?? 0),
    comments: Number(link.comment_num ?? 0),
  };
}

async function probe(): Promise<void> {
  const client = makeClient();
  const started = Date.now();

  const sessionStart = Date.now();
  const session = await client.session();
  const sessionMs = Date.now() - sessionStart;

  const feedsStart = Date.now();
  const feeds = await client.listFeeds({ limit: 10 });
  const feedsMs = Date.now() - feedsStart;
  const links = feeds.result?.links ?? [];

  let treeMs: number | null = null;
  let firstPost: Record<string, unknown> | null = null;
  let commentGroups = 0;
  if (links[0]) {
    const treeStart = Date.now();
    const tree = await client.getLinkTree({ linkId: String(links[0].linkid ?? links[0].link_id ?? "") });
    treeMs = Date.now() - treeStart;
    commentGroups = tree.result?.comments?.length ?? 0;
    firstPost = summarizePost(tree.result?.link ?? links[0]);
  }

  print({
    ok: true,
    session,
    timings: { sessionMs, feedsMs, treeMs, totalMs: Date.now() - started },
    feeds: { count: links.length, sample: links.slice(0, 3).map(summarizePost) },
    linkTree: firstPost ? { post: firstPost, commentGroups } : null,
  });
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "probe":
      await probe();
      return;
    case "whoami": {
      const session = await makeClient().session();
      print(session);
      return;
    }
    case "import": {
      const fromIndex = rest.indexOf("--from");
      const source = fromIndex >= 0 ? rest[fromIndex + 1] : "";
      if (!source) throw new XhhError("config", "用法：import --from <config.json>");
      const credentials = importCredentialsFrom(source);
      const missing = missingCookieFields(credentials.cookie);
      if (missing.length > 0) throw new XhhError("config", `来源文件缺少 Cookie 字段：${missing.join(", ")}`);
      saveCredentials(credentials);
      print({ ok: true, saved: credentialsPath(), heyboxId: credentials.cookie.heybox_id });
      return;
    }
    case "serve": {
      const { startServer } = await import("./mcp/server.js");
      const portIndex = rest.indexOf("--port");
      const port = portIndex >= 0 ? Number(rest[portIndex + 1]) : undefined;
      await startServer(rest.includes("--http") ? "http" : "stdio", { port });
      return;
    }
    default:
      print({
        usage: ["import --from <config.json>", "whoami", "probe", "serve [--http]"],
        credentials: credentialsPath(),
      });
  }
}

main().catch((error: unknown) => {
  const payload = error instanceof XhhError ? error.toJSON() : { kind: "unknown", message: String(error) };
  process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = 1;
});
