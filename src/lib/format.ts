import { format } from "date-fns";

export const fmtDate = (d: string | Date | null | undefined, pattern = "yyyy-MM-dd HH:mm") => {
  if (!d) return "—";
  try { return format(new Date(d), pattern); } catch { return String(d); }
};

export const fmtMoney = (v: number | string | null | undefined) => {
  const n = Number(v ?? 0);
  return `¥${n.toFixed(2)}`;
};
