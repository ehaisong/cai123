import { format } from "date-fns";

export const fmtDate = (d: string | Date | null | undefined, pattern = "yyyy-MM-dd HH:mm") => {
  if (!d) return "—";
  try { return format(new Date(d), pattern); } catch { return String(d); }
};

// 全站统一展示为人民币（¥）。
export const fmtMoney = (v: number | string | null | undefined) => {
  const n = Number(v ?? 0);
  return `¥${n.toFixed(2)}`;
};

// 短格式（紧凑场景，整数省略小数位）
export const fmtCredits = (v: number | string | null | undefined) => {
  const n = Number(v ?? 0);
  return `¥${Number.isInteger(n) ? n : n.toFixed(2)}`;
};
