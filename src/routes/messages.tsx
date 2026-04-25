import { createFileRoute } from "@tanstack/react-router";
import { BottomNav } from "@/components/h5/bottom-nav";

export const Route = createFileRoute("/messages")({
  component: () => (
    <div className="h5-shell flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 h-12 bg-card border-b border-border flex items-center justify-center">
        <h1 className="font-medium">消息</h1>
      </header>
      <main className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">暂无消息</p>
      </main>
      <BottomNav />
    </div>
  ),
});
