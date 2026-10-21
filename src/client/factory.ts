/** Build a client from the stored credentials. */
import { credentialsPath, loadCredentials, missingCookieFields } from "../auth/credentials.js";
import { XhhError } from "./errors.js";
import { XhhHttp } from "./http.js";
import { XhhClient } from "./xhh.js";

export function makeClient(): XhhClient {
  const credentials = loadCredentials();
  const missing = missingCookieFields(credentials.cookie);
  if (missing.length > 0) {
    throw new XhhError("config", `Cookie 缺少字段：${missing.join(", ")}（${credentialsPath()}）`);
  }
  const http = new XhhHttp({
    cookie: credentials.cookie,
    heyboxId: String(credentials.cookie.heybox_id),
  });
  return new XhhClient(http);
}
