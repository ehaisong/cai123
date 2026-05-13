// 双产物构建：
//
// 1. 默认（Lovable 预览 / cai123.lovable.app）：产出 Cloudflare Worker bundle，
//    Lovable publish pipeline 必须有它，否则 Worker 启动报 `No such module "h3-v2"`。
//
// 2. 设置 BUILD_TARGET=node 时（Coolify 容器化部署到 66cai.site）：禁用
//    Cloudflare 插件，让 TanStack Start 输出 Node server bundle，可被
//    `node .output/server/index.mjs` 启动，让 `src/routes/api/public/*` 这些
//    server route 真正运行（出口 IP = 66cai.site 服务器 IP，已在 3ypay 白名单）。
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const isNodeBuild = process.env.BUILD_TARGET === "node";

export default defineConfig({
  cloudflare: isNodeBuild ? false : undefined,
  tanstackStart: isNodeBuild
    ? { target: "node-server" }
    : {
        spa: {
          enabled: true,
          prerender: { outputPath: "/index" },
        },
      },
});
