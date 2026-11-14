import Link from "next/link";
import { requireProfile, isManager } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getGrades, getPriceSourceName } from "@/lib/gold/data";
import { jstDateString } from "@/lib/date";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { GoldForm } from "./gold-form";
import { Alert } from "@/components/ui/alert";

export const metadata = { title: "貴金属買取登録" };

export default async function GoldNewPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const me = await requireProfile();
  const { denied } = await searchParams;
  const supabase = await createClient();
  const [grades, sourceName, { data: prices }, { data: staff }] = await Promise.all([
    getGrades(),
    getPriceSourceName(),
    supabase.rpc("pm_prices_for_date", { p_date: jstDateString() }),
    isManager(me)
      ? supabase.from("profiles").select("id, display_name").eq("is_active", true).order("display_name")
      : Promise.resolve({ data: [{ id: me.id, display_name: me.display_name }] }),
  ]);
  return (
    <div>
      <PageHeader title="買取登録" description="品位と重量を入れると、参考相場から地金金額を自動計算します"
        actions={<Button variant="outline" size="sm" asChild><Link href="/gold">買取履歴</Link></Button>} />
      {denied && <Alert tone="warning" className="mb-4">そのページを表示する権限がありません</Alert>}
      <GoldForm
        me={{ id: me.id, name: me.display_name, isManager: isManager(me) }}
        staff={(staff ?? []).map((s) => ({ id: s.id, name: s.display_name }))}
        grades={grades}
        initialPrices={(prices ?? []).map((p) => ({ ...p, unit_price: Number(p.unit_price) }))}
        sourceName={sourceName}
      />
    </div>
  );
}
