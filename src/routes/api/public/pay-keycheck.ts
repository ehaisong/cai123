import { createFileRoute } from "@tanstack/react-router";

// 临时诊断接口：返回 THREEYPAY_MCH_PRIVATE_KEY 派生公钥的 SHA-256 指纹（DER+SPKI）
// 用完请删除。

function pemToDer(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function derivePublicSpkiDer(privateKeyPem: string): Promise<Uint8Array> {
  const der = pemToDer(privateKeyPem);
  const priv = await crypto.subtle.importKey(
    "pkcs8",
    der.buffer as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    true,
    ["sign"],
  );
  // 导出 JWK，再以公钥参数重新导入并 export 为 SPKI
  const jwk = (await crypto.subtle.exportKey("jwk", priv)) as JsonWebKey;
  const pubJwk: JsonWebKey = {
    kty: jwk.kty,
    n: jwk.n,
    e: jwk.e,
    alg: jwk.alg,
    ext: true,
  };
  const pub = await crypto.subtle.importKey(
    "jwk",
    pubJwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    true,
    ["verify"],
  );
  const spki = await crypto.subtle.exportKey("spki", pub);
  return new Uint8Array(spki);
}

export const Route = createFileRoute("/api/public/pay-keycheck")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const raw = process.env.THREEYPAY_MCH_PRIVATE_KEY || "";
          if (!raw) {
            return new Response(
              JSON.stringify({ ok: false, error: "secret missing" }),
              { status: 200, headers: { "content-type": "application/json" } },
            );
          }
          const wrapped = raw.includes("BEGIN")
            ? raw
            : `-----BEGIN PRIVATE KEY-----\n${raw.match(/.{1,64}/g)?.join("\n") ?? raw}\n-----END PRIVATE KEY-----`;
          const spki = await derivePublicSpkiDer(wrapped);
          const sha = await crypto.subtle.digest("SHA-256", spki.buffer as ArrayBuffer);
          const pubB64 = btoa(String.fromCharCode(...spki));
          return new Response(
            JSON.stringify({
              ok: true,
              privateKeyLen: raw.length,
              derivedPublicSha256: toHex(sha),
              derivedPublicBase64: pubB64,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        } catch (e) {
          return new Response(
            JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
      },
    },
  },
});
