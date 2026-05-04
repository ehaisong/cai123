import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/h5/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { RouteGuard } from "@/components/route-guard";
import { Loader2, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/merchant/products/new")({
  component: NewProductPage,
});

const TYPE_OPTIONS = ["3D", "P3", "P5", "球赛", "其他"] as const;
type TypeOpt = (typeof TYPE_OPTIONS)[number];

function NewProductPage() {
  return (
    <RouteGuard title="新建发布" roles={["merchant"]} forbiddenText="此页面仅限商家访问">
      <Inner />
    </RouteGuard>
  );
}

function Inner() {
  const [tab, setTab] = useState<"single" | "package">("single");
  return (
    <div className="h5-shell flex min-h-screen flex-col bg-background">
      <PageHeader
        title="新建"
        right={
          <Link to="/merchant/products" className="text-xs text-info">
            我的发布
          </Link>
        }
      />
      {/* Tab 切换 */}
      <div className="flex items-center justify-center gap-10 py-3 bg-card border-b border-border">
        {(["single", "package"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn(
              "text-base relative pb-1.5",
              tab === k ? "font-semibold text-foreground" : "text-muted-foreground"
            )}
          >
            {k === "single" ? "单卖" : "包时套餐"}
            {tab === k && (
              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-0.5 bg-primary rounded-full" />
            )}
          </button>
        ))}
      </div>
      <main className="flex-1 px-3 py-3">
        {tab === "single" ? <SingleForm /> : <PackageForm />}
      </main>
    </div>
  );
}

/* ============================== 单卖 ============================== */

function SingleForm() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [categories, setCategories] = useState<any[]>([]);

  const [hasIssue, setHasIssue] = useState(false);
  const [issueNo, setIssueNo] = useState("");
  const [types, setTypes] = useState<TypeOpt[]>([]);
  const [title, setTitle] = useState("");
  const [isPresale, setIsPresale] = useState(false);
  const [streak, setStreak] = useState<string>("");
  const [tagText, setTagText] = useState("");
  const [intro, setIntro] = useState("");
  const [introImages, setIntroImages] = useState<string[]>([]);
  const [paidContent, setPaidContent] = useState("");
  const [paidImages, setPaidImages] = useState<string[]>([]);
  const [price, setPrice] = useState<string>("");
  const [noWinRefund, setNoWinRefund] = useState(false);
  const [showInZone, setShowInZone] = useState(false);
  const [shareUnlock, setShareUnlock] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase.from("merchants").select("id").eq("user_id", user.id).maybeSingle().then(({ data }) => setMerchantId(data?.id ?? null));
    supabase.from("lottery_categories").select("id, name, code").order("sort_order").then(({ data }) => setCategories(data ?? []));
  }, [user?.id]);

  // 自动期号：3D/P3/P5 时根据当前日期生成 YYYYNNN（演示用：年份+一年中的第N天）
  useEffect(() => {
    if (!hasIssue) return;
    if (issueNo) return;
    const lotteryTypes: TypeOpt[] = ["3D", "P3", "P5"];
    if (types.some((t) => lotteryTypes.includes(t))) {
      const d = new Date();
      const start = new Date(d.getFullYear(), 0, 0);
      const day = Math.floor((d.getTime() - start.getTime()) / 86400000);
      setIssueNo(`${d.getFullYear()}${String(day).padStart(3, "0")}`);
    }
  }, [hasIssue, types]);

  const toggleType = (t: TypeOpt) => setTypes((arr) => (arr.includes(t) ? arr.filter((x) => x !== t) : [...arr, t]));
  const tags = tagText.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);

  const submit = async () => {
    if (!merchantId) return toast.error("商家信息缺失");
    if (types.length === 0) return toast.error("请选择类型");
    if (!title.trim()) return toast.error("请输入标题");
    if (!paidContent.trim()) return toast.error("请输入付费内容");
    const p = Number(price);
    if (!p || p <= 0) return toast.error("请输入单价");
    if (p > 188) return toast.error("单料最高 188 积分");

    // 选择类别（取第一个匹配的 lottery_categories；找不到则取首个）
    const matchedCat = categories.find((c) => types.some((t) => c.name?.includes(t) || c.code === t));
    const categoryId = matchedCat?.id ?? categories[0]?.id;
    if (!categoryId) return toast.error("彩种分类未配置");

    setLoading(true);
    const insertPayload: any = {
      merchant_id: merchantId,
      category_id: categoryId,
      kind: "single",
      title: title.trim(),
      types,
      tags,
      streak: streak ? Number(streak) : 0,
      is_presale: isPresale,
      intro: intro || null,
      intro_images: introImages,
      paid_content: paidContent,
      paid_images: paidImages,
      price: p,
      no_win_refund: noWinRefund,
      show_in_zone: showInZone,
      share_unlock: shareUnlock,
      has_self_issue: hasIssue,
      issue_no: hasIssue && issueNo ? issueNo : "—",
      publish_at: new Date().toISOString(),
      status: "published",
    };
    const { data, error } = await supabase.from("products").insert(insertPayload).select("id").single();
    if (error) {
      setLoading(false);
      return toast.error(error.message);
    }

    // 如果自带期号则同时创建一期，便于后续按期管理
    if (hasIssue && issueNo) {
      await supabase.from("product_issues").insert({
        product_id: data.id,
        issue_no: issueNo,
        paid_content: paidContent,
        publish_at: new Date().toISOString(),
        status: "published",
        result: "pending",
      });
    }

    setLoading(false);
    toast.success("已发布");
    navigate({ to: "/merchant/products" });
  };

  return (
    <div className="space-y-4">
      {/* 自带期数 */}
      <RowSwitch
        label="自带期数"
        hint={hasIssue ? (issueNo || "暂无期号") : "暂无期号"}
        checked={hasIssue}
        onCheckedChange={setHasIssue}
      />
      {hasIssue && (
        <Input
          value={issueNo}
          onChange={(e) => setIssueNo(e.target.value)}
          placeholder="期号（选择 3D/P3/P5 后自动填充）"
        />
      )}

      {/* 类型多选 */}
      <Section title="选择类型" hint="(可多选)">
        <div className="flex flex-wrap gap-2">
          {TYPE_OPTIONS.map((t) => (
            <button
              key={t}
              onClick={() => toggleType(t)}
              className={cn(
                "px-5 py-1.5 rounded-full text-sm border transition-colors",
                types.includes(t)
                  ? "bg-primary/10 text-primary border-primary"
                  : "bg-muted text-muted-foreground border-transparent"
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </Section>

      <Section title="标题" required>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={88} placeholder="请输入88字内标题" />
      </Section>

      <RowSwitch
        label="预售"
        hint="预售资料必须添加此标签，否则下架"
        checked={isPresale}
        onCheckedChange={setIsPresale}
      />

      <div className="grid grid-cols-2 gap-3">
        <Section title="连红">
          <Input
            inputMode="numeric"
            maxLength={2}
            value={streak}
            onChange={(e) => setStreak(e.target.value.replace(/\D/g, "").slice(0, 2))}
            placeholder="最大两位数"
          />
        </Section>
        <Section title="标签">
          <Input value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="标签，多个用空格分隔" />
        </Section>
      </div>

      <Section title="简介" hint="(内容与图片为选填内容)">
        <Textarea rows={4} value={intro} onChange={(e) => setIntro(e.target.value)} placeholder="请输入内容介绍" />
        <ImageUploader value={introImages} onChange={setIntroImages} folder="intro" />
      </Section>

      <Section title="付费内容" required>
        <Textarea rows={4} value={paidContent} onChange={(e) => setPaidContent(e.target.value)} placeholder="请输入内容介绍（买家购买后可见）" />
        <ImageUploader value={paidImages} onChange={setPaidImages} folder="paid" />
      </Section>

      {/* 单价 */}
      <div className="bg-card rounded-md p-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">单价（积分）</Label>
          <Input
            type="number"
            min={0}
            max={188}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="输入单价"
            className="w-32 text-right"
          />
        </div>
        <p className="text-xs text-muted-foreground mt-1">单料最高 88 积分，不中退还最高 188 积分</p>
      </div>

      <RowSwitch
        label="不中退还"
        hint="(不中收款退还) 三天内未操作，按判黑退还处理！"
        checked={noWinRefund}
        onCheckedChange={setNoWinRefund}
      />
      <RowSwitch
        label="发布专区"
        hint="发布到专区主页展示"
        checked={showInZone}
        onCheckedChange={setShowInZone}
      />
      <RowSwitch
        label="分享设置"
        hint="分享新用户免费解锁此文章"
        checked={shareUnlock}
        onCheckedChange={setShareUnlock}
      />

      <Button
        className="w-full h-12 text-base bg-primary hover:bg-primary/90 mt-4"
        onClick={submit}
        disabled={loading}
      >
        {loading ? "发布中…" : "发 布"}
      </Button>
    </div>
  );
}

/* ============================== 包时套餐 ============================== */

function PackageForm() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [merchantId, setMerchantId] = useState<string | null>(null);

  const [types, setTypes] = useState<TypeOpt[]>([]);
  const [title, setTitle] = useState("");
  const [logo, setLogo] = useState<string | null>(null);
  const [days, setDays] = useState("1");
  const [price, setPrice] = useState("");
  const [intro, setIntro] = useState("");
  const [introImages, setIntroImages] = useState<string[]>([]);
  const [showHome, setShowHome] = useState(true);
  const [showZone, setShowZone] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase.from("merchants").select("id").eq("user_id", user.id).maybeSingle().then(({ data }) => setMerchantId(data?.id ?? null));
  }, [user?.id]);

  const toggleType = (t: TypeOpt) => setTypes((arr) => (arr.includes(t) ? arr.filter((x) => x !== t) : [...arr, t]));

  const submit = async () => {
    if (!merchantId) return toast.error("商家信息缺失");
    if (types.length === 0) return toast.error("请选择类型");
    if (!title.trim()) return toast.error("请输入套餐标题");
    const d = Number(days);
    if (!d || d <= 0) return toast.error("套餐时长必须 ≥ 1 天");
    const p = Number(price);
    if (!p || p <= 0) return toast.error("请输入套餐价格");
    if (p > 288) return toast.error("套餐最高 288 积分");

    setLoading(true);
    const { error } = await supabase.from("product_packages").insert({
      merchant_id: merchantId,
      title: title.trim(),
      logo_url: logo,
      types,
      duration_days: d,
      price: p,
      intro: intro || null,
      intro_images: introImages,
      show_on_home: showHome,
      show_in_zone: showZone,
      status: "published",
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("套餐已发布");
    navigate({ to: "/merchant/products" });
  };

  return (
    <div className="space-y-4">
      <Section title="选择类型" hint="(可多选)">
        <div className="flex flex-wrap gap-2">
          {TYPE_OPTIONS.map((t) => (
            <button
              key={t}
              onClick={() => toggleType(t)}
              className={cn(
                "px-5 py-1.5 rounded-full text-sm border transition-colors",
                types.includes(t)
                  ? "bg-primary/10 text-primary border-primary"
                  : "bg-muted text-muted-foreground border-transparent"
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </Section>

      <Section title="套餐标题" required>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="请输入套餐标题" />
      </Section>

      <Section title="套餐LOGO">
        <SingleImageUploader value={logo} onChange={setLogo} folder="package-logo" placeholder="添加LOGO" />
      </Section>

      <div className="grid grid-cols-2 gap-3">
        <Section title="套餐时长（天）" required>
          <Input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} />
        </Section>
        <Section title="套餐价格（积分）" required>
          <Input
            type="number"
            min={0}
            max={288}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="套餐最高288"
          />
        </Section>
      </div>

      <Section title="套餐简介" hint="(内容与图片为选填内容)">
        <Textarea rows={4} value={intro} onChange={(e) => setIntro(e.target.value)} placeholder="请输入套餐详细介绍" />
        <ImageUploader value={introImages} onChange={setIntroImages} folder="package-intro" />
      </Section>

      <RowSwitch label="首页展示" checked={showHome} onCheckedChange={setShowHome} />
      <RowSwitch label="专区展示" checked={showZone} onCheckedChange={setShowZone} />

      <Button
        className="w-full h-12 text-base bg-primary hover:bg-primary/90 mt-4"
        onClick={submit}
        disabled={loading}
      >
        {loading ? "发布中…" : "发布套餐"}
      </Button>
    </div>
  );
}

/* ============================== 公共子组件 ============================== */

function Section({
  title,
  hint,
  required,
  children,
}: {
  title: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-1.5">
        {required && <span className="text-destructive">*</span>}
        <span className="text-sm font-medium text-foreground">{title}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function RowSwitch({
  label,
  hint,
  checked,
  onCheckedChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="bg-card rounded-md px-3 py-3 flex items-center justify-between gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function ImageUploader({
  value,
  onChange,
  folder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  folder: string;
}) {
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (!file.type.startsWith("image/")) {
      toast.error("仅支持图片");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("图片最大 5MB");
      return;
    }
    setUploading(true);
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `${user.id}/${folder}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("product-images").upload(path, file, { upsert: true });
    if (error) {
      setUploading(false);
      toast.error(error.message);
      return;
    }
    const { data: pub } = supabase.storage.from("product-images").getPublicUrl(path);
    onChange([...value, pub.publicUrl]);
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="flex flex-wrap gap-2">
      {value.map((url, i) => (
        <div key={i} className="relative w-20 h-20 rounded-md overflow-hidden bg-muted">
          <img src={url} alt="" className="w-full h-full object-cover" />
          <button
            type="button"
            onClick={() => onChange(value.filter((_, idx) => idx !== i))}
            className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="w-20 h-20 rounded-md border border-dashed border-border bg-muted/40 flex flex-col items-center justify-center text-muted-foreground"
      >
        {uploading ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <>
            <Plus className="w-5 h-5" />
            <span className="text-xs mt-0.5">添加图片</span>
          </>
        )}
      </button>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={upload} />
    </div>
  );
}

function SingleImageUploader({
  value,
  onChange,
  folder,
  placeholder = "添加图片",
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  folder: string;
  placeholder?: string;
}) {
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploading(true);
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `${user.id}/${folder}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("product-images").upload(path, file, { upsert: true });
    if (error) {
      setUploading(false);
      toast.error(error.message);
      return;
    }
    const { data: pub } = supabase.storage.from("product-images").getPublicUrl(path);
    onChange(pub.publicUrl);
    setUploading(false);
  };

  if (value) {
    return (
      <div className="relative w-24 h-24 rounded-md overflow-hidden bg-muted">
        <img src={value} alt="" className="w-full h-full object-cover" />
        <button
          type="button"
          onClick={() => onChange(null)}
          className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="w-24 h-24 rounded-md border border-dashed border-border bg-muted/40 flex flex-col items-center justify-center text-muted-foreground"
      >
        {uploading ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <>
            <Plus className="w-5 h-5" />
            <span className="text-xs mt-0.5">{placeholder}</span>
          </>
        )}
      </button>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={upload} />
    </>
  );
}
