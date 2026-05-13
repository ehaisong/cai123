# 直连 3ypay 收银台改造方案

## 总体思路
彻底废弃 `gw.nrnc.net` 中转网关与微信 OAuth/openid 流程。前端只负责"创建订单 → 跳转 payInfo URL"；微信内/外的判断、JSAPI 拉起，全部交给 3ypay 官方收银台页面。

```text
浏览器(微信内/外)
  └─ POST /functions/v1/pay-create  (Edge Function, 带用户 JWT)
        ├─ 校验订单（payment_orders, status=pending）
        ├─ 读取 payment_channels.config（3ypay 凭据 + AUT productCode）
        ├─ 用 merchantPrivateKey 对 (公共参数+bizContent) RSA2 签名
        ├─ POST https://openapi.3ypay.com/openapi/order/pay/create
        ├─ 用 platformPublicKey 验签返回
        ├─ 解析 data.payInfo（或 payUrl）
        └─ 返回 { payUrl } 给前端
  └─ window.location.href = payUrl  (3ypay 收银台自动检测微信内 → 拉起 JSAPI)

3ypay 服务器
  └─ POST https://66cai.site/api/public/pay-notify
        ├─ 用 platformPublicKey 对 (公共参数+bizContent) 验签
        ├─ 解析 bizContent → mchOrderNo / state / orderAmount / payOrderNo
        ├─ state==2(成功) → mark_payment_paid RPC
        └─ 返回 "success"
```

## 1. 数据库
不改表，只在 `payment_channels.config` 上确立 3ypay 通道的 JSON 结构（管理员后台填写）：

```json
{
  "appId": "APP_01207327430",
  "mchNo": "M001876752001",
  "merchantPrivateKey": "-----BEGIN PRIVATE KEY-----\n...",
  "platformPublicKey": "-----BEGIN PUBLIC KEY-----\n...",
  "wechat": { "productCode": "T001930749833", "paySubType": "NATIVE" },
  "alipay": { "productCode": "A000558443631", "paySubType": "NATIVE" }
}
```
> 字段全部存在 `payment_channels` 行中，`provider="wechat"` / `provider="alipay"` 各建一条；也支持把两套 productCode 合并到一条 `provider="custom"` 下，由前端按 payType 选 productCode。我倾向 **一条 `provider="3ypay"` 通道，里面同时含 wechat/alipay 两套 productCode**，这样商家只需选一个支付通道。

## 2. 新增 Edge Function：`pay-create` (verify_jwt=true)
- 入参：`{ orderNo, payType: "wechat"|"alipay" }`
- 用 `SUPABASE_SERVICE_ROLE_KEY` 读 `payment_orders`、`payment_channels`
- 构造 bizContent：
  ```json
  {
    "mchOrderNo": orderNo,
    "productCode": cfg[payType].productCode,
    "paySubType": "NATIVE",
    "subject": order.subject,
    "orderAmount": order.amount,           // 元，两位小数
    "clientIp": req IP,
    "notifyUrl": "https://66cai.site/api/public/pay-notify",
    "redirectUrl": "https://66cai.site/pay/success?orderNo=" + orderNo
  }
  ```
- 公共参数 + bizContent 一起按 ASCII 排序拼 `key=value&...`，用 merchantPrivateKey RSA-SHA256 签名
- POST 到 `https://openapi.3ypay.com/openapi/order/pay/create`
- 校验响应 sign（platformPublicKey），解析 `data` JSON 字符串，取 `payInfo` 或 `payUrl` 字段
- 写一条 `payment_logs` 记录
- 返回 `{ payUrl }`

## 3. 改造 Server Route：`/api/public/pay-notify`
当前用的是 Supabase Edge Function `pay-notify`。改为：
- **保留** `supabase/functions/pay-notify`，但按 3ypay 官方格式重写（同时支持暴露在 `/api/public/pay-notify` 路径）
- 因为 3ypay 已加了我们 `66cai.site` 的白名单，配置成 `https://66cai.site/api/public/pay-notify` 由 TanStack Server Route 接收，再内部转给 Supabase Edge Function 处理。
- 验签：把请求体除 `sign/signType` 外的所有键按 ASCII 排序拼接 → RSA2 用 platformPublicKey 验
- 解析 `bizContent`（JSON 字符串），取 `mchOrderNo / state / orderAmount / payOrderNo`
- `state===2` 视为成功（按文档：1=待支付 2=成功 3=失败 4=已取消 5=已退款 …，会以实测为准）
- 金额校验（元，允许 0.01 误差）→ 调 `mark_payment_paid` RPC
- 必须返回纯文本 `success`

## 4. 改造前端 `src/lib/payment-service.ts`
大幅简化：
- 删除：OAuth 跳转、wx_openid、pending_wx_pay、JSAPI 兜底、emoji sanitize（subject 由后端处理）
- 保留：loading 遮罩、二维码遮罩（PC 浏览器场景仍可用）、`startPolling`、`checkPendingAlipay`、`showOpenInBrowserMask`
- `pay()` 新流程：
  1. 显示 loading
  2. `supabase.functions.invoke("pay-create", { body: { orderNo, payType } })`
  3. `window.location.href = data.payUrl`
- 微信内点支付宝仍提示"在浏览器打开"
- 删除 `resumeFromWxOAuthIfAny`，`__root.tsx` 移除调用

## 5. 后台 `admin.payment.tsx`
新增 provider 选项 `"3ypay"`，对应字段：
- 商户 AppId / 商户号 mchNo / 商户私钥 / 平台公钥 / 微信 productCode / 支付宝 productCode

## 待确认（如有任一项不对就改）
1. **响应字段名**：客服说"收银台是 payinfo"，文档示例 `payDataType:"payUrl"`。**计划同时兼容 `payInfo / payUrl / payData`，按出现顺序取**。
2. **state 成功值**：文档没明说，按 3ypay 通行约定 `state=2` 为成功。如不对，请告知正确值。
3. **3ypay 通道数据结构**：是否同意"一条通道里同时含 wechat+alipay productCode"（更简洁），而不是两条通道？

确认后我就按以上方案写代码，预计 5 处文件改动 + 1 个新 Edge Function。
