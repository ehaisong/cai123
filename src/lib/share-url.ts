import { supabase } from "@/integrations/supabase/client";

/**
 * 分享二维码 URL 构造器。
 *
 * 所有商家/代理/招募二维码都不直接指向生产域名，而是指向中转站。
 * 中转站维护多个生产域名，当某个被微信屏蔽时，运营在中转站后台切换主域名，
 * 之前已发出去的二维码依然有效。
 *
 * 中转站接口规范见 .lovable/plan.md：GET {base}/r?ref=<code>&to=<相对路径>
 */

const DEFAULT_RELAY_BASE = "https://wx.lovclaw.com";
const SETTING_KEY = "share_relay_base_url";

let cachedBase: string | null = null;
let loadingPromise: Promise<string> | null = null;

async function loadBase(): Promise<string> {
  if (cachedBase) return cachedBase;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    try {
      const { data } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", SETTING_KEY)
        .maybeSingle();
      const v = (data?.value as any)?.url;
      cachedBase = (typeof v === "string" && v.trim()) ? v.trim().replace(/\/+$/, "") : DEFAULT_RELAY_BASE;
    } catch {
      cachedBase = DEFAULT_RELAY_BASE;
    }
    return cachedBase!;
  })();
  return loadingPromise;
}

/** 同步获取已缓存的 base，未加载完则返回默认值。 */
export function getRelayBaseSync(): string {
  return cachedBase ?? DEFAULT_RELAY_BASE;
}

/** 触发 base 异步加载（用于在组件 useEffect 里预热）。 */
export function preloadRelayBase(): Promise<string> {
  return loadBase();
}

export interface BuildShareUrlOptions {
  /** 推广码：代理 user_code / `M_<merchantId>` / `admin` */
  ref?: string;
  /** 目标相对路径，必须以 `/` 开头，例如 `/shop/abc`、`/apply`。缺省视为 `/` */
  to?: string;
  /** 额外 query 参数 */
  extra?: Record<string, string>;
}

/** 同步构造分享链接（使用已缓存或默认 base）。 */
export function buildShareUrl(opts: BuildShareUrlOptions): string {
  const base = getRelayBaseSync();
  const u = new URL("/r", base);
  if (opts.ref) u.searchParams.set("ref", opts.ref);
  if (opts.to) {
    const to = opts.to.startsWith("/") ? opts.to : `/${opts.to}`;
    u.searchParams.set("to", to);
  }
  if (opts.extra) {
    for (const [k, v] of Object.entries(opts.extra)) u.searchParams.set(k, v);
  }
  return u.toString();
}
