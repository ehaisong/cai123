// deno-lint-ignore-file no-explicit-any
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RELAY = "https://wx.lovclaw.com";

function normalizePhoneCN(input: string): string | null {
  const digits = (input ?? "").replace(/\D/g, "");
  const local = digits.startsWith("86") ? digits.slice(2) : digits;
  if (!/^1\d{10}$/.test(local)) return null;
  return local;
}

const j = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function relay(path: string, body: Record<string, unknown>) {
  const client = Deno.env.get("SMS_RELAY_CLIENT");
  const secret = Deno.env.get("SMS_RELAY_CLIENT_SECRET");
  if (!client || !secret) {
    return { status: 500, json: { ok: false, error: "relay_not_configured", message: "短信中转站未配置凭据" } };
  }
  const r = await fetch(`${RELAY}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client, client_secret: secret, ...body }),
  });
  const text = await r.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  return { status: r.status, json: json ?? { ok: false, message: text } };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ ok: false, message: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const phone = normalizePhoneCN(String(body.phone ?? ""));
    let sid: string | undefined = body.sid ? String(body.sid) : undefined;
    if (!phone) return j({ ok: false, message: "请输入正确的手机号" });

    // 申请 sid（若客户端未带）
    if (!sid) {
      const start = await relay("/api/public/sms/start", { return_path: "/" });
      if (!start.json?.ok || !start.json?.sid) {
        console.error("[sms-send] start fail", start);
        return j({ ok: false, message: start.json?.message ?? "无法创建会话" }, start.status);
      }
      sid = start.json.sid as string;
    }

    const send = await relay("/api/public/sms/send", { sid, phone: `+86${phone}` });
    if (!send.json?.ok) {
      console.error("[sms-send] send fail", send);
      const msg = send.json?.error === "rate_limited"
        ? `请 ${send.json?.retry_after ?? 60} 秒后重试`
        : (send.json?.message ?? send.json?.error ?? "发送失败");
      return j({ ok: false, message: msg, sid }, send.status);
    }

    return j({ ok: true, sid, cooldown: send.json?.cooldown ?? 60 });
  } catch (e) {
    console.error("[sms-send] exception", e);
    return j({ ok: false, message: e instanceof Error ? e.message : "服务异常" }, 500);
  }
});
