import { makeClient } from "../src/client/factory.ts";
const client = makeClient();
const res = await client.listEditorTopics();
const list = res.result?.topic_list ?? [];
console.log("topic_list size:", list.length);
const hit = list.find((t) => (t.name ?? "").includes("盒友"));
console.log("盒友杂谈 in recommended list:", hit ? JSON.stringify(hit) : "NO");
console.log("first 10:", list.slice(0, 10).map((t) => `${t.name}=${t.topic_id}`).join(", "));
