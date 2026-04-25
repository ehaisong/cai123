import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/h5/page-header";

export const Route = createFileRoute("/contact")({
  component: () => (
    <div className="h5-shell">
      <PageHeader title="联系客服" />
      <div className="bg-card m-3 p-6 rounded-xl text-center">
        <div className="text-4xl mb-3">🎧</div>
        <p className="text-sm">客服微信：<span className="font-semibold">support_demo</span></p>
        <p className="text-xs text-muted-foreground mt-2">工作时间 09:00 — 22:00</p>
      </div>
    </div>
  ),
});
