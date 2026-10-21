import { XhhHttp } from "../src/client/http.ts";
import { loadCredentials } from "../src/auth/credentials.ts";
const cred = loadCredentials();
const http = new XhhHttp({ cookie: cred.cookie, heyboxId: String(cred.cookie.heybox_id) });
const res = await http.get("/bbs/app/api/post_editor/topic_selection/search", { webVersion: "3.0", query: { q: "盒友杂谈", only_hashtag: 0 } });
const sr = res.result?.search_result;
console.log("search_result type:", Array.isArray(sr) ? "array" : typeof sr);
console.log(JSON.stringify(sr).slice(0, 700));
