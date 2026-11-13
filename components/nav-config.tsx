import {
  BarChart3,
  Building2,
  CheckSquare,
  HandCoins,
  Home,
  LayoutGrid,
  Package,
  Receipt,
  Settings,
  ShoppingBag,
  TrendingUp,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** ナビゲーション定義（サーバー/クライアント共用。アイコンはキーで渡す） */
export const NAV_ICONS = {
  home: Home,
  purchase: HandCoins,
  items: Package,
  sale: ShoppingBag,
  sales: Receipt,
  funds: Wallet,
  performance: TrendingUp,
  approvals: CheckSquare,
  dashboard: BarChart3,
  staff: Users,
  settings: Settings,
  account: UserCog,
  menu: LayoutGrid,
} satisfies Record<string, LucideIcon>;

export type NavIcon = keyof typeof NAV_ICONS;

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  match?: string[];
  badge?: number;
}

export function buildNav(role: "owner" | "admin" | "staff", pendingApprovals: number): { main: NavItem[]; manage: NavItem[] } {
  const main: NavItem[] = [
    { href: "/home", label: "ホーム", icon: "home" },
    { href: "/purchases/new", label: "買取登録", icon: "purchase", match: ["/purchases"] },
    { href: "/items", label: "商品・在庫", icon: "items" },
    { href: "/sales/new", label: "販売登録", icon: "sale", match: ["/sales/new"] },
    { href: "/sales", label: "販売・入金", icon: "sales", match: ["/sales"] },
    { href: "/funds", label: "買取準備金", icon: "funds" },
    { href: "/performance", label: "個人実績", icon: "performance" },
    { href: "/approvals", label: "承認", icon: "approvals", badge: pendingApprovals },
  ];
  const manage: NavItem[] = [];
  if (role !== "staff") {
    manage.push({ href: "/dashboard", label: "全社ダッシュボード", icon: "dashboard" });
    manage.push({ href: "/admin/staff", label: "従業員・権限", icon: "staff" });
  }
  if (role === "owner") manage.push({ href: "/admin/settings", label: "設定", icon: "settings" });
  return { main, manage };
}

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="grid size-8 place-items-center rounded-lg bg-gold-400 text-navy-950">
        <Building2 className="size-5" />
      </span>
      <span className="leading-tight">
        <span className="block text-[11px] font-semibold tracking-widest text-gold-300">買取SAIKOU</span>
        <span className="block text-sm font-bold text-white">Manager</span>
      </span>
    </span>
  );
}
