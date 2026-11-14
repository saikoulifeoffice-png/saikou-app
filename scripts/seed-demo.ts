/**
 * 架空のデモデータ投入（ローカル開発専用）
 *
 *   DEMO_PASSWORD=xxxxxxxxxx1 npm run seed:demo
 *
 * - 登場する人物・顧客・商品はすべて架空です
 * - 接続先が localhost / 127.0.0.1 以外の場合は実行しません（本番への誤投入防止）
 * - 業務データは各ユーザーとしてログインし RPC 経由で登録します（本番と同じ検証・RLS を通す）
 */
import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

config({ path: ".env.local" });
config();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const password = process.env.DEMO_PASSWORD ?? "";

const PEOPLE = [
  { key: "owner", email: "owner@demo.saikou.test", name: "代表 山田（架空）", role: "owner" },
  { key: "admin", email: "admin@demo.saikou.test", name: "管理者 佐藤（架空）", role: "admin" },
  { key: "suzuki", email: "suzuki@demo.saikou.test", name: "鈴木 一郎（架空）", role: "staff" },
  { key: "tanaka", email: "tanaka@demo.saikou.test", name: "田中 花子（架空）", role: "staff" },
] as const;

async function signIn(email: string): Promise<SupabaseClient> {
  const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return c;
}

async function rpc<T>(c: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await c.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

function daysAgo(n: number, hour = 11) {
  const d = new Date(Date.now() - n * 86400000);
  d.setUTCHours(hour - 9, 0, 0, 0);
  return d.toISOString();
}

async function main() {
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) throw new Error("ローカル環境以外では実行できません");
  if (password.length < 10) throw new Error("DEMO_PASSWORD（10文字以上・英数字）を指定してください");
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  const ids: Record<string, string> = {};
  for (const p of PEOPLE) {
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const existing = list?.users.find((u) => u.email === p.email);
    if (existing) { ids[p.key] = existing.id; continue; }
    const { data, error } = await admin.auth.admin.createUser({
      email: p.email, password, email_confirm: true, app_metadata: { role: p.role }, user_metadata: { display_name: p.name },
    });
    if (error) throw error;
    ids[p.key] = data.user.id;
  }
  const owner = await signIn(PEOPLE[0].email);
  const suzuki = await signIn(PEOPLE[2].email);
  const tanaka = await signIn(PEOPLE[3].email);

  const { count } = await admin.from("purchase_transactions").select("id", { count: "exact", head: true });
  if ((count ?? 0) > 0) { console.log("既にデータがあるため業務データの投入をスキップしました"); return; }

  const accounts = await rpc<{ account_id: string; owner_profile_id: string | null }[]>(owner, "fund_balances", {});
  const acc = (k: string) => accounts.find((a) => a.owner_profile_id === ids[k])!.account_id;
  for (const k of ["suzuki", "tanaka"]) {
    await rpc(owner, "fund_operation", { p: { idempotency_key: randomUUID(), type: "replenish", account_id: acc(k), amount: 3_000_000, occurred_at: daysAgo(60, 9) } });
  }
  const { data: cats } = await admin.from("item_categories").select("id, name");
  const cat = (n: string) => cats!.find((c) => c.name === n)!.id;

  type P = { purchase_id: string; items: { id: string }[] };
  const items = [
    { who: suzuki, d: 55, c: "時計", brand: "架空ウォッチ", name: "オートマチック 40mm", cost: 280_000 },
    { who: suzuki, d: 50, c: "バッグ", brand: "架空レザー", name: "トートバッグ M", cost: 95_000 },
    { who: suzuki, d: 40, c: "貴金属", brand: "", name: "K18 ネックレス 10g", cost: 82_000 },
    { who: tanaka, d: 45, c: "カメラ", brand: "架空光学", name: "ミラーレス一眼 ボディ", cost: 64_000 },
    { who: tanaka, d: 30, c: "ジュエリー", brand: "架空ジュエル", name: "プラチナリング", cost: 120_000 },
    { who: tanaka, d: 20, c: "時計", brand: "架空クロノ", name: "クロノグラフ 42mm", cost: 350_000 },
    { who: suzuki, d: 10, c: "ブランド小物", brand: "架空レザー", name: "長財布", cost: 28_000 },
    { who: tanaka, d: 5, c: "家電", brand: "架空電機", name: "ワイヤレスイヤホン", cost: 9_000 },
  ];
  const bought: { id: string; who: SupabaseClient; cost: number; d: number }[] = [];
  for (const it of items) {
    const r = await rpc<P>(it.who, "register_purchase", {
      p: {
        idempotency_key: randomUUID(), purchased_at: daysAgo(it.d), method: "store", payment_method: "cash",
        customer: { name: `架空顧客 ${bought.length + 1}`, phone: `090-0000-${String(1000 + bought.length)}` },
        items: [{ category_id: cat(it.c), brand: it.brand, name: it.name, condition: "A", quantity: 1, cost_incl: it.cost, tax_category: "standard_10", storage_location: "本店金庫" }],
      },
    });
    bought.push({ id: r.items[0].id, who: it.who, cost: it.cost, d: it.d });
  }
  // 一括買取（複数点）
  await rpc(suzuki, "register_purchase", { p: { idempotency_key: randomUUID(), purchased_at: daysAgo(15), method: "visit", payment_method: "bank_transfer",
    items: [1, 2, 3].map((n) => ({ category_id: cat("アパレル"), brand: "架空アパレル", name: `ジャケット ${n}`, condition: "B", quantity: 1, cost_incl: 8_000, tax_category: "standard_10" })) } });

  const sales: [number, SupabaseClient, string, number, number, number][] = [
    [0, suzuki, "dealer", 360_000, 0, 35],
    [1, tanaka, "ec", 138_000, 13_800, 25],   // 田中が鈴木の買取品を販売（実績は鈴木に帰属）
    [3, tanaka, "auction", 82_000, 8_200, 12],
    [2, suzuki, "store", 98_000, 0, 3],
  ];
  for (const [i, who, channel, rev, fee, d] of sales) {
    await rpc(who, "register_sale", { p: {
      idempotency_key: randomUUID(), sold_at: daysAgo(d, 15), channel, allocation: "manual",
      lines: [{ item_id: bought[i].id, quantity: 1, revenue_incl: rev, tax_category: "standard_10" }],
      expenses: fee ? [{ expense_type: "fee", amount_incl: fee, tax_category: "standard_10" }, { expense_type: "shipping", amount_incl: 1_200, tax_category: "standard_10" }] : [],
      received_now: channel === "store" || d > 20, expected_receipt_amount: rev - fee,
      payment_due_date: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
    } });
  }
  console.log("架空デモデータを投入しました。");
  for (const p of PEOPLE) console.log(`  ${p.role.padEnd(5)} ${p.email}`);
  console.log("パスワードは DEMO_PASSWORD に指定した値です。");
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
