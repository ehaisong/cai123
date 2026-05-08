import { supabase } from "@/integrations/supabase/client";

export type PayLogStage =
  | "create_request"
  | "create_response"
  | "create_error"
  | "jsapi_invoke"
  | "jsapi_result"
  | "oauth_redirect"
  | "oauth_resume"
  | "client_ip"
  | "user_action"
  | "error";

export type PayLogLevel = "info" | "warn" | "error";

export interface PayLogInput {
  orderNo?: string | null;
  stage: PayLogStage;
  level?: PayLogLevel;
  message?: string;
  payload?: Record<string, unknown>;
}

/** 异步、不阻塞业务的支付日志埋点 */
export function logPayment(input: PayLogInput): void {
  const row = {
    order_no: input.orderNo ?? null,
    user_id: null,
    source: "frontend",
    stage: input.stage,
    level: input.level ?? "info",
    message: input.message ?? null,
    payload: input.payload ?? {},
    user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
  };
  try {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/payment_logs`;
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    void fetch(url, {
      method: "POST",
      keepalive: true,
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    });
  } catch {
    // ignore
  }
  // 同步控制台日志，便于实时调试
  // eslint-disable-next-line no-console
  console.log(`[pay-log][${input.stage}]`, input.message ?? "", input.payload ?? {});
}
