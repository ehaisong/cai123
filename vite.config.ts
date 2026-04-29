// @lovable.dev/vite-tanstack-config 默认会启用 Cloudflare Workers 输出。
// 为了能在 Zeabur / Vercel / Node 容器等通用 Node.js 环境中运行，
// 这里关闭 Cloudflare 插件并指定 Node 构建目标。
//
// 部署到 Zeabur：
//   - Install:  npm install
//   - Build:    npm run build
//   - Start:    node .output/server/index.mjs
//   - 必须配置环境变量：VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY
//                     SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY / SUPABASE_SERVICE_ROLE_KEY
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  cloudflare: false,
  vite: {
    build: {
      target: "node20",
    },
  },
});
