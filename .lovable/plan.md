# 直接对接 3ypay 支付接入计划

不再依赖中转网关 `gw.nrnc.net`，直接从我们自己的 TanStack Start 服务端调用 3ypay `https://openapi.3ypay.com`，签名/验签都在本站完成。

## 一、最终用户流程

### 微信内（JSAPI）
1. 用户在微信内点"立即购买"。
2. 前端 → `GET /api/public/pay/wx-start?orderNo=…` ，服务端 302 跳转到微信 OAuth：
   `https://open.weixin.qq.com/connect/oauth2/authorize?appid={公众号AppId}&redirect_uri={站点}/api/public/pay/wx-callback&response_type=code&scope=snsapi_base&state={orderNo}#wechat_redirect`
3. 微信回调 `/api/public/pay/wx-callback?code=…&state=orderNo`：
   - 用 code 换 `openid`（缓存 5 分钟，避免来回扫表）
   - 用 RSA2 签名调用 3ypay `/openapi/order/pay/create`，参数：
     `productCode=WeChat-PAY, paySubType=JSAPI, extra:{ subAppId, userId: openid }`
   - 取响应 `data.payInfo`（含 appId/timeStamp/nonceStr/package/signType/paySign）
   - 302 跳转到 `/pay/invoke?orderNo=…&payInfo=…`
4. `/pay/invoke` 页面执行 `WeixinJSBridge.invoke('getBrandWCPayRequest', payInfo)` 唤起微信支付；成功后跳到 `/pay/success?orderNo=…`，前端继续轮询订单状态。

### 微信外浏览器（支付宝 APP / H5）
1. 前端 → `POST /api/public/pay/create { orderNo, payType:'alipay' }`。
2. 服务端签名调用 3ypay：`productCode=Ali-PAY, paySubType=H5`，得到 `payDataType=payUrl, payInfo={alipayUrl}`。
3. 服务端返回 `{ payUrl }`，前端 `location.href = payUrl` → 自动唤起支付宝 APP（无 APP 时降级到 H5 网页）。

### 异步通知
- 3ypay → `POST /api/public/pay-notify`：用平台公钥 RSA2 验签 → 校验金额 → 调用现有 `mark_payment_paid` RPC → 返回 `{"code":"SUCCESS"}`。

## 二、需要用户提供的密钥（用 `secrets--add_secret` 收集）

| 名称 | 用途 | 哪里取 |
|---|---|---|
| `THREEYPAY_APP_ID` | 3ypay 应用 ID | 商户后台-应用管理 |
| `THREEYPAY_MCH_PRIVATE_KEY` | 商户 RSA2 私钥（PKCS#8 PEM） | 自己生成密钥对，公钥上传到 3ypay |
| `THREEYPAY_PLATFORM_PUBLIC_KEY` | 3ypay 平台 RSA 公钥 | 商户后台-密钥管理 |
| `WECHAT_OA_APPID` | 微信公众号 AppId（用作 subAppId + OAuth） | 微信公众平台 |
| `WECHAT_OA_SECRET` | 公众号 AppSecret（换 openid） | 微信公众平台 |

## 三、要写/改的文件

新增：
- `src/lib/threeypay.server.ts` — RSA2 签名/验签、`createOrder()`、`queryOrder()`、`exchangeWxOpenid()`
- `src/routes/api.public.pay.create.ts` — 支付宝 H5 创建订单
- `src/routes/api.public.pay.wx-start.ts` — 跳转微信 OAuth
- `src/routes/api.public.pay.wx-callback.ts` — 拿 code → openid → 创建 JSAPI 订单 → 跳 /pay/invoke
- `src/routes/pay.invoke.tsx` — 执行 `WeixinJSBridge.invoke`

改动：
- `src/lib/payment-service.ts` — 删除 `gw.nrnc.net` 调用；微信走 `wx-start`，支付宝走 `pay/create`
- `src/routes/api.public.pay-notify.ts` — 接收 3ypay 通知字段（`mchOrderNo, payOrderNo, state, payAmount, sign`），RSA2 验签，按 state=3 标记 paid
- `src/routes/pay.test.tsx` — 文案微调（提示直接对接 3ypay）

不动：
- 数据库（`payment_orders`、`mark_payment_paid` RPC、`create_payment_order`）保持现状
- `/pay/success` 轮询逻辑保持现状
- `/product/$productId` 购买逻辑（走钱包余额）保持现状 —— 等测试支付通过后再决定是否改造为"先充值再下单"或"下单直接拉起 3ypay"

## 四、技术细节

- 签名：把 appId/version/timestamp/requestId/signType/charset/bizContent(JSON 字符串) 按字典序拼 `key=value&…`，RSA2(SHA256withRSA) 私钥签名 → base64
- 验签同理，平台公钥
- `clientIp`：从 `x-forwarded-for` 取
- `notifyUrl`：固定为 `https://66cai.site/api/public/pay-notify`
- WeChat JSAPI subject 不能含特殊字符；保留前 32 字
- `redirectUrl`：`/pay/success?orderNo=…`

## 五、验收

1. 微信内打开 `/pay/test` → 微信支付 → 走完 OAuth → 唤起微信支付窗 → 成功后 /pay/success 显示已支付
2. 浏览器（非微信）打开 `/pay/test` → 支付宝支付 → 唤起支付宝 APP → 成功后回跳 /pay/success
3. 服务端日志能看到 3ypay 通知，并且订单在数据库被标记 `paid`

测试通过后再把同样的 `PaymentService.pay()` 接到 `/product/$productId` 的购买按钮。

## 六、待你确认

1. 五个密钥（上表）是否都已就绪？我会在你确认计划后用安全表单逐个收集。
2. 微信公众号 OAuth 回调域名需要在公众号后台"网页授权域名"白名单里加 `66cai.site`（不带协议、不带路径）—— 你那边能配置吗？
3. 3ypay 后台需要配置授权目录 `https://66cai.site/`，并在商户后台绑定上面那个公众号 AppId 作为 subAppId。
