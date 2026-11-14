"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ICONS, type NavItem, type UiMode } from "@/components/nav-config";
import { cn } from "@/lib/utils";

function isActive(pathname: string, item: NavItem) {
  // 「買取履歴」(/gold) は登録・相場・集計の各画面では非アクティブ
  if (item.href === "/gold" && /^\/gold\/(new|prices|reports)/.test(pathname)) return false;
  if (item.href === "/sales" && pathname.startsWith("/sales/new")) return false;
  const keys = item.match ?? [item.href];
  return keys.some((k) => pathname === k || pathname.startsWith(`${k}/`));
}

export function Sidebar({ items, manage }: { items: NavItem[]; manage: NavItem[] }) {
  const pathname = usePathname();
  const render = (item: NavItem) => {
    const active = isActive(pathname, item);
    return (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
          active ? "bg-navy-700 text-white" : "text-navy-100 hover:bg-navy-800 hover:text-white",
        )}
      >
        {(() => { const Icon = NAV_ICONS[item.icon]; return <Icon className={cn("size-5", active ? "text-gold-300" : "text-navy-300")} />; })()}
        <span className="flex-1">{item.label}</span>
        {!!item.badge && (
          <span className="num rounded-full bg-gold-400 px-2 text-xs font-bold text-navy-950">{item.badge}</span>
        )}
      </Link>
    );
  };
  return (
    <nav className="space-y-1" aria-label="メインメニュー">
      {items.map(render)}
      {manage.length > 0 && (
        <>
          <p className="px-3 pt-5 pb-1 text-[11px] font-semibold tracking-wider text-navy-300">管理</p>
          {manage.map(render)}
        </>
      )}
    </nav>
  );
}

export function BottomNav({ badge, mode = "full" }: { badge: number; mode?: UiMode }) {
  const pathname = usePathname();
  const items: NavItem[] =
    mode === "simple"
      ? [
          { href: "/gold/new", label: "買取", icon: "gold" },
          { href: "/gold", label: "履歴", icon: "history" },
          { href: "/gold/prices", label: "相場", icon: "prices" },
          { href: "/gold/reports", label: "集計", icon: "dashboard" },
          { href: "/menu", label: "メニュー", icon: "menu", badge, match: ["/menu", "/admin", "/account"] },
        ]
      : [
          { href: "/home", label: "ホーム", icon: "home" },
          { href: "/purchases/new", label: "買取", icon: "purchase", match: ["/purchases"] },
          { href: "/items", label: "商品", icon: "items" },
          { href: "/sales/new", label: "販売", icon: "sale", match: ["/sales"] },
          { href: "/menu", label: "メニュー", icon: "menu", badge, match: ["/menu", "/funds", "/performance", "/approvals", "/dashboard", "/admin"] },
        ];

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur pb-safe lg:hidden"
      aria-label="下部メニュー"
    >
      <ul className="grid grid-cols-5">
        {items.map((item) => {
          const active = isActive(pathname, item);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold",
                  active ? "text-navy-800" : "text-muted",
                )}
              >
                {(() => { const Icon = NAV_ICONS[item.icon]; return <Icon className={cn("size-6", active && "text-navy-700")} strokeWidth={active ? 2.4 : 1.8} />; })()}
                {item.label}
                {active && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-gold-400" />}
                {!!item.badge && (
                  <span className="num absolute top-1 right-[calc(50%-20px)] rounded-full bg-gold-400 px-1.5 text-[10px] font-bold text-navy-950">
                    {item.badge}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

