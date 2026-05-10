## 目标

把所有商家 / 代理 / 招募二维码从"直接指向生产域名"改为"指向中转站 wx.lovclaw.com"，再由中转站 302 到当前生效的生产域名。这样即使某个生产域名被微信屏蔽，运营在中转站后台切换主域名后，**之前已发出去的二维码依然有效**。

---

## 一、本站这边要做的改动

### 1. 新增统一二维码 URL 生成函数
新建 `src/lib/share-url.ts`，导出：

```ts
buildShareUrl({ ref?, to? })  // 返回 https://wx.lovclaw.com/r?ref=XXX&to=%2Fshop%2Fxxx
```

- 中转站 base 默认硬编码 `https://wx.lovclaw.com`，同时支持通过 `app_settings.share_relay_base_url` 覆盖（管理员可改，方便将来更换中转站）
- `ref`：代理推广码 / `M_<merchantId>` / `admin`
- `to`：可选目标相对路径（如 `/shop/<merchantId>`、`/apply`）；中转站会拼到选中的生产域名后

### 2. 改造现有 4 个二维码生成入口
全部改用 `buildShareUrl`：

| 文件 | 当前 URL | 改为 |
|---|---|---|
| `src/routes/agent_.share.tsx`（代理推广码） | `${origin}/?ref=<code>` | `buildShareUrl({ ref: code })` |
| `src/routes/agent_.share.tsx`（店铺直推码） | `${origin}/?ref=M_<mid>` | `buildShareUrl({ ref: 'M_'+mid, to: '/shop/'+mid })` |
| `src/routes/merchant.qrcode.tsx` | `${origin}/shop/<mid>?ref=M_<mid>` | `buildShareUrl({ ref: 'M_'+mid, to: '/shop/'+mid })` |
| `src/routes/admin.merchant-recruit.tsx` | `${origin}/apply?ref=admin` | `buildShareUrl({ ref: 'admin', to: '/apply' })` |

显示在二维码下方的"链接预览"也同步改成中转站 URL。

### 3. 管理后台加一个迷你设置入口（可选但推荐）
在 `admin.settings.tsx` 增加一个"分享中转站"小卡片，仅一个字段：
- **分享中转站 Base URL**（默认 `https://wx.lovclaw.com`）

存到 `app_settings` 的 `share_relay_base_url` key。万一以后要换中转站域名，不用发版。

### 4. 不动的部分
- 生产域名上现有的 `/?ref=` 解析逻辑（`src/routes/index.tsx`）保持不变 —— 中转站 302 过来时依旧带 `ref`，已有的"匿名暂存 → 登录后 bind_referrer"链路完全复用
- `auth-context` 里的 `SIGNED_IN` 自动绑定逻辑不动
- 微信/手机登录走中转站的现有流程不动

---

## 二、中转站 wx.lovclaw.com 这边的最小实现规范（交给中转站项目实现）

### 路由：`GET /r`

**入参（query）：**
- `ref`（可选）：推广码，原样透传
- `to`（可选）：目标相对路径，如 `/shop/abc123`、`/apply`。若缺省则视为 `/`
- 其它 query 参数全部原样透传

**逻辑：**
1. 从中转站自身配置读取 `domains` 列表 + `active` 当前主域名（例：`["66cai.site","cai123.lovable.app"]`，active = `66cai.site`）
2. 拼接目标 URL：`https://{active}{to || '/'}` + 合并所有 query
3. 返回 `302` 跳转
4. 如果检测到 UA 是微信浏览器，可在中转页停留半秒展示一段"正在跳转，请稍候…"防止某些微信版本对 302 的拦截（可选优化）

**中转站需要的后台能力（中转站自己实现，不在本站）：**
- 一个域名列表配置：`[{ domain, enabled, isPrimary }]`
- 切换主域名一键操作；被屏蔽的域名置为 `enabled=false`
- 建议加一个简单的探活：定期请求每个域名的 `/health`，自动把 5xx/超时的域名标灰，但**只切换主域名要求人工确认**

**安全：**
- `to` 必须以 `/` 开头且不含 `://`，防止开放跳转漏洞
- `to` 长度限制（≤ 200 字符）
- query 透传时丢弃 `Host`、`Origin` 等敏感字段（query 本就不会有，主要是 header 不要透传）

### 可选附加路由：`GET /health`
返回 `{ ok: true, active: "66cai.site", ts: ... }`，方便人工/监控查看当前指向。

---

## 三、回滚 / 兼容性

- 旧二维码：按你的选择，**不做兼容**。生产域名上 `/?ref=` 解析逻辑保留（不删除），所以未被屏蔽的旧域名上的旧码还能用；被屏蔽的旧码自然失效
- 本次发版后，所有"分享/下载/复制"得到的链接都自动是中转站链接

---

## 技术细节备忘

- 中转站 base 取值优先级：`app_settings.share_relay_base_url` > 硬编码 `https://wx.lovclaw.com`
- `buildShareUrl` 内部用 `URL` + `searchParams` 组装，避免拼接错误
- `share-url.ts` 异步读取 setting 一次后缓存到 module 级变量，避免每次生成二维码都查库；首次未加载完用默认值
- 二维码下方"链接预览"展示中转站短链，让用户/代理一眼看出指向的是中转站
- 不需要数据库迁移（除非你希望把 `share_relay_base_url` 显式插入一条默认值；用 `useSettingObject` 的 defaults 机制就够了）
