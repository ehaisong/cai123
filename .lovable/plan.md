## 结论

按彩虹易支付（Epay）**MD5 + mapi.php** 协议重写 13pay 对接。不需要 openid，"sub_openid 不能为空"是之前错走 RSA JSAPI 接口的副作用。微信内体验：**点付款 → 整页跳到 13pay 收银台 → 付完 13pay 自动回跳 `https://wordpro.cn/pay/return?orderNo=...` → 该页轮询订单状态 → 显示成功**。不使用 iframe（X-Frame-Options / 微信内 iframe 唤起支付不稳定）。

## 文件改动

### 新增 `src/lib/epay-sign.ts`
- 纯 JS MD5 实现（约 30 行，workerd 的 `crypto.subtle` 不支持 MD5）
- 导出 `md5(s)` / `signEpay(params, key)` / `verifyEpay(params, sign, key)`
- 签名规则：剔除 `sign`/`sign_type`/空值 → key ASCII 升序 → `k=v&k=v` 拼接 → 末尾追加 `key`（直接拼字符串，不加 `&`）→ MD5 小写

### 改写 `src/routes/api/public/pay-13pay-create.ts`
- 通道配置改读：`apiBase`（如 `https://pay.13pay.cn/`，需以 `/` 结尾，缺时自动补）/ `pid` / `key` / `siteName`
- 构造参数：`{pid, type:'wxpay'|'alipay', device:'wechat'|'mobile'|'pc', clientip, notify_url, return_url, out_trade_no, name, money, sitename?}`
- MD5 签名 → `POST {apiBase}mapi.php`（`application/x-www-form-urlencoded`）
- 解析 `code===1`：优先取 `payurl`（跳转）→ `qrcode`（二维码）→ `urlscheme`（小程序）；否则透传 `msg`
- 返回 `{ success, payType:'jump'|'qrcode'|'scheme', payUrl, qrcode, tradeNo }`，**删除 `jsApiParams`**
- 保留 UA / 15s 超时 / 一次重试

### 改写 `src/routes/api/public/pay-13pay-notify.ts`
- 读 **GET 查询串**（彩虹易支付的 notify 是 GET）
- 用 `key` 重算 MD5 验签
- 验签通过 + `trade_status === 'TRADE_SUCCESS'` + 金额校验 → `mark_payment_paid` → 返回**纯文本 `success`**；否则 `fail`
- 全程写 `payment_logs`

### 改写 `src/routes/pay.test-13pay.tsx`
- 删除 WeixinJSBridge / JSAPI 直拉逻辑
- 流程：创建订单 → 调 create 接口 → 拿 `payUrl` → 顶部提示"即将跳转到 13pay 安全收银台，付完会自动返回本站"→ 1 秒后 `window.location.href = payUrl`
- 微信外若返回 `qrcode` 则展示二维码图片
- 文案更新："此通道走跳转支付。付款后页面会自动回跳到 `/pay/return`，无需手动重新打开。"

### 改 `src/routes/pay.return.tsx`
- 已存在；确认会读 `?orderNo=` 并调 `PaymentService.startPolling` 等异步通知，把成功 UI 显示出来。如果当前没启动轮询则补上（≤2 min，每 2.5s 一次）。

### 改 `src/routes/pc.payments.tsx`
- `channelFields["13pay"]` 改为：
  - `apiBase`（默认 `https://pay.13pay.cn/`）
  - `pid`（商户 ID）
  - `key`（**MD5 商户密钥/通讯密钥**，password 类型）
  - `siteName`（可选，传给 13pay 用于收银台显示）
- 移除 `merchantPrivateKey` / `platformPublicKey` 字段（旧数据保留在 JSON 不影响）

### `src/lib/thirteenpay.ts`
- 顶部加 `@deprecated` 注释，保留备用（万一以后真要做 13pay 公众号 JSAPI）

## 你需要做的事
1. 计划通过后我会落地代码。
2. 落地后请到 **PC 管理后台 → 支付通道 → 编辑 13pay**，把字段重新填一遍：
   - apiBase：`https://pay.13pay.cn/`
   - pid：你的商户 ID
   - **key：13pay 后台"通讯密钥(MD5)"那串字符**（不是 RSA 私钥）
   - siteName：可选
3. 在微信内打开 `/pay/test-13pay`，1 元测试。

无数据库迁移；如果你确认 MD5 密钥已就绪，回复"开干"我就开始改。
