// 13pay（pay.13pay.cn）签名/验签工具
// 文档：https://pay.13pay.cn/doc/index.html
// 算法：SHA256withRSA（sign_type=RSA），PKCS1v15 padding
// 待签字符串：剔除 sign / sign_type / 空值，按 key ASCII 升序，k=v&k=v 拼接（不 URL 编码）

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function bytesToBase64(bytes: ArrayBuffer): string {
  const b = new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

function base64ToBytes(b64: string): ArrayBuffer {
  const bin = atob(b64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export function buildSignContent13(params: Record<string, unknown>): string {
  const keys = Object.keys(params)
    .filter((k) => k !== "sign" && k !== "sign_type")
    .filter((k) => {
      const v = params[k];
      return v !== undefined && v !== null && v !== "";
    })
    .sort();
  return keys.map((k) => `${k}=${String(params[k])}`).join("&");
}

function wrapPrivatePem(pem: string): string {
  if (pem.includes("BEGIN")) return pem;
  const body = pem.replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g)?.join("\n") ?? body;
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`;
}

function wrapPublicPem(pem: string): string {
  if (pem.includes("BEGIN")) return pem;
  const body = pem.replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g)?.join("\n") ?? body;
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----`;
}

export async function sign13(
  params: Record<string, unknown>,
  privateKeyPem: string,
): Promise<string> {
  const content = buildSignContent13(params);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(wrapPrivatePem(privateKeyPem)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(content),
  );
  return bytesToBase64(sig);
}

export async function verify13(
  params: Record<string, unknown>,
  sign: string,
  publicKeyPem: string,
): Promise<boolean> {
  try {
    const content = buildSignContent13(params);
    const key = await crypto.subtle.importKey(
      "spki",
      pemToArrayBuffer(wrapPublicPem(publicKeyPem)),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      base64ToBytes(sign),
      new TextEncoder().encode(content),
    );
  } catch (e) {
    console.error("[13pay verify] error", e);
    return false;
  }
}
