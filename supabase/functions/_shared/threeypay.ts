// 3ypay 官方接口签名/验签工具（Deno / Web Crypto）
// 文档：https://doc.3ypay.com/doc-8005019
//
// 算法：RSA2 = SHA256withRSA (RSASSA-PKCS1-v1_5)
// 待签字符串规则：
//   1. 取所有公共参数 + bizContent（bizContent 为 JSON 字符串）
//   2. 剔除 sign / 空值 / null
//   3. 按 key ASCII 升序排序
//   4. 拼接 key=value，用 & 连接（VALUE 不做 URL 编码）

// ---------- PEM ↔ ArrayBuffer ----------

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

// ---------- 待签字符串 ----------

function stringifySorted(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stringifySorted(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => {
      const v = obj[k];
      return v !== undefined && v !== null && v !== "";
    })
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stringifySorted(obj[k])}`).join(",")}}`;
}

export function buildSignContent(params: Record<string, unknown>): string {
  const keys = Object.keys(params)
    .filter((k) => k !== "sign")
    .filter((k) => {
      const v = params[k];
      return v !== undefined && v !== null && v !== "";
    })
    .sort();
  return keys
    .map((k) => {
      const value = params[k];
      return `${k}=${typeof value === "object" ? stringifySorted(value) : String(value)}`;
    })
    .join("&");
}

// ---------- 签名 ----------

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // 兼容 PKCS#8 / PKCS#1。3ypay 文档示例为 PKCS#8（BEGIN PRIVATE KEY）
  const buf = pemToArrayBuffer(pem);
  return await crypto.subtle.importKey(
    "pkcs8",
    buf,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function importPublicKey(pem: string): Promise<CryptoKey> {
  const wrapped = pem.includes("BEGIN")
    ? pem
    : `-----BEGIN PUBLIC KEY-----\n${pem.match(/.{1,64}/g)?.join("\n") ?? pem}\n-----END PUBLIC KEY-----`;
  const buf = pemToArrayBuffer(wrapped);
  return await crypto.subtle.importKey(
    "spki",
    buf,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

export async function signRSA2(
  params: Record<string, unknown>,
  privateKeyPem: string,
): Promise<string> {
  const content = buildSignContent(params);
  const key = await importPrivateKey(privateKeyPem);
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(content),
  );
  return bytesToBase64(sig);
}

export async function verifyRSA2(
  params: Record<string, unknown>,
  sign: string,
  publicKeyPem: string,
): Promise<boolean> {
  try {
    const content = buildSignContent(params);
    const key = await importPublicKey(publicKeyPem);
    return await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      base64ToBytes(sign),
      new TextEncoder().encode(content),
    );
  } catch (e) {
    console.error("[3ypay verify] error", e);
    return false;
  }
}
