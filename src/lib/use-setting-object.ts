import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { reportRpcError } from "@/lib/error-logger";
import { toast } from "sonner";

/**
 * 读取/保存 app_settings 中的一个 JSON 对象配置项。
 */
export function useSettingObject<T extends Record<string, any>>(key: string, defaults: T) {
  const [value, setValue] = useState<T>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.from("app_settings").select("value").eq("key", key).maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) reportRpcError(error, { op: "app_settings.select", scope: `useSettingObject(${key})` });
        const v = data?.value;
        if (v && typeof v === "object" && !Array.isArray(v)) {
          setValue({ ...defaults, ...(v as any) });
        }
        setLoading(false);
      });
    return () => { active = false; };
  }, [key]);

  const save = async (next?: T) => {
    const payload = next ?? value;
    setSaving(true);
    const { error } = await supabase.from("app_settings").upsert(
      { key, value: payload as any, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
    setSaving(false);
    if (error) {
      reportRpcError(error, { op: "app_settings.upsert", scope: `useSettingObject(${key})` });
      toast.error("保存失败");
      return false;
    }
    toast.success("已保存");
    return true;
  };

  return { value, setValue, save, loading, saving };
}
