// Hybrid build: keep the Cloudflare Worker output (required by Lovable's
// publish pipeline — without it, cai123.lovable.app returns 502 with
// `No such module "h3-v2"`) AND keep TanStack Start's SPA shell so static
// hosts (Zeabur / Vercel / Netlify / nginx) can serve `dist/client/` for
// failover. All app data flows through the browser-side Supabase client; no
// `createServerFn` calls or `src/routes/api/*` routes exist, so the Worker
// effectively just serves the SPA shell.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  // cloudflare defaults to true — required for Lovable publish.
  tanstackStart: {
    spa: {
      enabled: true,
      // Emit the SPA shell as `index.html` so static hosts auto-serve it.
      prerender: {
        outputPath: "/index",
      },
    },
  },
});
