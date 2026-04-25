import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export type RpcErrorContext = {
  /** RPC 函数名或操作标识，如 admin_recharge_user / review_application */
  op: string;
  /** 入参（敏感字段请脱敏） */
  payload?: Record<string, unknown>;
  /** 调用所在页面/组件 */
  scope?: string;
};

type SupabaseLikeError = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
  status?: number;
};

const isDev = import.meta.env.DEV;

/**
 * 统一上报 + toast。
 * - 控制台输出结构化日志（折叠组）便于调试
 * - 反馈给用户友好的中文提示
 * - 返回原 error 方便上层链式处理
 */
export function reportRpcError(error: unknown, ctx: RpcErrorContext): SupabaseLikeError {
  const e = (error ?? {}) as SupabaseLikeError;
  const msg = e.message || "未知错误";
  const code = e.code ? ` [${e.code}]` : "";
  const friendly = mapFriendlyMessage(e, ctx.op);

  // 控制台结构化日志
  try {
    // eslint-disable-next-line no-console
    console.groupCollapsed(`%c[RPC ✗] ${ctx.op}${code}`, "color:#dc2626;font-weight:bold");
    // eslint-disable-next-line no-console
    console.log("scope:", ctx.scope ?? "(unknown)");
    // eslint-disable-next-line no-console
    console.log("payload:", ctx.payload ?? {});
    // eslint-disable-next-line no-console
    console.log("error:", { message: e.message, code: e.code, details: e.details, hint: e.hint, status: e.status });
    if (isDev) {
      // eslint-disable-next-line no-console
      console.trace("stack");
    }
    // eslint-disable-next-line no-console
    console.groupEnd();
  } catch {
    /* noop */
  }

  toast.error(friendly, {
    description: isDev ? `${ctx.op}${code}: ${msg}` : undefined,
  });

  // 异步落库（best-effort，不阻塞 UI；表不存在则静默）
  void persistLog({ op: ctx.op, scope: ctx.scope, payload: ctx.payload, error: e });

  return e;
}

export function reportRpcSuccess(op: string, info?: Record<string, unknown>) {
  if (isDev) {
    // eslint-disable-next-line no-console
    console.log(`%c[RPC ✓] ${op}`, "color:#16a34a", info ?? "");
  }
}

function mapFriendlyMessage(e: SupabaseLikeError, op: string): string {
  const m = (e.message || "").toLowerCase();
  if (m.includes("permission denied") || m.includes("无权限") || e.code === "42501") return "无权限执行此操作";
  if (m.includes("row-level security") || m.includes("rls")) return "权限校验未通过 (RLS)";
  if (m.includes("未登录")) return "请先登录";
  if (m.includes("余额不足")) return "余额不足";
  if (m.includes("not found") || m.includes("不存在")) return "数据不存在";
  if (m.includes("duplicate") || e.code === "23505") return "数据重复";
  if (m.includes("type") && m.includes("does not match")) return `类型不匹配（${op}），请检查参数`;
  return e.message || `${op} 失败`;
}

async function persistLog(args: {
  op: string;
  scope?: string;
  payload?: Record<string, unknown>;
  error: SupabaseLikeError;
}) {
  try {
    const { data: u } = await supabase.auth.getUser();
    await supabase.from("client_error_logs" as never).insert({
      user_id: u.user?.id ?? null,
      op: args.op,
      scope: args.scope ?? null,
      payload: args.payload ?? {},
      error_message: args.error.message ?? null,
      error_code: args.error.code ?? null,
      error_details: args.error.details ?? null,
      error_hint: args.error.hint ?? null,
    } as never);
  } catch {
    /* 表可能不存在，忽略 */
  }
}
