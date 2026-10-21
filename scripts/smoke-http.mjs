// Smoke test for the stateless HTTP transport.
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = 8757;
const child = spawn(process.execPath, ["dist/index.js", "serve", "--http", "--port", String(PORT)], {
  stdio: ["ignore", "inherit", "inherit"],
});

async function waitForServer(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (response.status < 500) return true;
    } catch {
      /* not ready */
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

try {
  if (!(await waitForServer())) throw new Error("http server did not start");
  const client = new Client({ name: "smoke-http", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`)));
  const tools = await client.listTools();
  console.log("http tools:", tools.tools.length, tools.tools.map((tool) => tool.name).join(","));
  const session = await client.callTool({ name: "session_status", arguments: {} });
  console.log("session_status:", String(session.content?.[0]?.text ?? "").replace(/\s+/g, " ").slice(0, 120));
  await client.close();
} finally {
  child.kill();
}
