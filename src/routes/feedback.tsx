import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export const Route = createFileRoute("/feedback")({
  component: () => {
    const { user } = useAuth();
    const [content, setContent] = useState("");
    const [contact, setContact] = useState("");
    const submit = async () => {
      if (!content) { toast.error("请填写反馈内容"); return; }
      const { error } = await supabase.from("feedback").insert({ user_id: user?.id ?? null, content, contact });
      if (error) toast.error(error.message); else { toast.success("感谢您的反馈"); setContent(""); setContact(""); }
    };
    return (
      <div className="h5-shell">
        <PageHeader title="反馈建议" />
        <div className="bg-card m-3 p-4 rounded-xl space-y-3">
          <Textarea rows={5} value={content} onChange={(e) => setContent(e.target.value)} placeholder="请填写您的反馈或建议…" />
          <Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="联系方式（选填）" />
          <Button className="w-full" onClick={submit}>提交反馈</Button>
        </div>
      </div>
    );
  },
});
