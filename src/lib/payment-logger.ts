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
  try {
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : null;
    void supabase.auth.getUser().then(({ data }) => {
      void supabase.from("payment_logs" as never).insert({
        order_no: input.orderNo ?? null,
        user_id: data.user?.id ?? null,
        source: "frontend",
        stage: input.stage,
        level: input.level ?? "info",
        message: input.message ?? null,
        payload: input.payload ?? {},
        user_agent: ua,
      } as never);
    });
  } catch {
    // ignore
  }
  // 同步控制台日志，便于实时调试
  // eslint-disable-next-line no-console
  console.log(`[pay-log][${input.stage}]`, input.message ?? "", input.payload ?? {});
}
