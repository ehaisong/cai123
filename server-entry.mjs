
// server-entry.mjs
// Wraps TanStack Start's Web Fetch API handler to listen on a Node.js HTTP port
import http from "node:http";
import { Buffer } from "node:buffer";

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";

// Dynamically import the built server bundle (ES module with default export { fetch })
const { default: app } = await import("./dist/server/server.js");

const fetchHandler = app.fetch;
if (typeof fetchHandler !== "function") {
  console.error("ERROR: dist/server/server.js does not export a fetch function. Got:", typeof fetchHandler, Object.keys(app));
  process.exit(1);
}

// Convert Node IncomingMessage -> Web Request
function nodeToWebRequest(req) {
  const protocol = "https";
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
