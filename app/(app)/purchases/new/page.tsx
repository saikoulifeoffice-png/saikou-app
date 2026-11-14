import { requireProfile, isManager } from "@/lib/auth/session";
import { getCategories, getStaffOptions } from "@/lib/data";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { PurchaseForm } from "./purchase-form";

export const metadata = { title: "買取登録" };

export default async function NewPurchasePage() {
  const me = await requireProfile();
  const [categories, staff] = await Promise.all([getCategories(), getStaffOptions(me)]);
  const myBalance = staff.find((s) => s.id === me.id)?.balance ?? 0;
  return (
    <div>
      <PageHeader title="買取登録" description="複数商品・一括買取に対応。写真は撮影または選択で追加できます。"
        actions={<Button variant="outline" size="sm" asChild><Link href="/purchases">買取履歴</Link></Button>} />
      <PurchaseForm me={{ id: me.id, name: me.display_name, isManager: isManager(me) }} categories={categories} staff={staff} myBalance={myBalance} />
    </div>
  );
}
