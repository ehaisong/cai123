// server-entry.mjs
// Node HTTP wrapper for TanStack Start SSR
// - Serves dist/client/ static assets first (JS/CSS/images/favicon etc.)
// - Falls through to TanStack fetch handler for everything else (SSR / API)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const CLIENT_DIR = path.join(__dirname, "dist", "client");

// MIME type map
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".woff": "font/woff",
  ".woff2":"font/woff2",
  ".ttf":  "font/ttf",
  ".webp": "image/webp",
  ".txt":  "text/plain",
  ".xml":  "application/xml",
};

function tryServeStatic(req, res) {
  const url = req.url.split("?")[0]; // strip query string
  const filePath = path.join(CLIENT_DIR, url);

  // Security: prevent path traversal
  if (!filePath.startsWith(CLIENT_DIR)) return false;

  // Only serve if file exists
  let stat;
  try { stat = fs.statSync(filePath); } catch { return false; }
  if (!stat.isFile()) return false;

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || "application/octet-stream";

  // Long-lived cache for hashed assets (assets/), no-cache for others
  const isHashed = url.startsWith("/assets/");
  res.setHeader("Content-Type", mime);
  res.setHeader("Cache-Control", isHashed
    ? "public, max-age=31536000, immutable"
    : "no-cache");
  res.setHeader("Content-Length", stat.size);
  res.statusCode = 200;
  fs.createReadStream(filePath).pipe(res);
  return true;
}

// Load TanStack fetch handler
const { default: app } = await import("./dist/server/server.js");
const fetchHandler = app.fetch;
if (typeof fetchHandler !== "function") {
  console.error("ERROR: dist/server/server.js does not export a fetch function.");
  process.exit(1);
}

function nodeToWebRequest(req) {
  const host = req.headers["host"] || `localhost:${PORT}`;
  const url = `http://${host}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  }
  const method = req.method || "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  let body = undefined;
  if (hasBody) {
    body = new ReadableStream({
      start(controller) {
        req.on("data", (chunk) => controller.enqueue(chunk));
        req.on("end", () => controller.close());
        req.on("error", (e) => controller.error(e));
      }
    });
  }
  return new Request(url, { method, headers, body, duplex: "half" });
}

async function webToNodeResponse(webRes, res) {
  res.statusCode = webRes.status;
  for (const [k, v] of webRes.headers.entries()) {
    res.setHeader(k, v);
  }
  if (webRes.body) {
    const reader = webRes.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  }
  res.end();
}

const server = http.createServer(async (req, res) => {
  try {
    // 1. Try static files first
    if (tryServeStatic(req, res)) return;

    // 2. Fall through to TanStack SSR handler
    const webReq = nodeToWebRequest(req);
    const webRes = await fetchHandler(webReq);
    await webToNodeResponse(webRes, res);
  } catch (err) {
    console.error("Request error:", err);
    res.statusCode = 500;
    res.end("Internal Server Error");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
  console.log(`Static assets served from: ${CLIENT_DIR}`);
});
