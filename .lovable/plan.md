# 抗封锁部署方案：Lovable 编辑 + 多节点 SPA 灾备

## 现状诊断（已扫描代码确认）

- 项目实际是**纯 SPA 架构**：所有数据请求都直接走 Supabase（浏览器端 `@/integrations/supabase/client`）
- **没有任何业务代码使用** `createServerFn`、`src/routes/api/*`、SSR 数据加载
- `client.server.ts` 和 `auth-middleware.ts` 只是脚手架自带文件，未被引用
- 当前构建产物是 Cloudflare Worker（带 SSR 壳），但实际**没有承担任何服务端逻辑**

**结论**：可以无损地把构建目标从"Cloudflare Worker SSR"改为"纯静态 SPA"，部署到任何平台，且不丢失任何功能。

## 方案对比

| 维度 | 方案 A：保持现状 + 多域名 | 方案 B：改造为纯 SPA + 多平台部署（推荐） |
|------|--------------------------|-------------------------------------------|
| 抗封能力 | 弱：DNS 只能指向 Lovable 固定 IP `185.158.133.1`，被封无备用 | 强：可同时部署到 Zeabur 多节点 / Vercel / Netlify / 自有 VPS，DNS 随时切换 |
| Lovable 编辑器 | ✅ 完全保留 | ✅ 完全保留 |
| Lovable 一键发布 | ✅ 主用 | ⚠️ 仍可用作主线，但灾备靠 Zeabur |
| Supabase 调用 | 浏览器直连，与部署无关 | 浏览器直连，与部署无关（不变） |
| 改造工作量 | 0 | 小（约 3 个文件改动，1 个新增） |

**推荐方案 B**，因为它直接解决你的真实诉求，并且代价小。

---

## 方案 B 实施步骤

### 步骤 1：把构建目标从 Worker 改为静态 SPA

需要在 `vite.config.ts` 中关闭 SSR / Cloudflare Worker 输出，改为纯静态构建。

具体改动（实施时执行，本计划不动代码）：
- 调整 `vite.config.ts`，传入禁用 cloudflare 插件、强制 `prerender: true` 或全路由 `ssr: false` 的配置
- 删除/忽略 `wrangler.jsonc`（不影响 Lovable，但 Zeabur 会忽略它）
- 在 `src/router.tsx` 或路由配置中确保所有路由 `ssr: false`（项目已经是纯客户端逻辑，安全）
- 验证 `bun run build` 产出 `dist/` 目录，里面是 `index.html` + 静态资源

### 步骤 2：清理未使用的服务端脚手架

删除 `src/integrations/supabase/client.server.ts` 和 `src/integrations/supabase/auth-middleware.ts`（业务未引用，避免误用泄漏 service_role）。保留浏览器端 `client.ts`。

### 步骤 3：多平台部署配置

在仓库根新增极简配置文件：

- `zeabur.json`（或 Zeabur 控制台直接选 Static Site，构建命令 `bun install && bun run build`，输出目录 `dist`）
- 可选 `netlify.toml` / `vercel.json`（备用平台）

由于是 SPA + 文件路由，需要配置 SPA fallback：所有未匹配的路径回退到 `/index.html`，避免刷新 404。

### 步骤 4：DNS 灾备策略

域名注册商或 Cloudflare DNS 处准备多组 A 记录：
- 主线：Lovable IP `185.158.133.1`（或 Zeabur 节点 A）
- 备线 1：Zeabur 节点 B（不同区域）
- 备线 2：Vercel/Netlify

**切换方式**：
- 简单版：手动改 DNS 记录（TTL 设短，比如 300s）
- 自动版：用 Cloudflare Load Balancer 或 DNSPod 故障转移（按节点健康自动切）

### 步骤 5：Lovable 编辑流程不变

- 在 Lovable 里照常修改代码、用预览
- Lovable 自带"发布"仍然能跑（预览构建还是 Worker，但 SPA 改造后 Worker 只是静态分发壳）
- **主部署线推荐**：Lovable 自带发布（Cloudflare 节点）+ 自有域名，作为"主节点"
- **备部署线**：Zeabur 多节点，连同一个 GitHub 仓库（或手动上传 `dist/`），作为"备节点"

---

## 关键技术细节（可选阅读）

### 为什么可以安全地从 Worker 改为 SPA
- 项目所有数据获取都通过 `import { supabase } from '@/integrations/supabase/client'` 在浏览器端进行
- 没有 `createServerFn` 调用，没有 `src/routes/api/*`，没有 SSR 数据加载
- 路由组件不依赖服务端渲染的初始 HTML 数据

### vite.config.ts 改造方向
当前：
```ts
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
export default defineConfig();
```

改为（示意，实施时验证 `@lovable.dev/vite-tanstack-config` 暴露的覆盖参数）：
```ts
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
export default defineConfig({
  tanstackStart: { 
    target: "static",        // 或等价的禁用 SSR / Cloudflare 配置
    spa: { enabled: true },
  },
});
```

如果该封装不支持 SPA 输出，备选：直接用原生 `vite` + `@tanstack/router-plugin/vite` 自己搭配置（脱离 Lovable 封装层）。这一步的可行性需要在实施时实测，不行就走"双仓库"方案：Lovable 仓做编辑预览，CI 把代码同步到一个独立仓库做 SPA 构建。

### Supabase 不受任何影响
- 浏览器直连 `aonequdtprbhviskbvrw.supabase.co`，跟前端跑在哪个 CDN/服务器上无关
- 即使 Lovable 主节点被封，用户切到 Zeabur 节点，照样连同一个 Supabase

---

## 风险与回退

| 风险 | 应对 |
|------|------|
| `@lovable.dev/vite-tanstack-config` 不支持 SPA 输出 | 退回方案 A，或脱离封装手写 vite 配置 |
| Lovable 后续版本强依赖 SSR | 当前代码不依赖 SSR，影响有限；最坏情况是停在某个 Lovable 版本 |
| 改造后 Lovable 预览异常 | git revert 改动，回到当前状态 |

---

## 我需要你确认才能开始实施

1. 是否同意方案 B（保留 Lovable 编辑 + 改造为 SPA + 多平台部署）
2. 备用部署平台首选：Zeabur（你熟悉）/ Vercel / Netlify / 自有 VPS
3. 是否需要我在实施时一并配置 GitHub Actions 自动同步到备用平台

确认后我会按上述步骤逐项实施，每改一步验证一次，避免破坏当前可运行状态。
