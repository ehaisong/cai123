import { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { useRouter } from "@tanstack/react-router";

interface PageHeaderProps {
  title: string;
  showBack?: boolean;
  right?: ReactNode;
}

export function PageHeader({ title, showBack = true, right }: PageHeaderProps) {
  const router = useRouter();
  return (
    <header className="sticky top-0 z-20 flex h-12 items-center justify-between border-b border-border bg-card px-3">
      <div className="flex w-16 items-center">
        {showBack && (
          <button
            type="button"
            onClick={() => router.history.back()}
            className="flex items-center gap-0.5 text-info"
          >
            <ChevronLeft className="h-5 w-5" />
            <span className="text-sm">返回</span>
          </button>
        )}
      </div>
      <h1 className="flex-1 text-center text-base font-medium tracking-wide">{title}</h1>
      <div className="flex w-16 justify-end">{right}</div>
    </header>
  );
}
