// SPA-mode build for multi-platform deployment (Lovable / Zeabur / Vercel / Netlify / VPS).
//
// We turn OFF the Cloudflare Worker output and turn ON TanStack Start SPA mode,
// so `bun run build` produces a static `dist/client/` folder (index.html + assets)
// that any static host can serve. This unlocks failover by switching DNS between
// independent deployments — the original anti-blocking goal.
//
// All app data flows through the browser-side Supabase client; there are no
// `createServerFn` calls or `src/routes/api/*` routes, so dropping SSR/Worker
// loses nothing.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  cloudflare: false,
  tanstackStart: {
    spa: {
      enabled: true,
      // Emit the SPA shell as `index.html` so any static host serves it as the entry.
      // Without this override, TanStack Start writes `_shell.html`, which static
      // hosts (Zeabur / Vercel / Netlify / nginx) won't auto-serve.
      prerender: {
        outputPath: "/index",
      },
    },
  },
});
