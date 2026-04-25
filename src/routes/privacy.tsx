import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/h5/page-header";

export const Route = createFileRoute("/privacy")({
  component: () => (
    <div className="h5-shell">
      <PageHeader title="隐私协议" />
      <div className="bg-card m-3 p-4 rounded-xl text-sm text-muted-foreground leading-relaxed space-y-2">
        <p>本平台尊重并保护所有用户的个人隐私。</p>
        <p>1. 我们仅收集为提供服务所必需的信息（账号、联系方式、交易记录）。</p>
        <p>2. 未经您的同意，我们不会向第三方披露您的个人信息。</p>
        <p>3. 您有权随时访问、修改或删除自己的账户信息。</p>
        <p>4. 平台所提供的内容仅供参考，请理性消费、遵守当地法律法规。</p>
      </div>
    </div>
  ),
});
