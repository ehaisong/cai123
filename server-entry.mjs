
// server-entry.mjs
// Wraps TanStack Start's Web Fetch API handler to listen on a Node.js HTTP port
import http from "node:http";
import { Buffer } from "node:buffer";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.join(ROOT_DIR, "dist", "client");

const MIME_TYPES = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

// Dynamically import the built server bundle (ES module with default export { fetch })
const { default: app } = await import("./dist/server/server.js");

const fetchHandler = app.fetch;
if (typeof fetchHandler !== "function") {
  console.error("ERROR: dist/server/server.js does not export a fetch function. Got:", typeof fetchHandler, Object.keys(app));
  process.exit(1);
}

// Convert Node IncomingMessage -> Web Request
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

async function tryServeStatic(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (!url.pathname.startsWith("/assets/") && !url.pathname.startsWith("/favicon")) {
    return false;
  }

  const decodedPath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  const filePath = path.resolve(CLIENT_DIR, decodedPath);
  if (!filePath.startsWith(CLIENT_DIR + path.sep)) return false;

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return false;
    res.statusCode = 200;
    res.setHeader("Content-Type", MIME_TYPES[path.extname(filePath)] || "application/octet-stream");
    res.setHeader("Content-Length", fileStat.size);
    res.setHeader("Cache-Control", url.pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=300");
    if (req.method === "HEAD") {
      res.end();
      return true;
    }
    createReadStream(filePath).pipe(res);
    return true;
  } catch {
    return false;
  }
}

// Convert Web Response -> Node ServerResponse
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
    if (await tryServeStatic(req, res)) return;
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
});
