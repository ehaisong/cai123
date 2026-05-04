import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/h5/page-header";

export const Route = createFileRoute("/terms")({
  component: TermsPage,
  head: () => ({
    meta: [
      { title: "用户服务协议 · 预马当先" },
      { name: "description", content: "预马当先用户服务协议：使用本平台前请仔细阅读。" },
    ],
  }),
});

function TermsPage() {
  return (
    <div className="h5-shell min-h-screen bg-muted">
      <PageHeader title="用户服务协议" />

      <article className="mx-3 my-3 space-y-5 rounded-2xl bg-card p-5 text-sm leading-7 text-foreground shadow-sm">
        <header className="space-y-1">
          <h1 className="text-base font-bold">预马当先用户服务协议</h1>
          <p className="text-xs text-muted-foreground">最后更新：2026 年 5 月 4 日</p>
        </header>

        <p className="text-muted-foreground">
          欢迎使用预马当先（以下简称「本平台」）。在您注册或使用本平台服务前，请您务必认真阅读、充分理解本协议各条款。一旦您勾选「同意」并完成登录，即视为您已接受本协议的全部约定。
        </p>

        <Section title="一、服务内容">
          <p>本平台为数据分析内容创作者与用户提供发布、订阅、互动等服务，包括但不限于：内容发布、单次购买、包时套餐、积分充值、推广佣金等功能。</p>
        </Section>

        <Section title="二、账号与登录">
          <ol className="list-decimal space-y-1 pl-5">
            <li>您可通过微信扫码或手机号验证码方式注册并登录本平台；</li>
            <li>您应妥善保管账号信息，因账号泄露造成的损失由您自行承担；</li>
            <li>禁止使用他人账号或将账号转让、出借给他人。</li>
          </ol>
        </Section>

        <Section title="三、内容规范">
          <p>您在本平台发布、传播的任何内容，应当遵守国家法律法规，不得包含以下内容：</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>违反宪法、法律法规、国家政策的内容；</li>
            <li>涉及暴力、色情、赌博、迷信、人身攻击的内容；</li>
            <li>侵犯他人知识产权、隐私权、名誉权的内容；</li>
            <li>虚假宣传、欺诈、诱导消费的内容。</li>
          </ol>
          <p>本平台所提供的数据分析、推荐内容仅供参考，不构成任何投资或购买建议，请您理性消费。</p>
        </Section>

        <Section title="四、积分与交易">
          <ol className="list-decimal space-y-1 pl-5">
            <li>积分为本平台的虚拟权益单位，仅可用于本平台内消费，不可提现、不可转让；</li>
            <li>商家通过销售获得的收益可按平台规则申请提现；</li>
            <li>您应对自己发起的所有充值、消费、提现行为负责。</li>
          </ol>
        </Section>

        <Section title="五、知识产权">
          <p>本平台的页面设计、商标、文案、代码等知识产权归本平台所有；用户发布的原创内容由用户享有著作权，并授权本平台在平台内展示、推广。</p>
        </Section>

        <Section title="六、免责声明">
          <ol className="list-decimal space-y-1 pl-5">
            <li>因不可抗力（自然灾害、网络故障、政策调整等）导致服务中断的，本平台不承担责任；</li>
            <li>因用户自身原因（账号泄露、操作失误、违反协议）造成的损失，由用户自行承担；</li>
            <li>本平台对第三方链接、第三方服务不作担保，由用户自行判断风险。</li>
          </ol>
        </Section>

        <Section title="七、违约处理">
          <p>如您违反本协议或国家法律法规，本平台有权采取以下措施：</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>删除违规内容、限制功能、冻结账号；</li>
            <li>没收违法所得、扣减积分；</li>
            <li>情节严重的，移交有关部门依法处理。</li>
          </ol>
        </Section>

        <Section title="八、协议的修改">
          <p>本平台有权根据业务需要修改本协议，修改后的协议将在本页面公布。您继续使用本平台即视为接受修改后的协议。</p>
        </Section>

        <Section title="九、法律适用与争议解决">
          <p>本协议的订立、履行、解释及争议解决均适用中华人民共和国法律。如发生争议，双方应友好协商；协商不成的，提交本平台经营者所在地人民法院诉讼解决。</p>
        </Section>

        <p className="pt-2 text-center text-xs text-muted-foreground">
          相关协议：
          <Link to="/privacy" className="text-info">《隐私权政策》</Link>
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
