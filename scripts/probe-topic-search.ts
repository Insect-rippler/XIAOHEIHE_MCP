import { XhhHttp } from "../src/client/http.ts";
import { loadCredentials } from "../src/auth/credentials.ts";
const cred = loadCredentials();
const http = new XhhHttp({ cookie: cred.cookie, heyboxId: String(cred.cookie.heybox_id) });
for (const flag of [0, 1, "false"]) {
  try {
    const res = await http.get("/bbs/app/api/post_editor/topic_selection/search", { webVersion: "3.0", query: { q: "盒友杂谈", only_hashtag: flag } });
    const r = res.result || {};
    const list = r.topic_list || r.list || r.items || [];
    console.log("only_hashtag", JSON.stringify(flag), "keys:", Object.keys(r).join(","), "| first:", JSON.stringify(list[0])?.slice(0, 200));
    if (list.length) break;
  } catch (e) { console.log("only_hashtag", JSON.stringify(flag), "ERR", e.message.slice(0, 80)); }
}
