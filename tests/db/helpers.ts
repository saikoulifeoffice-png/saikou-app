/**
 * DB 統合テスト用ヘルパー
 * ローカル Supabase（`npx supabase start`）に接続し、実際の Auth・RLS・RPC・Storage で検証する。
 * 接続情報は環境変数、なければ `supabase status` から取得する（キーをハードコードしない）。
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

pg.types.setTypeParser(20, (v) => Number(v)); // bigint → number（金額は1兆円以下に制限済み）

interface Env {
  DB_URL: string;
  API_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
}

function loadEnv(): Env {
  const fromEnv = {
    DB_URL: process.env.TEST_DB_URL,
    API_URL: process.env.TEST_SUPABASE_URL,
    ANON_KEY: process.env.TEST_SUPABASE_ANON_KEY,
    SERVICE_ROLE_KEY: process.env.TEST_SUPABASE_SERVICE_ROLE_KEY,
  };
  if (Object.values(fromEnv).every(Boolean)) return fromEnv as Env;
  const out = execSync("npx supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const json = JSON.parse(out.slice(out.indexOf("{")));
  return { DB_URL: json.DB_URL, API_URL: json.API_URL, ANON_KEY: json.ANON_KEY, SERVICE_ROLE_KEY: json.SERVICE_ROLE_KEY };
}

export const env = loadEnv();
export const pool = new pg.Pool({ connectionString: env.DB_URL, max: 12 });
export const admin = createClient(env.API_URL, env.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export interface TestUser {
  id: string;
  email: string;
  password: string;
  role: "owner" | "admin" | "staff";
  name: string;
}

export async function createUser(role: TestUser["role"], name = `${role}-${randomUUID().slice(0, 6)}`): Promise<TestUser> {
  const email = `test-${randomUUID()}@example.test`;
  const password = `Pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role },
    user_metadata: { display_name: name },
  });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  return { id: data.user.id, email, password, role, name };
}

/** 指定ユーザー（authenticated ロール + JWT クレーム）として SQL を実行 */
export async function asUser<T>(user: TestUser | string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const uid = typeof user === "string" ? user : user.id;
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: uid, role: "authenticated" }),
    ]);
    await c.query("set local role authenticated");
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

/** RPC を呼び出して結果（1列目）を返す */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function rpc<T = any>(user: TestUser, fn: string, ...args: unknown[]): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  return asUser(user, async (c) => {
    const r = await c.query(
      `select public.${fn}(${placeholders}) as r`,
      args.map((a) => (a !== null && typeof a === "object" ? JSON.stringify(a) : a)),
    );
    return r.rows[0].r as T;
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function query<T = any>(user: TestUser, text: string, params: unknown[] = []): Promise<T[]> {
  return asUser(user, async (c) => (await c.query(text, params)).rows as T[]);
}

/** スーパーユーザーとして実行（検証用） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function superQuery<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(text, params)).rows as T[];
}

export async function signIn(user: TestUser): Promise<SupabaseClient> {
  const client = createClient(env.API_URL, env.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw error;
  return client;
}

export function anonClient(): SupabaseClient {
  return createClient(env.API_URL, env.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function categoryId(name = "時計"): Promise<string> {
  const r = await superQuery<{ id: string }>("select id from public.item_categories where name = $1", [name]);
  return r[0].id;
}

export async function reserveAccount(user: TestUser): Promise<string> {
  const r = await superQuery<{ id: string }>(
    "select id from public.fund_accounts where kind = 'staff_reserve' and owner_profile_id = $1",
    [user.id],
  );
  return r[0].id;
}

export async function balance(accountId: string): Promise<number> {
  const r = await superQuery<{ b: number }>("select app.fund_balance($1) as b", [accountId]);
  return r[0].b;
}

export async function stock(itemId: string): Promise<{ qty: number; cost_incl: number; cost_excl: number }> {
  const r = await superQuery<{ qty: number; cost_incl: number; cost_excl: number }>(
    "select * from app.item_stock($1)",
    [itemId],
  );
  return r[0];
}

/** 代表が準備金を補充 */
export async function replenish(owner: TestUser, staff: TestUser, amount: number) {
  return rpc(owner, "fund_operation", {
    idempotency_key: randomUUID(),
    type: "replenish",
    account_id: await reserveAccount(staff),
    amount,
  });
}

export interface ItemInput {
  name?: string;
  cost_incl: number;
  quantity?: number;
  tax_category?: string;
}

export interface PurchaseResult {
  purchase_id: string;
  purchase_no: string;
  items: { id: string; item_no: string; line_no: number }[];
  duplicate: boolean;
}

export async function purchase(user: TestUser, items: ItemInput[], extra: Record<string, unknown> = {}): Promise<PurchaseResult> {
  const cat = await categoryId();
  return rpc(user, "register_purchase", {
    idempotency_key: randomUUID(),
    method: "store",
    payment_method: "cash",
    items: items.map((i, idx) => ({
      category_id: cat,
      name: i.name ?? `テスト商品${idx + 1}`,
      condition: "A",
      quantity: i.quantity ?? 1,
      cost_incl: i.cost_incl,
      tax_category: i.tax_category ?? "standard_10",
    })),
    ...extra,
  });
}

export interface SaleLineInput {
  item_id: string;
  quantity?: number;
  revenue_incl?: number;
  tax_category?: string;
}

export async function sell(user: TestUser, lines: SaleLineInput[], extra: Record<string, unknown> = {}) {
  return rpc<{ sale_id: string; sale_no: string; lines: { sale_item_id: string; revenue_incl: number; direct_expense_incl: number }[]; duplicate: boolean }>(
    user,
    "register_sale",
    { idempotency_key: randomUUID(), channel: "store", allocation: "manual", lines, ...extra },
  );
}

export async function expectError(p: Promise<unknown>, code: string | RegExp): Promise<void> {
  let msg: string | null = null;
  try {
    await p;
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e);
  }
  if (msg === null) throw new Error(`エラー ${code} が発生しませんでした`);
  if (typeof code === "string" ? msg.includes(code) : code.test(msg)) return;
  throw new Error(`期待したエラー ${code} ではありません: ${msg}`);
}

export const uuid = randomUUID;
