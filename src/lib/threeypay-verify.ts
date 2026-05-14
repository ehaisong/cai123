// 3ypay 异步通知验签（服务端使用，Web Crypto API）
// 必须与 supabase/functions/_shared/threeypay.ts 保持算法一致

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

function base64ToBytes(b64: string): ArrayBuffer {
  const bin = atob(b64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

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

function bytesToBase64(bytes: ArrayBuffer): string {
  const b = new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

export async function signRSA2(
  params: Record<string, unknown>,
  privateKeyPem: string,
): Promise<string> {
  const content = buildSignContent(params);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKeyPem),
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

export async function verifyRSA2(
  params: Record<string, unknown>,
  sign: string,
  publicKeyPem: string,
): Promise<boolean> {
  try {
    const wrapped = publicKeyPem.includes("BEGIN")
      ? publicKeyPem
      : `-----BEGIN PUBLIC KEY-----\n${publicKeyPem.match(/.{1,64}/g)?.join("\n") ?? publicKeyPem}\n-----END PUBLIC KEY-----`;
    const key = await crypto.subtle.importKey(
      "spki",
      pemToArrayBuffer(wrapped),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const content = buildSignContent(params);
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
