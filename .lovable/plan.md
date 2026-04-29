
## 一、整站环境介绍

**前端语言 / 框架**
- 语言：TypeScript + React 19
- 框架：**TanStack Start v1**（全栈 React 框架，带 SSR）
- 构建工具：Vite 7
- 样式：Tailwind CSS v4（通过 `src/styles.css` 配置）
- UI 组件：shadcn/ui + Radix UI
- 路由：TanStack Router（基于文件的路由，自动生成 `routeTree.gen.ts`）

**后端**
- Supabase（数据库、认证、存储、Edge Functions）
- 项目 URL：`https://aonequdtprbhviskbvrw.supabase.co`

**目标运行时（关键）**
- 当前 `wrangler.jsonc` 配置的是 **Cloudflare Workers** 运行时（带 `nodejs_compat`）
- `vite.config.ts` 使用了 `@lovable.dev/vite-tanstack-config`，它在 build 时**默认绑定 Cloudflare 输出**
- 这就是 Zeabur 部署失败的**根本原因**：Zeabur 是 Node.js 容器/服务运行环境，不是 Cloudflare Workers，构建产物不兼容

---

## 二、GitHub 同步文件检查清单

请确认以下文件**已同步**到 GitHub（`.gitignore` 默认会忽略其中部分，需要特别关注）：

必须存在：
- `package.json`、`package-lock.json` 或 `bun.lockb`
- `vite.config.ts`、`tsconfig.json`
- `src/`（全部源码）
- `supabase/`（迁移文件）
- `components.json`、`eslint.config.js`、`.prettierrc`

不应同步（应在 `.gitignore` 中）：
- `node_modules/`、`.env`、`.lovable/`、`.workspace/`、`dist/`、`.output/`

**特别注意**：`.env` 文件**不会**同步到 GitHub（也不应同步）。Zeabur 上必须**手动配置环境变量**。

---

## 三、Zeabur 部署配置（提供给 Zeabur 使用）

### 1. 构建 / 启动命令

| 项目 | 值 |
|------|---|
| Node 版本 | 20 或 22 |
| 安装命令 | `npm install`（或 `bun install`） |
| 构建命令 | `npm run build` |
| 启动命令 | `node .output/server/index.mjs` |
| 监听端口 | `3000`（TanStack Start 默认） |

### 2. 必须配置的环境变量（在 Zeabur Dashboard → Variables）

```
VITE_SUPABASE_URL=https://aonequdtprbhviskbvrw.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...（与 .env 中相同）
VITE_SUPABASE_PROJECT_ID=aonequdtprbhviskbvrw
SUPABASE_URL=https://aonequdtprbhviskbvrw.supabase.co
SUPABASE_PUBLISHABLE_KEY=（同上 publishable key）
SUPABASE_SERVICE_ROLE_KEY=（从 Supabase Dashboard → Project Settings → API 复制）
PORT=3000
HOST=0.0.0.0
```

### 3. 关键改动：必须切换构建目标（不再绑定 Cloudflare）

当前 `vite.config.ts` 默认输出 Cloudflare Workers 产物，Zeabur 无法运行。需要改为 **Node 服务器输出**：

**改动文件 `vite.config.ts`**：
```ts
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  vite: {
    build: {
      // 强制使用 Node 服务器目标，而不是 Cloudflare Workers
      target: "node20",
    },
  },
  // 关闭 Cloudflare 插件（让 TanStack Start 输出标准 Node 服务）
  cloudflare: false,
});
```

**同时删除或保留但忽略 `wrangler.jsonc`**（Zeabur 不需要它，仅 Cloudflare 用）。

### 4. 推荐 Zeabur 模板

在 Zeabur 选择 **"Node.js" 服务模板**（不要选 Static / Cloudflare Workers 模板）。

---

## 四、为什么之前部署失败

1. `@lovable.dev/vite-tanstack-config` 默认带 Cloudflare 插件 → 构建出 `_worker.js` 而非 Node 入口
2. Zeabur 找不到 `node ...` 可启动文件 → 启动失败
3. `.env` 未同步 → 即使构建成功，运行时也因缺少 Supabase 变量而报错
4. `wrangler.jsonc` 让 Zeabur 误判为 Cloudflare 项目

---

## 五、可选方案

如果不想改 `vite.config.ts`，**最简单的部署方式**是：
- 直接用 Lovable 的"Publish"按钮发布（已有 `https://cai123.lovable.app`），无需 Zeabur
- 或部署到 **Cloudflare Pages / Workers**（与当前配置 100% 匹配，零改动）
- 或部署到 **Vercel / Netlify**（TanStack Start 官方支持，需要类似的 vite.config.ts 调整）

---

**下一步请告诉我选择哪种方案：**
1. 我帮你修改 `vite.config.ts` 适配 Zeabur（Node 服务器模式）
2. 改为部署到 Cloudflare Pages（零改动）
3. 改为部署到 Vercel/Netlify
