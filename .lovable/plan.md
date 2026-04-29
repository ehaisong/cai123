# 抗封锁部署方案：已实施

## 已完成的改造

| 改动 | 文件 | 作用 |
|------|------|------|
| 关闭 Cloudflare Worker 输出 | `vite.config.ts` (`cloudflare: false`) | 不再产出 Worker 包 |
| 启用 SPA 模式 | `vite.config.ts` (`tanstackStart.spa.enabled: true`) | `bun run build` 输出纯静态 `dist/` |
| 删除 Worker 配置 | 移除 `wrangler.jsonc` | 静态部署不需要 |
| 删除未使用的服务端脚手架 | 移除 `src/integrations/supabase/client.server.ts`、`auth-middleware.ts` | 防止误用泄漏 service_role |
| Zeabur 静态站点配置 | 新增 `zeabur.json` | 一键部署到 Zeabur |
| SPA fallback（Netlify/Cloudflare Pages） | 新增 `public/_redirects` | 刷新子路径不 404 |
| SPA fallback（Vercel） | 新增 `vercel.json` | 同上 |

## 现在的部署矩阵

- **主线**：Lovable 一键发布（仍可用，自动走 Cloudflare 边缘）
- **备线**：把 GitHub 仓库（或 Lovable 同步出去的仓库）接入 Zeabur / Vercel / Netlify / 自有 VPS。`bun install && bun run build` → `dist/` 直接拖部署即可
- **被封时切换**：在域名注册商或 Cloudflare DNS 处把 A 记录指向备用节点，TTL 建议设 300s

## 多节点 + DNS 灾备的具体做法

### 简易版：手动 DNS 切换
1. 同时在 Lovable 发布主站、Zeabur 部署备站（用同一个仓库）
2. 域名 DNS A 记录初始指向 Lovable IP `185.158.133.1`
3. 主站不可用时，把 A 记录改成 Zeabur 节点 IP（Zeabur 控制台可看到）
4. 由于 TTL 短，5 分钟内全网生效

### 进阶版：Cloudflare Load Balancer 自动切换
1. 把域名 DNS 托管到 Cloudflare（橙色云朵）
2. 创建 Load Balancer，加两个 Pool：Lovable / Zeabur
3. 设置健康检查（每 60s 探测 `/`），主节点失败自动切到备节点
4. 收费功能，约 $5/月起

### 完全免费版：DNSPod / 阿里云 DNS 故障转移
1. 国内 DNS 服务商（如 DNSPod）支持基础的故障转移
2. 把主备 IP 都加进去，开启故障转移
3. 探测失败自动切，免费

## Lovable 编辑流程

完全不变：
- 在 Lovable 里照常修改、预览
- Lovable 自带「发布」继续可用 — 但产物现在是静态资源，由 Cloudflare 静态分发（更稳）
- Lovable 预览（`id-preview--*.lovable.app`）也走 SPA，没有 Internal Server Error 风险

## Supabase 不受影响

- 浏览器仍直连 `aonequdtprbhviskbvrw.supabase.co`
- 跟前端跑在哪个 CDN/服务器无关
- 任何节点（Lovable / Zeabur / Vercel / 你自己的 VPS）都连同一个 Supabase

## 风险与回退

| 风险 | 应对 |
|------|------|
| 后续要加服务端逻辑（`createServerFn`、API 路由） | 把 `tanstackStart.spa.enabled` 改回 false，恢复 SSR；但失去多平台部署能力，需取舍 |
| Lovable 预览异常 | git revert `vite.config.ts`，恢复默认 Worker 模式 |
| Zeabur 节点也被封 | 多备几个：Vercel（部分线路通）/ Netlify / 自己的境外 VPS（小鸡 + nginx 静态托管）|

## 接下来你要做的

1. **验证 Lovable 主站**：等本次发布完成后，访问 `https://cai123.lovable.app` 看是否正常
2. **设置 Zeabur 备线**：
   - 把 Lovable 项目接入 GitHub（如果还没）
   - 在 Zeabur 创建项目，连同一个仓库，会自动识别 `zeabur.json` 并构建
   - 拿到 Zeabur 给的临时域名，测试一下
3. **域名 DNS 准备**：
   - 把 TTL 调到 300s（方便切换）
   - 记录主备节点 IP
4. **被封演练**：手动切一次 DNS，验证切换流程通畅

如果某一步有问题，告诉我具体现象（构建报错、节点访问失败、DNS 不生效等），我帮你排查。
