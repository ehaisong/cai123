# 部署架构：Zeabur 主站 + Lovable 仅作编辑器

## 架构

```
Lovable 编辑/预览  →  GitHub 自动同步  →  Zeabur 自动构建  →  对外发布
                                                       ↑
                                          自有域名 DNS A 记录
```

- **Lovable**：只用于编辑代码 + 预览（`id-preview--*.lovable.app` 走 vite dev，正常）
- **GitHub**：作为代码中转，Lovable 双向同步
- **Zeabur**：拉取仓库 → `bun install && bun run build` → 用 `dist/client/` 当静态站发布
- **Supabase**：浏览器直连，跟前端跑在哪个 CDN 无关

## 关键配置

| 文件 | 作用 |
|------|------|
| `vite.config.ts` | `cloudflare: false` + SPA 模式，构建出 `dist/client/` |
| `zeabur.json` | 显式声明构建命令、输出目录、SPA rewrites |
| `vercel.json` / `public/_redirects` | 备用：将来在 Vercel/Netlify 部署兜底用 |

## 抗封锁策略

1. **主**：Zeabur 部署，绑自有域名，DNS A 记录指向 Zeabur IP
2. **备**：同一仓库再接一份 Vercel 或 Netlify，拿到备用 IP
3. **被封时**：在域名 DNS 处把 A 记录切到备用 IP（TTL 设 300s，5 分钟生效）
4. **进阶**：用 Cloudflare Load Balancer / DNSPod 故障转移自动切换

## ⚠️ 重要警告

**不要点 Lovable 的「发布」按钮。**

原因：当前 `vite.config.ts` 关掉了 Cloudflare Worker 配置，但 TanStack Start 在 SPA 模式下仍然会产出 `dist/server/server.js`。Lovable 的发布管线检测到 server bundle 就当 Worker 部署，但 Worker 入口缺东西 → `https://cai123.lovable.app/` 会一直返回 Internal Server Error。

这没影响业务——我们不靠 Lovable 发布对外服务。如果想彻底屏蔽这个按钮，可以在项目设置里把 publish visibility 设为 private。

## 验证步骤（接入 Zeabur 时执行）

1. 确认 Lovable 已连 GitHub（Connectors → GitHub → Connect project）
2. Zeabur 控制台 → New Project → Import from GitHub → 选本仓库
3. Zeabur 自动读 `zeabur.json`，跑 `bun install && bun run build`
4. 用 Zeabur 分配的 `xxx.zeabur.app` 临时域名访问首页
5. 测试 SPA 路由：访问 `/admin/users` 后**直接刷新**，确认不会 404（验证 rewrites 生效）
6. 绑定自有域名：Zeabur 控制台添加 → 按提示设 DNS

## Supabase 提醒

浏览器直连 `aonequdtprbhviskbvrw.supabase.co`。无论前端跑在 Zeabur / Vercel / 自有 VPS，连的都是同一个 Supabase 实例，数据互通。

如果将来要加服务端逻辑（敏感密钥、定时任务等），用 **Supabase Edge Functions**，不要回到 TanStack Start 的 SSR——那会破坏当前的纯静态部署。

## 故障排查

| 现象 | 排查方向 |
|------|---------|
| Zeabur 构建失败 | 看构建日志；检查 `bun install` 是否所有依赖装上 |
| 部署后访问首页空白 | F12 看 Console，通常是 `dist/client` 路径没对，或 assets 404 |
| 子路径刷新 404 | `zeabur.json` 的 `rewrites` 没生效，确认配置在 |
| Supabase 连不上 | 检查 `.env` 里的 `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` 是否被 Zeabur 注入 |
