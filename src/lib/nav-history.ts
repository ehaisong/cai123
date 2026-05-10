/**
 * 跟踪本会话内"在站内发生了多少次导航"。
 * 用于判定是否可以安全地 history.back()。
 *
 * 原因：当用户从微信聊天/扫码/外站直链直接进入某个内页时，
 * 浏览器历史的上一条不在本站，调用 history.back() 会被微信拦截
 * 显示"将要访问 ...，无法确认该网页的安全性"提示页，导致用户卡死。
 *
 * 思路：在 router 第一次完成导航后开始计数，count > 0 说明站内有
 * 可回退的历史，否则应改为跳转到一个已知的本站页面（如首页）。
 */

const KEY = "__inapp_nav_count__";

function read(): number {
  try {
    const v = sessionStorage.getItem(KEY);
    return v ? parseInt(v, 10) || 0 : 0;
  } catch {
    return 0;
  }
}
function write(n: number) {
  try {
    sessionStorage.setItem(KEY, String(n));
  } catch {
    /* noop */
  }
}

export function bumpInAppNav() {
  write(read() + 1);
}

export function canGoBackInApp(): boolean {
  return read() > 0;
}

export function consumeBack() {
  const n = read();
  if (n > 0) write(n - 1);
}
