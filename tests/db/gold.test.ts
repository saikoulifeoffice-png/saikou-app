import { beforeAll, describe, expect, it } from "vitest";
import { metalValue } from "@/lib/gold/calc";
import { anonClient, createUser, expectError, query, rpc, signIn, superQuery, uuid, type TestUser } from "./helpers";

let owner: TestUser;
let staffA: TestUser;
let staffB: TestUser;
// 他のテストと衝突しない過去日を使う
const D = "2020-02-10";
const D_NEXT = "2020-02-11";

function buy(user: TestUser, items: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  return rpc(user, "pm_register_purchase", {
    idempotency_key: uuid(),
    purchased_on: D,
    customer_name: "架空 花子",
    customer_phone: "090-0000-0000",
    customer_address: "東京都架空区1-2-3",
    paid_amount: 250_000,
    items,
    ...extra,
  });
}

beforeAll(async () => {
  owner = await createUser("owner");
  staffA = await createUser("staff", "金A");
  staffB = await createUser("staff", "金B");
  await rpc(owner, "pm_upsert_market_prices", {
    price_date: D,
    source_name: "ゴールドミセス 公開買取相場（参考）",
    fetched_at: "2020-02-10T01:00:00Z",
    prices: [
      { grade_code: "K24", unit_price: 21500 },
      { grade_code: "K18", unit_price: 16500 },
      { grade_code: "Pt900", unit_price: 4800.5 },
    ],
  });
});

describe("相場管理", () => {
  it("代表・管理者のみ登録でき、取得元・取得日時が記録される", async () => {
    await expectError(rpc(staffA, "pm_upsert_market_prices", { price_date: D, prices: [{ grade_code: "K10", unit_price: 9000 }] }), "FORBIDDEN");
    const r = await superQuery("select source_name, fetched_at, method, recorded_by from public.pm_market_prices where price_date = $1 and grade_code = 'K18'", [D]);
    expect(r[0].source_name).toBe("ゴールドミセス 公開買取相場（参考）");
    expect(r[0].method).toBe("manual");
    expect(r[0].recorded_by).toBe(owner.id);
    await expectError(rpc(owner, "pm_upsert_market_prices", { price_date: D, prices: [{ grade_code: "K18", unit_price: 1.234 }] }), "VALIDATION");
  });

  it("買取日の相場がなければ直近の過去日を返す（当日かどうかも返す）", async () => {
    const rows = await query(staffA, "select * from public.pm_prices_for_date($1)", [D_NEXT]);
    const k18 = rows.find((r) => r.grade_code === "K18");
    expect(Number(k18.unit_price)).toBe(16500);
    expect(k18.is_exact_date).toBe(false);
  });
});

describe("買取登録と自動計算", () => {
  it("複数商品の地金金額・地金総額・見込み利益をサーバーで計算する", async () => {
    const r = await buy(staffA, [
      { item_name: "喜平ネックレス", grade_code: "K18", weight_g: "10.00" },
      { item_name: "指輪", grade_code: "K24", weight_g: "3.33" },
      { grade_code: "Pt900", weight_g: "1.11" },
    ]);
    const expected = metalValue(1000, 1650000) + metalValue(333, 2150000) + metalValue(111, 480050);
    expect(r.total_metal_value).toBe(expected);
    expect(r.expected_profit).toBe(expected - 250_000);
    expect(r.purchase_no).toMatch(/^G2002-\d{6}$/);
    const items = await superQuery("select item_name, weight_g, unit_price, price_basis, market_price_date, metal_value from public.pm_purchase_items where purchase_id = $1 order by line_no", [r.purchase_id]);
    expect(items.map((i) => i.metal_value)).toEqual([165000, 71595, 5329]);
    expect(items[2].item_name).toBeNull();
    expect(items.every((i) => i.price_basis === "market")).toBe(true);
    const h = await superQuery("select total_metal_value, paid_amount, expected_profit from public.pm_purchases where id = $1", [r.purchase_id]);
    expect(h[0]).toEqual({ total_metal_value: expected, paid_amount: 250000, expected_profit: expected - 250000 });
  });

  it("マイナスの見込み利益も保存・表示できる", async () => {
    const r = await buy(staffA, [{ grade_code: "K18", weight_g: "1" }], { paid_amount: 20_000 });
    expect(r.total_metal_value).toBe(16_500);
    expect(r.expected_profit).toBe(-3_500);
  });

  it("相場未登録の品位は警告（エラー）、単価を手入力すれば登録でき手入力として記録", async () => {
    await expectError(buy(staffA, [{ grade_code: "K10", weight_g: "5" }]), "NO_MARKET_PRICE");
    const r = await buy(staffA, [{ grade_code: "K10", weight_g: "5", unit_price: "9000" }], { paid_amount: 40_000 });
    expect(r.total_metal_value).toBe(45_000);
    const i = await superQuery("select price_basis, market_price_id from public.pm_purchase_items where purchase_id = $1", [r.purchase_id]);
    expect(i[0]).toEqual({ price_basis: "manual", market_price_id: null });
  });

  it("買取日の相場がない場合は直近の相場を適用し、警告を返す", async () => {
    const r = await buy(staffA, [{ grade_code: "K18", weight_g: "2" }], { purchased_on: D_NEXT, paid_amount: 0 });
    expect(r.warnings.length).toBe(1);
    const i = await superQuery("select price_basis, market_price_date::text d from public.pm_purchase_items where purchase_id = $1", [r.purchase_id]);
    expect(i[0]).toEqual({ price_basis: "market_previous", d: D });
  });

  it("相場を後から修正しても過去の買取記録の単価・金額は変わらない", async () => {
    const r = await buy(staffA, [{ grade_code: "K24", weight_g: "10" }], { paid_amount: 0 });
    await rpc(owner, "pm_upsert_market_prices", { price_date: D, prices: [{ grade_code: "K24", unit_price: 30000 }] });
    const i = await superQuery("select unit_price, metal_value from public.pm_purchase_items where purchase_id = $1", [r.purchase_id]);
    expect(Number(i[0].unit_price)).toBe(21500);
    expect(i[0].metal_value).toBe(215_000);
    const h = await superQuery("select total_metal_value from public.pm_purchases where id = $1", [r.purchase_id]);
    expect(h[0].total_metal_value).toBe(215_000);
    // 登録済みの内容は DB 直接でも変更できない
    await expectError(superQuery("update public.pm_purchase_items set unit_price = 1 where purchase_id = $1", [r.purchase_id]), "IMMUTABLE");
    await expectError(superQuery("update public.pm_purchases set paid_amount = 1 where id = $1", [r.purchase_id]), "IMMUTABLE");
    await rpc(owner, "pm_upsert_market_prices", { price_date: D, prices: [{ grade_code: "K24", unit_price: 21500 }] });
  });

  it("入力チェック", async () => {
    await expectError(buy(staffA, [{ grade_code: "K18", weight_g: "0" }]), "VALIDATION");
    await expectError(buy(staffA, [{ grade_code: "K18", weight_g: "1.234" }]), "VALIDATION");
    await expectError(buy(staffA, [{ grade_code: "K99", weight_g: "1" }]), "VALIDATION");
    await expectError(buy(staffA, []), "VALIDATION");
    await expectError(buy(staffA, [{ grade_code: "K18", weight_g: "1" }], { customer_name: " " }), "VALIDATION");
    await expectError(buy(staffA, [{ grade_code: "K18", weight_g: "1" }], { paid_amount: -1 }), "VALIDATION");
  });

  it("二重送信しても1件のみ登録される", async () => {
    const name = `二重 太郎 ${uuid().slice(0, 8)}`;
    const payload = { idempotency_key: uuid(), purchased_on: D, customer_name: name, paid_amount: 1000, items: [{ grade_code: "K18", weight_g: "1" }] };
    const rs = await Promise.all([1, 2, 3, 4].map(() => rpc(staffA, "pm_register_purchase", payload)));
    expect(new Set(rs.map((r) => r.purchase_id)).size).toBe(1);
    const c = await superQuery("select count(*)::int c from public.pm_purchases where customer_name = $1", [name]);
    expect(c[0].c).toBe(1);
  });

  it("従業員は他人を担当者に指定できない（代表は代理入力可）", async () => {
    await expectError(buy(staffA, [{ grade_code: "K18", weight_g: "1" }], { staff_id: staffB.id }), "FORBIDDEN");
    const r = await buy(owner, [{ grade_code: "K18", weight_g: "1" }], { staff_id: staffB.id, paid_amount: 10_000 });
    const h = await superQuery("select staff_id, entered_by from public.pm_purchases where id = $1", [r.purchase_id]);
    expect(h[0]).toEqual({ staff_id: staffB.id, entered_by: owner.id });
  });
});

describe("アクセス権限", () => {
  it("従業員は自分の担当取引のみ閲覧でき、他人の顧客情報は取得できない", async () => {
    const b = await signIn(staffB);
    const rows = await b.from("pm_purchases").select("customer_name, customer_phone, customer_address, staff_id");
    expect(rows.error).toBeNull();
    expect(rows.data!.length).toBeGreaterThan(0);
    expect(rows.data!.every((r) => r.staff_id === staffB.id)).toBe(true);
    const items = await b.from("pm_purchase_items").select("purchase_id");
    const own = await superQuery("select id from public.pm_purchases where staff_id = $1", [staffB.id]);
    const ownIds = new Set(own.map((o) => o.id));
    expect(items.data!.every((i) => ownIds.has(i.purchase_id))).toBe(true);
  });

  it("直接書き込み・未ログインでのアクセスはできない", async () => {
    const a = await signIn(staffA);
    const ins = await a.from("pm_purchases").insert({ purchase_no: "X", purchased_on: D, staff_id: staffA.id, entered_by: staffA.id, customer_name: "x", paid_amount: 0, total_metal_value: 999999, idempotency_key: uuid() });
    expect(ins.error).not.toBeNull();
    const up = await a.from("pm_market_prices").update({ unit_price: 1 }).eq("grade_code", "K18");
    expect(up.error).not.toBeNull();
    const anon = anonClient();
    const r = await anon.from("pm_purchases").select("customer_name").limit(1);
    expect(r.error !== null || (r.data ?? []).length === 0).toBe(true);
    const rp = await anon.rpc("pm_register_purchase", { p: {} });
    expect(rp.error).not.toBeNull();
  });

  it("集計: 従業員は自分のみ、従業員別集計は代表・管理者のみ", async () => {
    const s = await rpc(staffA, "pm_report_summary", D, D_NEXT, null);
    expect(s.staff_id).toBe(staffA.id);
    const direct = await superQuery("select count(*)::int c, sum(total_metal_value)::bigint m, sum(expected_profit)::bigint p from public.pm_purchases where staff_id = $1 and status = 'active' and purchased_on between $2 and $3", [staffA.id, D, D_NEXT]);
    expect(s.count).toBe(direct[0].c);
    expect(s.total_metal_value).toBe(direct[0].m);
    expect(s.expected_profit).toBe(direct[0].p);
    await expectError(rpc(staffA, "pm_report_summary", D, D_NEXT, staffB.id), "FORBIDDEN");
    await expectError(query(staffA, "select * from public.pm_report_by_staff($1, $2)", [D, D_NEXT]), "FORBIDDEN");
    const byStaff = await query(owner, "select * from public.pm_report_by_staff($1, $2)", [D, D_NEXT]);
    expect(byStaff.find((r) => r.staff_id === staffA.id)?.count).toBe(direct[0].c);
    const days = await query(staffA, "select * from public.pm_report_timeseries($1, $2, 'day', null)", ["2020-02-01", "2020-02-29"]);
    expect(days).toHaveLength(29);
    expect(days.reduce((a, d) => a + d.count, 0)).toBe(direct[0].c);
  });

  it("取消は代表・管理者のみ、取消後は集計から除外", async () => {
    const r = await buy(staffA, [{ grade_code: "K18", weight_g: "1" }], { paid_amount: 1 });
    await expectError(rpc(staffA, "pm_void_purchase", r.purchase_id, "誤登録"), "FORBIDDEN");
    const before = await rpc(staffA, "pm_report_summary", D, D, null);
    await rpc(owner, "pm_void_purchase", r.purchase_id, "誤登録");
    const after = await rpc(staffA, "pm_report_summary", D, D, null);
    expect(before.count - after.count).toBe(1);
  });
});

describe("SQL と TypeScript の計算一致", () => {
  it("ランダムな重量・単価で一致する", async () => {
    let seed = 11;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
    const cases = Array.from({ length: 300 }, (_, idx) => ({ idx, w: 1 + (rnd() % 5_000_000), p: 1 + (rnd() % 5_000_000) }));
    const rows = await superQuery<{ v: number }>(
      "select app.pm_metal_value((c.w::numeric / 100), (c.p::numeric / 100)) v from jsonb_to_recordset($1::jsonb) c(idx int, w bigint, p bigint) order by c.idx",
      [JSON.stringify(cases)],
    );
    rows.forEach((r, i) => expect(r.v).toBe(metalValue(cases[i].w, cases[i].p)));
  });
});
