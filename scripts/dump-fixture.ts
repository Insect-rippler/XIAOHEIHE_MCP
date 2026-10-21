/** Dump one link/tree response as a fixture for offline tests. */
import { writeFileSync } from "node:fs";
import { makeClient } from "../src/client/factory.js";

const postId = process.argv[2] ?? "193565384";
const pages = Number(process.argv[3] ?? "1");
const client = makeClient();
const responses = [];
for (let page = 1; page <= pages; page += 1) {
  const response = await client.getLinkTree({ linkId: postId, page });
  responses.push(response);
}
writeFileSync(`test/fixtures/link-tree-${postId}.json`, `${JSON.stringify(responses, null, 2)}\n`, "utf8");
process.stdout.write(`saved ${responses.length} page(s) for ${postId}\n`);
