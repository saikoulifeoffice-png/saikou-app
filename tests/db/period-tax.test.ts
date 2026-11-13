import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { allocate, costForQuantity, taxFromIncl, type RoundingMode, type TaxCategory } from "@/lib/money";
import {
  createUser,
  expectError,
  purchase,
  replenish,
  rpc,
  sell,
  superQuery,
  uuid,
  type TestUser,
} from "./helpers";

let owner: TestUser;
let staff: TestUser;

beforeAll(async () => {
  owner = await createUser("owner");
  staff = await createUser("staff");
  await replenish(owner, staff, 1_000_000);
});

describe("月次締め後の無断変更防止", () => {
  // 他のテストと衝突しない過去月を使用
  const month = "2019-04-01";
  const inMonth = "2019-04-15T03:00:00Z";
  const nextMonth = "2019-05-10T03:00:00Z";

  afterAll(async () => {
    await rpc(owner, "reopen_period", month, "テスト後の解除").catch(() => undefined);
  });

  it("締め済み月への登録・キャンセルを拒否し、返品は当月に計上できる", async () => {
    // 締め前に登録しておく（準備金補充も過去日付で）
    await rpc(owner, "fund_operation", { idempotency_key: uuid(), type: "replenish", account_id: (await superQuery("select id from public.fund_accounts where owner_profile_id = $1", [staff.id]))[0].id, amount: 100_000, occurred_at: "2019-04-01T01:00:00Z" });
    const p = await purchase(staff, [{ cost_incl: 10_000 }, { cost_incl: 5_000 }], { purchased_at: inMonth });
    const s = await sell(staff, [{ item_id: p.items[0].id, revenue_incl: 20_000 }], { sold_at: inMonth });

    await expectError(rpc(staff, "close_period", month, null), "FORBIDDEN");
    await rpc(owner, "close_period", month, "4月締め");

    await expectError(purchase(staff, [{ cost_incl: 1 }], { purchased_at: inMonth }), "PERIOD_CLOSED");
    await expectError(sell(staff, [{ item_id: p.items[1].id, revenue_incl: 1 }], { sold_at: inMonth }), "PERIOD_CLOSED");
    await expectError(rpc(owner, "cancel_sale", s.sale_id, "締め後"), "PERIOD_CLOSED");
    await expectError(rpc(owner, "void_purchase", p.purchase_id, "締め後"), "PERIOD_CLOSED");
    // DB直接（スーパーユーザー）でもトリガーで拒否
    await expectError(superQuery("update public.sales set note = '改ざん' where id = $1", [s.sale_id]), "PERIOD_CLOSED");

    // 締め後の返品は翌月に計上
    const line = await superQuery("select id from public.sale_items where sale_id = $1", [s.sale_id]);
    const ret = await rpc(staff, "register_return", { idempotency_key: uuid(), original_sale_id: s.sale_id, returned_at: nextMonth, lines: [{ sale_item_id: line[0].id }] });
    expect(ret.refund_incl).toBe(20_000);
    // 締め済み月の数値は変わらない
    const april = await rpc(staff, "report_summary", "2019-03-31T15:00:00Z", "2019-04-30T15:00:00Z", null);
    expect(april.revenue).toBe(20_000);
    const may = await rpc(staff, "report_summary", "2019-04-30T15:00:00Z", "2019-05-31T15:00:00Z", null);
    expect(may.revenue).toBe(-20_000);
    // 締め済み月の販売にも入金は記録できる（入金日は当月）
    await rpc(staff, "record_payment", { sale_id: s.sale_id, amount: 20_000, idempotency_key: uuid() });

    // 解除は代表のみ・理由必須
    await expectError(rpc(owner, "reopen_period", month, ""), "VALIDATION");
    await rpc(owner, "reopen_period", month, "訂正のため");
    await purchase(staff, [{ cost_incl: 1 }], { purchased_at: inMonth });
  });
});

describe("税区分が異なる取引の集計", () => {
  afterAll(async () => {
    await rpc(owner, "update_settings", { tax_basis: "incl" });
  });

  it("税込/税抜の基準を混在させずに集計する", async () => {
    const s = await createUser("staff");
    await replenish(owner, s, 1_000_000);
    const p = await purchase(s, [
      { cost_incl: 11_000, tax_category: "standard_10" },
      { cost_incl: 10_800, tax_category: "reduced_8" },
      { cost_incl: 5_000, tax_category: "non_taxable" },
    ]);
    await sell(s, [
      { item_id: p.items[0].id, revenue_incl: 22_000, tax_category: "standard_10" },
      { item_id: p.items[1].id, revenue_incl: 21_600, tax_category: "reduced_8" },
      { item_id: p.items[2].id, revenue_incl: 7_000, tax_category: "tax_free_export" },
    ], { expenses: [{ expense_type: "fee", amount_incl: 1_100, tax_category: "standard_10" }] });

    const range = ["2000-01-01", "2100-01-01"];
    const incl = await rpc(s, "report_summary", ...range, null);
    expect(incl.tax_basis).toBe("incl");
    expect(incl.revenue).toBe(22_000 + 21_600 + 7_000);
    expect(incl.cost_of_sales).toBe(11_000 + 10_800 + 5_000);
    expect(incl.direct_expense).toBe(1_100);

    await expectError(rpc(s, "update_settings", { tax_basis: "excl" }), "FORBIDDEN");
    await rpc(owner, "update_settings", { tax_basis: "excl" });
    const excl = await rpc(s, "report_summary", ...range, null);
    expect(excl.tax_basis).toBe("excl");
    expect(excl.revenue).toBe(20_000 + 20_000 + 7_000);
    expect(excl.cost_of_sales).toBe(10_000 + 10_000 + 5_000);
    expect(excl.direct_expense).toBe(1_000);
    expect(excl.net_profit).toBe(47_000 - 25_000 - 1_000);

    const lines = await superQuery("select si.tax_category, si.revenue_incl, si.revenue_excl, si.revenue_tax from public.sale_items si join public.sales s on s.id = si.sale_id where s.sales_staff_id = $1 order by line_no", [s.id]);
    expect(lines).toEqual([
      { tax_category: "standard_10", revenue_incl: 22_000, revenue_excl: 20_000, revenue_tax: 2_000 },
      { tax_category: "reduced_8", revenue_incl: 21_600, revenue_excl: 20_000, revenue_tax: 1_600 },
      { tax_category: "tax_free_export", revenue_incl: 7_000, revenue_excl: 7_000, revenue_tax: 0 },
    ]);
  });
});

describe("SQL と TypeScript の計算一致", () => {
  it("按分・税額・原価配分が同一結果になる", async () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
    const cats: TaxCategory[] = ["standard_10", "reduced_8", "exempt"];
    const modes: RoundingMode[] = ["floor", "round", "ceil"];
    const cases: { total: number; weights: number[] }[] = [];
    for (let i = 0; i < 200; i++) {
      const n = 1 + (rnd() % 6);
      cases.push({ total: (rnd() % 20_000_000) - (i % 5 === 0 ? 10_000_000 : 0), weights: Array.from({ length: n }, () => (i % 17 === 0 ? 0 : rnd() % 500_000)) });
    }
    const rows = await superQuery<{ r: number[] }>(
      "select app.allocate(c.total, c.weights) as r from jsonb_to_recordset($1::jsonb) as c(idx int, total bigint, weights bigint[]) order by c.idx",
      [JSON.stringify(cases.map((c, idx) => ({ idx, ...c })))],
    );
    rows.forEach((row, i) => expect(row.r.map(Number)).toEqual(allocate(cases[i].total, cases[i].weights)));

    for (let i = 0; i < 100; i++) {
      const amount = (rnd() % 3_000_000) - 1_000_000;
      const cat = cats[i % 3];
      const mode = modes[i % 3];
      const [r] = await superQuery<{ t: number }>("select app.tax_from_incl($1, $2, $3) as t", [amount, cat, mode]);
      expect(r.t).toBe(taxFromIncl(amount, cat, mode));
      const q = 1 + (rnd() % 10);
      const k = 1 + (rnd() % q);
      const c = rnd() % 1_000_000;
      const [cq] = await superQuery<{ v: number }>("select app.cost_for_quantity($1, $2, $3) as v", [c, q, k]);
      expect(cq.v).toBe(costForQuantity(c, q, k));
    }
  });
});
