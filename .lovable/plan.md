# 用 Unimatrix 替换阿里云短信

## 目标
- 移除阿里云短信相关代码与签名逻辑
- 使用 Unimatrix 的 `otp.send` / `otp.verify` 接口完成手机验证码登录
- Unimatrix 自带 OTP 生成与校验能力，无需本地哈希存储验证码

## 接入点
- Base: `https://api-cn.unimtx.com`
- 鉴权（简易模式）：URL Query 传 `accessKeyId`
- `POST /?action=otp.send&accessKeyId=...` body: `{ to: "+86xxxxxxxxxxx", signature: "签名", intent: "login" }`
- `POST /?action=otp.verify&accessKeyId=...` body: `{ to, code, intent: "login" }`，返回 `data.valid`

## 需要的 Secrets
- `UNIMTX_ACCESS_KEY_ID`
- `UNIMTX_SIGNATURE`（中国大陆号码必填，2-16 字符，控制台申请）

旧的可清理：`ALIYUN_SMS_ACCESS_KEY_ID` / `ALIYUN_SMS_ACCESS_KEY_SECRET` / `ALIYUN_SMS_SIGN_NAME` / `ALIYUN_SMS_TEMPLATE_CODE`（保留到平台后台手动删除即可，不影响代码）

## 改动文件

### `supabase/functions/sms-send/index.ts`（重写）
- 删除阿里云签名/HMAC/percentEncode 等所有逻辑
- 删除本地生成 6 位验证码及 `code_hash` 写入
- 保留 `sms_codes` 表用于"60 秒/1 小时"频次限制（仅记录手机号 + 时间戳，code_hash 写入空字符串或随机占位）
- 调用 `otp.send`：`{ to: "+86" + phone, signature: UNIMTX_SIGNATURE, intent: "login" }`
- 失败时把 Unimatrix 错误 `code/message` 透传给前端友好提示

### `supabase/functions/sms-verify/index.ts`（改造）
- 不再查询 `sms_codes` 与本地 sha256 比较
- 调用 `otp.verify`：`{ to: "+86"+phone, code, intent: "login" }`，依据 `data.valid` 决定通过
- 通过后保留原有逻辑：`find_user_by_phone` → 创建用户 → 附加 email → 生成 magiclink token

### `supabase/config.toml`
保持现状（两个函数已 `verify_jwt = false`）

### 数据库
不变。`sms_codes` 表继续用于发送频次限制，无需迁移。

## 验证步骤
1. 部署 `sms-send` / `sms-verify`
2. `curl_edge_functions` 用真实手机号触发 `sms-send`，确认返回 `ok:true`
3. 用收到的验证码触发 `sms-verify`，确认登录成功
4. 检查 edge function 日志无报错

## 待确认
请先在 Unimatrix 控制台申请好短信签名（中国大陆号码必填），并准备 `AccessKey ID`。批准后我会请求添加 `UNIMTX_ACCESS_KEY_ID` 和 `UNIMTX_SIGNATURE` 两个 secrets。
