import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/h5/page-header";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
  head: () => ({
    meta: [
      { title: "隐私权政策 · 预马当先" },
      { name: "description", content: "预马当先隐私权政策：我们如何收集、使用和保护您的个人信息。" },
    ],
  }),
});

function PrivacyPage() {
  return (
    <div className="h5-shell min-h-screen bg-muted">
      <PageHeader title="隐私权政策" />

      <article className="mx-3 my-3 space-y-5 rounded-2xl bg-card p-5 text-sm leading-7 text-foreground shadow-sm">
        <header className="space-y-1">
          <h1 className="text-base font-bold">预马当先隐私权政策</h1>
          <p className="text-xs text-muted-foreground">最后更新：2026 年 5 月 4 日</p>
        </header>

        <p className="text-muted-foreground">
          预马当先（以下简称「我们」「本平台」）非常重视您的个人信息和隐私保护。本政策将帮助您了解我们如何收集、使用、存储和保护您的个人信息，以及您所享有的相关权利。请您在使用本平台服务前仔细阅读并充分理解本政策。
        </p>

        <Section title="一、我们收集的信息">
          <p>为向您提供服务，我们将在以下情形收集您的相关信息：</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>账号注册：手机号码、微信 OpenID、昵称、头像；</li>
            <li>身份与店铺：商家审核所需的姓名、店铺名称、联系方式、头像图片；</li>
            <li>交易与钱包：积分充值、消费、提现、推广佣金等记录；</li>
            <li>设备与日志：访问 IP、浏览器类型、访问时间、操作日志（用于安全风控）。</li>
          </ol>
        </Section>

        <Section title="二、我们如何使用信息">
          <ol className="list-decimal space-y-1 pl-5">
            <li>用于完成账号注册、登录、身份核验；</li>
            <li>用于完成订单、积分结算、佣金分润和提现；</li>
            <li>用于改善平台体验、客服支持与故障排查；</li>
            <li>用于满足法律法规及监管部门的合规要求。</li>
          </ol>
        </Section>

        <Section title="三、信息的共享与披露">
          <p>除以下情形外，我们不会向任何第三方共享、出租或出售您的个人信息：</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>事先获得您的明示同意；</li>
            <li>为完成支付、登录等服务，必须共享给微信、支付服务商等合作方；</li>
            <li>司法、行政机关依法定程序要求提供。</li>
          </ol>
        </Section>

        <Section title="四、信息的存储与保护">
          <p>
            我们采用业界通用的加密传输（HTTPS）、数据库行级权限（RLS）和访问审计等手段保护您的信息。除法律法规另有规定外，您的个人信息仅在为您提供服务所必需的期间内被保存。
          </p>
        </Section>

        <Section title="五、您的权利">
          <ol className="list-decimal space-y-1 pl-5">
            <li>访问、更正：您可随时在「个人中心」查看、修改个人资料；</li>
            <li>注销账号：您可联系客服申请注销，注销后我们将删除或匿名化您的个人信息；</li>
            <li>撤回授权：您可关闭微信授权或解绑手机号，但可能影响相关功能。</li>
          </ol>
        </Section>

        <Section title="六、未成年人保护">
          <p>本平台不向未满 18 周岁的未成年人提供服务，亦不主动收集其个人信息。如发现相关情况，请监护人及时与我们联系。</p>
        </Section>

        <Section title="七、政策的更新">
          <p>本政策可能根据业务变化而更新，更新后将在本页面公布。重大变更我们会通过站内通知告知您。</p>
        </Section>

        <Section title="八、联系我们">
          <p>如对本政策有任何疑问、意见或投诉，请通过「个人中心 - 联系客服」或意见反馈与我们联系。</p>
        </Section>

        <p className="pt-2 text-center text-xs text-muted-foreground">
          相关协议：
          <Link to="/terms" className="text-info">《用户服务协议》</Link>
        </p>
      </article>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <div className="space-y-1 text-muted-foreground">{children}</div>
    </section>
  );
}
