import Link from "next/link";
import { LogOut } from "lucide-react";
import { requireProfile, isManager, ROLE_LABELS } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { BottomNav, Sidebar } from "@/components/app-nav";
import { BrandMark, buildNav } from "@/components/nav-config";
import { signOut } from "@/app/login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const supabase = await createClient();
  let pending = 0;
  if (isManager(profile)) {
    const { count } = await supabase
      .from("approval_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .neq("requested_by", profile.id);
    pending = count ?? 0;
  }
  const nav = buildNav(profile.role, pending);

  return (
    <div className="min-h-dvh lg:flex">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col bg-navy-900 px-3 py-5 lg:flex">
        <Link href="/home" className="mb-6 px-2">
          <BrandMark />
        </Link>
        <div className="flex-1 overflow-y-auto">
          <Sidebar items={nav.main} manage={nav.manage} />
        </div>
        <div className="mt-4 border-t border-navy-700 px-2 pt-4">
          <Link href="/account" className="block text-sm font-semibold text-white hover:text-gold-200">
            {profile.display_name}
          </Link>
          <p className="text-xs text-navy-300">{ROLE_LABELS[profile.role]}</p>
          <form action={signOut} className="mt-3">
            <button className="inline-flex items-center gap-2 text-xs text-navy-200 hover:text-white">
              <LogOut className="size-4" /> ログアウト
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between bg-navy-900 px-4 py-3 lg:hidden">
          <Link href="/home">
            <BrandMark />
          </Link>
          <Link href="/account" className="text-right">
            <span className="block text-xs font-semibold text-white">{profile.display_name}</span>
            <span className="block text-[10px] text-navy-300">{ROLE_LABELS[profile.role]}</span>
          </Link>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-28 sm:px-6 lg:px-8 lg:pt-8 lg:pb-12">{children}</main>
      </div>
      <BottomNav badge={pending} />
    </div>
  );
}
