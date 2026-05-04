import { format } from "date-fns";

export const fmtDate = (d: string | Date | null | undefined, pattern = "yyyy-MM-dd HH:mm") => {
  if (!d) return "—";
  try { return format(new Date(d), pattern); } catch { return String(d); }
};

// 全站统一展示为「积分」单位（数据库仍按数值存储）
export const fmtMoney = (v: number | string | null | undefined) => {
  const n = Number(v ?? 0);
  return `${n.toFixed(2)} 积分`;
};

// 短格式（用于价格按钮等紧凑场景）
export const fmtCredits = (v: number | string | null | undefined) => {
  const n = Number(v ?? 0);
  // 整数省略小数位
  return `${Number.isInteger(n) ? n : n.toFixed(2)} 积分`;
};
