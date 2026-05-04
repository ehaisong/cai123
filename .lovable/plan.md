
# 把微信/手机登录整合到本站

## 目标

去掉登录时跳转 wx.lovclaw.com 中转站的步骤，改在本站 `/auth/login` 页面直接完成全部交互。

- **微信外浏览器**：客户和商家都使用「手机号 + 短信验证码」登录。
- **微信内浏览器**：客户走「微信一键登录」（公众号网页授权 snsapi_userinfo），商家继续用短信验证码。

## 页面交互

参考截图重构 `src/routes/auth.login.tsx`：

- 顶部插画 + 「客户登录 / 商家登录」两个 Tab（保留现有视觉）。
- **微信外**（默认）：
  - 客户 Tab、商家 Tab 都显示同一套表单：手机号输入框 + 验证码输入框 + 「获取验证码」按钮 + 「登录」按钮。
  - 同意协议复选框保留。
- **微信内**：
  - 客户 Tab：只显示一个「微信一键登录」绿色按钮，点击后无感跳转完成授权（参考 `isWechatBrowser()` 判断）。
  - 商家 Tab：与微信外一致，手机号 + 验证码。
- 移除「中转站 iframe」相关代码（`IframeCard`、`/login/iframe-bridge`、postMessage 桥接）。
- `/login/done` 仅作为微信授权回调落地页，去掉 ticket 兑换逻辑。

## 后端：本站直接对接

新建 / 改造以下 server functions（用 TanStack `createServerFn` + `supabaseAdmin`，不再走 Edge Function）：

### 1. 短信验证码（复用中转站短信通道）
- `src/server/auth-sms.functions.ts`
  - `sendSmsCode({ phone })`：调用 `https://wx.lovclaw.com/api/public/sms/send`（用 `WECHAT_HUB_SECRET` 鉴权），把验证码下发；同时把 `phone -> code -> expires_at` 写入新表 `sms_codes`。
  - `loginWithSmsCode({ phone, code })`：校验 `sms_codes`（5 分钟有效、单次使用），查或建 Supabase Auth 用户（按 `find_user_by_phone`），用 `supabaseAdmin.auth.admin.generateLink({ type: "magiclink" })` 拿到 `token_hash` 返回前端，前端 `supabase.auth.verifyOtp` 完成登录。
- 新表 `sms_codes`（migration）：`phone, code_hash, expires_at, consumed_at`，仅服务端访问，RLS 全部 deny（service role bypass）。
- 简单速率限制：同一手机号 60s 内只能发一次、每天 ≤ 10 次。

### 2. 微信公众号网页授权（snsapi_userinfo）
- 路由 `/api/public/wechat/callback`（server route）：接收微信 `code`，用 `WECHAT_APPID` + `WECHAT_APPSECRET` 调 `access_token` → `userinfo`，得到 `openid/unionid/nickname/avatar`，复用现有 `find_user_by_wechat` / `bind_wechat_to_profile` 逻辑，签发 magiclink token_hash，302 回 `/login/done?token_hash=...&return_path=...`。
- 前端 `/login/done` 直接 `verifyOtp` 完成登录，再走 `resolveLoginDestination`。
- 新增按钮处理：拼接 `https://open.weixin.qq.com/connect/oauth2/authorize?appid=...&redirect_uri={origin}/api/public/wechat/callback&response_type=code&scope=snsapi_userinfo&state=...#wechat_redirect`，整页跳转。
- `state` 用一次性随机串存 sessionStorage 校验，附带业务回跳路径。

### 3. 需要新增的 secrets（Lovable Cloud Secrets）
- `WECHAT_APPID`（公众号 AppID）
- `WECHAT_APPSECRET`（公众号 AppSecret）

`WECHAT_HUB_SECRET`（短信通道复用）已存在。

## 关键文件改动

| 文件 | 操作 |
|---|---|
| `src/routes/auth.login.tsx` | 重写：双 Tab + 微信内外分支 + 短信表单 |
| `src/routes/login.done.tsx` | 简化：仅做 `verifyOtp(token_hash)` + 角色路由，删除 ticket 流程 |
| `src/routes/login.iframe-bridge.tsx` | 删除 |
| `src/routes/login.wechat-done.tsx` | 删除（已被 `login.done` 取代） |
| `src/server/auth-sms.functions.ts` | 新建：`sendSmsCode` / `loginWithSmsCode` |
| `src/server/auth-sms.server.ts` | 新建：调用中转站短信 API 的 helper |
| `src/routes/api/public/wechat/callback.ts` | 新建：微信公众号授权回调 |
| `supabase/migrations/*` | 新增 `sms_codes` 表 |
| `supabase/functions/wechat-exchange/` | 暂保留（可后续清理），新流程不再调用 |

## 微信公众号配置

需要您在微信公众号后台「设置 → 公众号设置 → 功能设置 → 网页授权域名」中加入 `cai123.lovable.app`（或当前自定义域）。完成迁移后我会提示您具体步骤。

## 验收标准

1. 微信外打开 `/auth/login`：默认显示手机号+验证码表单，能完成登录。
2. 微信内打开 `/auth/login`，客户 Tab：点击「微信一键登录」，无 iframe、无中转页，直接 302 到本站完成登录。
3. 商家 Tab 始终为短信验证码。
4. 登录耗时显著降低（少 1-2 次 wx.lovclaw.com 跳转）。
5. 已绑定微信/手机的老用户保持登录态不丢失（沿用 `find_user_by_wechat` / `find_user_by_phone`）。
