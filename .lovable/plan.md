## 结论

当前失败不是中转站 ticket 内容问题，而是本站部署形态与代码不匹配：

- `vite.config.ts` 已开启 `tanstackStart.spa.enabled = true`，Zeabur 输出的是静态站点 `dist/client`。
- `/login/wechat-done` 页面里仍调用 `createServerFn`：`exchangeWechatTicket`。
- 线上 `https://66cai.site/_serverFn/...` 返回 `405 Allow: GET, HEAD`，说明 Zeabur 静态部署没有服务端函数运行环境。
- 所以前端兑换 ticket 时服务端函数入口不可用，TanStack 客户端抛出 `Invariant failed`，页面只显示 `{ "message": "Invariant failed" }`。

## 修复方案

### 1. 把微信 ticket 兑换改成真实 HTTP API 路由

新增一个公开 API 路由，例如：

```text
POST /api/public/wechat/exchange-ticket
```

它在服务端完成：

1. 校验 `ticket` 和 `return_path`。
2. 使用服务端环境变量 `WECHAT_HUB_SECRET` 调用中转站：
   `https://wx.lovclaw.com/api/public/oauth/wechat/exchange`。
3. 解析 openid / unionid / nickname / avatar。
4. 调用 Supabase admin client：
   - `find_user_by_wechat`
   - 新用户 `auth.admin.createUser`
   - `bind_wechat_to_profile`
   - `auth.admin.generateLink`
5. 返回前端需要的：
   - `tokenHash`
   - `email`
   - `redirectTo`

保留现有结构化日志，并把 `errcode / errmsg / step / raw` 以 JSON 原样返回给前端。

### 2. 修改 `/login/wechat-done` 前端调用方式

把当前的：

```ts
exchangeWechatTicket({ data: { ticket, return_path } })
```

改成：

```ts
fetch('/api/public/wechat/exchange-ticket', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ticket, return_path }),
})
```

失败时读取 API JSON，把 `errcode / errmsg / message` 显示在页面上。
成功后继续用现有逻辑：

```ts
supabase.auth.verifyOtp({ type: 'email', token_hash: tokenHash })
```

### 3. 移除或停用当前不适合静态部署的 server function 调用

`src/server/wechat-login.functions.ts` 里的业务逻辑可以复用/迁移到 API route 的 server handler；前端不再直接 import 它，避免静态部署时生成 `/_serverFn/...` 调用。

### 4. Zeabur 部署要求

因为这是部署在你自己的 Zeabur 服务器上，必须确保 Zeabur 运行的是支持后端 API 的 TanStack Start/Node 服务，而不是纯静态 `dist/client`。

我会同步调整项目配置：

- 关闭当前 SPA-only 静态构建说明/配置。
- 让构建产物包含可处理 `/api/public/*` 的服务端入口。
- 避免把 `client_secret` 放进前端包。

同时需要在 Zeabur 环境变量里配置：

```text
WECHAT_HUB_SECRET
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY
```

## 验证方式

实施后验证：

1. 打开 `https://66cai.site/login/wechat-done?ticket=...` 不再出现 `Invariant failed`。
2. 浏览器网络请求应出现：
   `POST /api/public/wechat/exchange-ticket`。
3. 若 ticket 过期或中转站拒绝，页面显示中转站返回的 `errcode/message`。
4. 若 ticket 有效，`verifyOtp` 成功并跳转到 `return_path` 或首页。

## 风险提示

你提供的这个 ticket 已经超过 2 分钟有效期，修复后用它测试预计会返回“ticket 过期/无效”；需要重新从微信登录流程获取新 ticket 测试。