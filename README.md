# xiaoheihe-mcp

> A local MCP server for **Xiaoheihe (xiaoheihe.cn)**: read feeds, search posts, assemble comment context, post comments, and publish image-text posts or long-form articles through the site's own web API. No prompts, no persona, no browser required.

小黑盒（xiaoheihe.cn）本机能力接口。**没有提示词、没有人格、不跑 Agent 循环**——只做取数与发请求，任何 Agent 通过 MCP 调用就能读帖、搜索、评论、发帖。

签名、上传、发布全部走 HTTP；`hkey` / `_rnd` 按协议事实重写，13 个固定向量锁定行为。适合把"逛社区"这件事交给 Agent，也适合作为其他程序的底层接口。

## 特性

- **纯 HTTP**：签名、上传、发布全部走接口，不需要浏览器常驻。
- **无状态**：stdio 与 Streamable HTTP 双传输，HTTP 模式每个请求一个实例。
- **结构化错误**：统一 `{ kind, message, retryable, details }`，调用方可按 `kind` 决定重试、暂停还是换路径。
- **自带节流**：写操作有最小间隔与小时上限；验证码触发后熔断 5 分钟并返回处置建议。
- **干净实现**：签名算法按协议事实重写，未复制第三方 GPL 代码。

## 能力

| 工具 | 作用 |
|---|---|
| `session_status` | 校验 Cookie，返回当前账号 |
| `list_feeds` | 首页信息流（`offset` / `limit`） |
| `get_post` | 帖子详情 + 首屏评论原始结构 |
| `get_post_context` | 帖子正文 + 按点赞/时间加权选出的 Top 20 评论 |
| `search_posts` | 三种搜索：`keyword` / `random` / `link` |
| `list_messages` | 消息列表（`messageType=16` 为 @我） |
| `list_dm_conversations` | 陌生人私信会话（只读） |
| `create_comment` | 发主评论，支持 `dryRun` |
| `reply_comment` | 回复评论，按 `commentId` 或文本匹配 |
| `like_comment` | 评论点赞 / 取消（`undo`） |
| `publish_post` | 发布图文（`link_tag=27`） |
| `publish_article` | 发布文章（`link_tag=11`） |

## 快速开始

```bash
npm install

# 方式一：从已有配置导入 Cookie（需要 user_pkey / user_heybox_id / heybox_id / x_xhh_tokenid）
npx tsx src/index.ts import --from "D:\path\to\config.json"

# 方式二：扫码登录（会保存二维码图片并打开）
npx tsx scripts/qr-login.ts

npx tsx src/index.ts whoami    # 验证登录态
npx tsx src/index.ts probe     # 只读自检：会话 + 信息流 + 帖子详情
```

凭据默认写入 `%USERPROFILE%\.xiaoheihe-mcp\credentials.json`，可用 `XHH_CREDENTIALS` 指向别的文件（多账号切换）。

## 接入 MCP

**stdio**

```json
{
  "mcpServers": {
    "xiaoheihe": {
      "command": "node",
      "args": ["D:\\ASPHIXIA\\xiaoheihe-mcp\\dist\\index.js", "serve"]
    }
  }
}
```

**Streamable HTTP**

```bash
npm run build && npm run serve:http   # 默认 http://127.0.0.1:8757/mcp
```

```json
{
  "mcpServers": {
    "xiaoheihe": { "type": "http", "url": "http://127.0.0.1:8757/mcp" }
  }
}
```

端口用 `--port` 或 `XHH_HTTP_PORT`，监听地址用 `XHH_HTTP_HOST`。

**DSH**

```yaml
- id: mcp-xiaoheihe
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: xiaoheihe
    transport: streamable-http
    url: http://127.0.0.1:8757/mcp
    toolCallTimeoutMs: 300000
```

## 设计说明

### 签名

每个请求带 `hkey` / `_time` / `nonce`，由路径与当前秒级时间生成；Workshop 写接口（评论）额外带 `_rnd`（HMAC-SHA256）。实现集中在 `src/signing/hkey.ts`，纯函数、可注入时间与随机数，用 13 个固定向量锁定行为。

### 发帖

| 类型 | `link_tag` | 正文 |
|---|---|---|
| 图文 | 27 | `[{type:"text"},{type:"img",url,width,height}]` |
| 文章 | 11 | `[{type:"html",text:"<p>…</p>"}]`，空行分段 |

图片先经 `upload/info` → `upload/token` → COS 签名 PUT → `upload/callback` 四步上传，再 `POST /bbs/app/api/link/post`。社区用 `community` 名称（解析编辑器推荐列表）或直接给 `topicIds`。

### 验证码

接口返回 `show_captcha` 时抛 `captcha_required` 并熔断 5 分钟：

```json
{
  "kind": "captcha_required",
  "message": "站点返回 show_captcha：本次请求被人机验证拦截，未执行成功。",
  "retryable": true,
  "details": {
    "retryAfterSeconds": 300,
    "hint": "站点要求人机验证：请在浏览器打开 https://www.xiaoheihe.cn 手动完成一次验证，并降低请求频率（写操作建议间隔 ≥10 分钟）后重试。持续重试会延长风控时间。",
    "upstreamStatus": "show_captcha"
  }
}
```

冷却期内重复请求会快速失败并给出剩余秒数。调用方应暂停并提示使用者，而不是自动重试。

### 错误类型

`not_logged_in` · `captcha_required` · `rate_limited` · `content_rejected` · `not_found` · `upstream` · `network` · `config`

### 节流

写操作共享 `ActionLimiter`：同一动作 5 秒内只能一次，每小时上限 30 次。发布类操作建议调用方自行拉长到 ≥10 分钟一条。

## 项目结构

```
src/
  signing/     hkey / _rnd（纯函数）
  auth/        Cookie 读取、导入、校验
  client/      签名请求、错误分类、领域方法
  services/    搜索、上下文装配、评论、发帖、上传、限频、验证码
  mcp/         MCP 工具注册与 stdio / HTTP 传输
  index.ts     CLI：import / whoami / probe / serve
test/          单测与录制 fixture
scripts/       qr-login / smoke / fixture 工具
```

## 开发

```bash
npm run typecheck
npm test                 # 54 个单测
npm run build
npm run smoke            # stdio 冒烟（需先 build）
npm run smoke:http       # HTTP 冒烟（需先 build）
```

`scripts/dump-fixture.ts` 用真实接口重新录制 `test/fixtures/link-tree-*.json`，供评论排序的离线测试使用。

## 边界

- **未实现**：视频发布、帖子点赞、私信发送（发送侧是独立微前端，没有可复用的 HTTP 接口）。
- **频率**：连续发布或评论会触发人机验证，这是平台风控，不是客户端 bug。
- **协议**：仅供个人账号的本机工具使用；自动化操作受平台用户协议约束，风险自负。
- **凭据**：Cookie 四字段等价账号全权，文件已收紧 ACL，不要提交或外传。

## License

[MIT](LICENSE)
