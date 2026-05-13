import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { PcShell } from "@/components/pc/pc-shell";
import { PcRouteGuard } from "@/components/pc/pc-route-guard";

export const Route = createFileRoute("/pc")({
  component: PcLayout,
});

function PcLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // 登录页不套 Shell / Guard
  if (pathname === "/pc/login") return <Outlet />;
  return (
    <PcRouteGuard>
      <PcShell>
        <Outlet />
      </PcShell>
    </PcRouteGuard>
  );
}
