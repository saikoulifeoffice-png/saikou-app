import { requireOwner } from "@/lib/auth/session";
import { getSettings } from "@/lib/data";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "設定" };

export default async function SettingsPage() {
  await requireOwner();
  const s = await getSettings();
  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title="設定" description="変更は監査ログに記録されます" />
      <Alert tone="warning">集計の税基準を変更すると、過去分を含むすべての集計表示がその基準に切り替わります（データ自体は税込・税抜の両方を保持しています）。</Alert>
      <Card><CardContent><SettingsForm initial={{
        tax_basis: s.tax_basis, tax_rounding: s.tax_rounding, staff_can_view_other_inventory: s.staff_can_view_other_inventory,
        admin_can_approve_funds: s.admin_can_approve_funds, identity_retention_years: s.identity_retention_years, long_stay_days: s.long_stay_days,
        ui_mode: s.ui_mode === "full" ? "full" : "simple", pm_price_source_name: s.pm_price_source_name,
      }} /></CardContent></Card>
    </div>
  );
}
