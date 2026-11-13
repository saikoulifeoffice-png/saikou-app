import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireProfile, isManager } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { buildNav, NAV_ICONS, type NavItem } from "@/components/nav-config";
import { PageHeader } from "@/components/page-header";
import { signOut } from "@/app/login/actions";

export default async function MenuPage() {
  const profile = await requireProfile();
  let pending = 0;
  if (isManager(profile)) {
    const supabase = await createClient();
    const { count } = await supabase
      .from("approval_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .neq("requested_by", profile.id);
    pending = count ?? 0;
  }
  const nav = buildNav(profile.role, pending);
  const sections: { title: string; items: NavItem[] }[] = [
    { title: "業務", items: nav.main },
    ...(nav.manage.length ? [{ title: "管理", items: nav.manage }] : []),
    { title: "アカウント", items: [{ href: "/account", label: "アカウント・パスワード", icon: "account" }] },
  ];
  return (
    <div>
      <PageHeader title="メニュー" />
      <div className="space-y-6">
        {sections.map((s) => (
          <section key={s.title}>
            <h2 className="mb-2 text-xs font-semibold tracking-wider text-muted">{s.title}</h2>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
              {s.items.map((i) => (
                <li key={i.href}>
                  <Link href={i.href} className="flex items-center gap-3 px-4 py-3.5 text-sm font-medium hover:bg-navy-50">
                    {(() => { const Icon = NAV_ICONS[i.icon]; return <Icon className="size-5 text-navy-500" />; })()}
                    <span className="flex-1">{i.label}</span>
                    {!!i.badge && (
                      <span className="num rounded-full bg-gold-400 px-2 text-xs font-bold text-navy-950">{i.badge}</span>
                    )}
                    <ChevronRight className="size-4 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <form action={signOut}>
          <button className="w-full rounded-xl border border-border bg-surface py-3 text-sm font-semibold text-negative">
            ログアウト
          </button>
        </form>
      </div>
    </div>
  );
}
