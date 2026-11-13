import { requireManager, ROLE_LABELS } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/date";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Yen } from "@/components/yen";
import { CreateStaffButton, StaffRowActions } from "./staff-client";

export const metadata = { title: "従業員・権限管理" };

export default async function StaffPage() {
  const me = await requireManager();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_staff");
  if (error) throw error;
  const isOwner = me.role === "owner";
  return (
    <div>
      <PageHeader title="従業員・権限管理" description={isOwner ? "アカウントの発行・権限変更・無効化ができます" : "閲覧のみ（変更は代表が行います）"}
        actions={isOwner ? <CreateStaffButton /> : undefined} />
      <Card className="overflow-hidden">
        <ul className="divide-y divide-border">
          {data.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-semibold">{s.display_name}
                  <Badge tone={s.role === "owner" ? "gold" : s.role === "admin" ? "neutral" : "muted"}>{ROLE_LABELS[s.role]}</Badge>
                  {!s.is_active && <Badge tone="negative">無効</Badge>}
                  {s.id === me.id && <Badge tone="muted">自分</Badge>}</p>
                <p className="truncate text-xs text-muted">{s.email}・登録 {formatDate(s.created_at)}</p>
              </div>
              <div className="text-right text-sm"><p className="text-xs text-muted">準備金</p><Yen value={s.reserve_balance} className="font-semibold" /></div>
              {isOwner && s.id !== me.id && <StaffRowActions id={s.id} name={s.display_name} role={s.role} active={s.is_active} />}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
