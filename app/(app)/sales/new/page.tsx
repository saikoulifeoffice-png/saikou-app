import Link from "next/link";
import { requireProfile, isManager } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getStaffOptions } from "@/lib/data";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { SaleForm } from "./sale-form";
import type { SellableItem } from "../actions";

export const metadata = { title: "販売登録" };

export default async function NewSalePage({ searchParams }: { searchParams: Promise<{ item?: string }> }) {
  const me = await requireProfile();
  const { item } = await searchParams;
  const staff = await getStaffOptions(me);
  let initial: SellableItem | null = null;
  if (item && /^[0-9a-f-]{36}$/.test(item)) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("get_item", { p_item_id: item });
    const d = data as unknown as {
      id: string; item_no: string; name: string; brand: string | null; stock_quantity: number; stock_cost_incl: number | null;
      staff_name: string; staff_id: string; category_name: string; status: string;
    } | null;
    if (d && (d.status === "in_stock" || d.status === "partially_sold")) {
      initial = { id: d.id, item_no: d.item_no, name: d.name, brand: d.brand, stock_quantity: d.stock_quantity, stock_cost: d.stock_cost_incl,
        staff_name: d.staff_name, is_mine: d.staff_id === me.id, category_name: d.category_name };
    }
  }
  return (
    <div>
      <PageHeader title="販売登録" description="店舗・業者・オークション・EC 等。複数商品のまとめ販売、分割販売に対応。"
        actions={<Button variant="outline" size="sm" asChild><Link href="/sales">販売履歴</Link></Button>} />
      <SaleForm me={{ id: me.id, name: me.display_name, isManager: isManager(me) }} staff={staff.map((s) => ({ id: s.id, name: s.name }))} initialItem={initial} />
    </div>
  );
}
