import { beforeAll, describe, expect, it } from "vitest";
import { allocate } from "@/lib/money";
import { previewSale } from "@/lib/calc/profit";
import {
  balance,
  createUser,
  expectError,
  purchase,
  query,
  replenish,
  reserveAccount,
  rpc,
  sell,
  stock,
  superQuery,
  uuid,
  type TestUser,
} from "./helpers";

let owner: TestUser;
let buyer: TestUser; // 買取担当
let seller: TestUser; // 販売担当
const farPast = { from: "2000-01-01T00:00:00Z", to: "2100-01-01T00:00:00Z" };

async function summary(user: TestUser, staff: TestUser | null) {
  return rpc(user, "report_summary", farPast.from, farPast.to, staff?.id ?? null);
}

beforeAll(async () => {
  owner = await createUser("owner");
  buyer = await createUser("staff", "買取担当");
  seller = await createUser("staff", "販売担当");
  await replenish(owner, buyer, 2_000_000);
});

describe("販売登録と利益", () => {
  it("売上・原価・利益が反映され、未販売商品は売上原価に入らない", async () => {
    const p = await purchase(buyer, [{ cost_incl: 60_000 }, { cost_incl: 40_000 }]);
    const before = await summary(buyer, buyer);
    expect(before.cost_of_sales).toBe(0);
    expect(before.inventory_cost).toBe(100_000);

    await sell(buyer, [{ item_id: p.items[0].id, revenue_incl: 100_000 }], {
      expenses: [{ expense_type: "fee", amount_incl: 10_000 }],
    });
    const s = await summary(buyer, buyer);
    expect(s.revenue).toBe(100_000);
    expect(s.cost_of_sales).toBe(60_000); // 未販売の40,000円は含まない
    expect(s.gross_profit).toBe(40_000);
    expect(s.direct_expense).toBe(10_000);
    expect(s.net_profit).toBe(30_000);
    expect(s.inventory_cost).toBe(40_000);
    expect(s.sales_count).toBe(1);
    expect((await stock(p.items[0].id)).qty).toBe(0);
    const st = await superQuery("select status from public.purchase_items where id = $1", [p.items[0].id]);
    expect(st[0].status).toBe("sold");
  });

  it("買取担当と販売担当が異なっても、実績は買取担当に帰属し販売担当は別に記録される", async () => {
    const p = await purchase(buyer, [{ cost_incl: 20_000 }]);
    const buyerBefore = await summary(buyer, buyer);
    const sellerBefore = await summary(seller, seller);
    const r = await sell(seller, [{ item_id: p.items[0].id, revenue_incl: 50_000 }], { channel: "auction" });

    const buyerAfter = await summary(buyer, buyer);
    const sellerAfter = await summary(seller, seller);
    expect(buyerAfter.revenue - buyerBefore.revenue).toBe(50_000);
    expect(buyerAfter.net_profit - buyerBefore.net_profit).toBe(30_000);
    expect(sellerAfter.revenue - sellerBefore.revenue).toBe(0);

    const sale = await superQuery("select sales_staff_id from public.sales where id = $1", [r.sale_id]);
    expect(sale[0].sales_staff_id).toBe(seller.id);
    const lines = await superQuery("select purchaser_staff_id from public.sale_items where sale_id = $1", [r.sale_id]);
    expect(lines[0].purchaser_staff_id).toBe(buyer.id);

    // 販売担当は他人の商品の原価を見られない
    const view = await query(seller, "select * from public.get_sale_lines($1)", [r.sale_id]);
    expect(view[0].cost_incl).toBeNull();
    expect(view[0].revenue_incl).toBe(50_000);
    const ownerView = await query(buyer, "select * from public.get_sale_lines($1)", [r.sale_id]);
    expect(ownerView[0].cost_incl).toBe(20_000);
    expect(ownerView[0].profit_incl).toBe(30_000);
  });

  it("複数商品の一括販売: 原価比で売上を、売上比で直接費を按分（合計一致・画面プレビューと一致）", async () => {
    const costs = [33_333, 50_000, 16_667, 1];
    const p = await purchase(buyer, costs.map((c) => ({ cost_incl: c })));
    const r = await sell(
      buyer,
      p.items.map((i) => ({ item_id: i.id })),
      {
        allocation: "cost",
        total_revenue_incl: 250_001,
        expenses: [
          { expense_type: "fee", amount_incl: 25_000 },
          { expense_type: "shipping", amount_incl: 1_201 },
        ],
      },
    );
    const lines = await superQuery(
      "select revenue_incl, direct_expense_incl, cost_incl from public.sale_items where sale_id = $1 order by line_no",
      [r.sale_id],
    );
    const revenues = lines.map((l) => l.revenue_incl);
    expect(revenues).toEqual(allocate(250_001, costs));
    expect(revenues.reduce((a, b) => a + b, 0)).toBe(250_001);
    expect(lines.map((l) => l.direct_expense_incl).reduce((a, b) => a + b, 0)).toBe(26_201);
    expect(lines.map((l) => l.cost_incl)).toEqual(costs);

    const preview = previewSale({ mode: "cost", totalRevenue: 250_001, lines: costs.map((c) => ({ cost: c })), expenses: [25_000, 1_201] });
    expect(preview.lines.map((l) => l.revenue)).toEqual(revenues);
    expect(preview.lines.map((l) => l.directExpense)).toEqual(lines.map((l) => l.direct_expense_incl));

    const header = await superQuery("select revenue_incl, revenue_excl + revenue_tax as chk, direct_expense_incl from public.sales where id = $1", [r.sale_id]);
    expect(header[0]).toEqual({ revenue_incl: 250_001, chk: 250_001, direct_expense_incl: 26_201 });
  });

  it("数量のある商品の分割販売: 原価は残数量で按分し、最後に端数を充当する", async () => {
    const p = await purchase(buyer, [{ cost_incl: 1_000, quantity: 3 }]);
    const id = p.items[0].id;
    await sell(buyer, [{ item_id: id, quantity: 1, revenue_incl: 500 }]);
    expect(await stock(id)).toMatchObject({ qty: 2, cost_incl: 667 });
    let st = await superQuery("select status from public.purchase_items where id = $1", [id]);
    expect(st[0].status).toBe("partially_sold");
    await expectError(sell(buyer, [{ item_id: id, quantity: 3, revenue_incl: 1 }]), "OUT_OF_STOCK");
    await sell(buyer, [{ item_id: id, quantity: 2, revenue_incl: 1_000 }]);
    expect(await stock(id)).toMatchObject({ qty: 0, cost_incl: 0 });
    const costs = await superQuery("select cost_incl from public.sale_items where item_id = $1 order by created_at", [id]);
    expect(costs.map((c) => c.cost_incl)).toEqual([333, 667]);
    st = await superQuery("select status from public.purchase_items where id = $1", [id]);
    expect(st[0].status).toBe("sold");
  });

  it("同じ商品の同時販売は1件のみ成功する", async () => {
    const p = await purchase(buyer, [{ cost_incl: 5_000 }]);
    const results = await Promise.allSettled([
      sell(buyer, [{ item_id: p.items[0].id, revenue_incl: 9_000 }]),
      sell(seller, [{ item_id: p.items[0].id, revenue_incl: 9_500 }]),
      sell(owner, [{ item_id: p.items[0].id, revenue_incl: 9_900 }]),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await stock(p.items[0].id)).qty).toBe(0);
  });

  it("販売の二重送信で二重計上されない", async () => {
    const p = await purchase(buyer, [{ cost_incl: 1_000 }]);
    const payload = { idempotency_key: uuid(), channel: "ec", allocation: "manual", lines: [{ item_id: p.items[0].id, revenue_incl: 3_000 }] };
    const rs = await Promise.all([1, 2, 3].map(() => rpc(buyer, "register_sale", payload)));
    expect(new Set(rs.map((r) => r.sale_id)).size).toBe(1);
    const cnt = await superQuery("select count(*)::int c from public.sale_items where item_id = $1", [p.items[0].id]);
    expect(cnt[0].c).toBe(1);
  });
});

describe("入金管理", () => {
  it("売上計上と入金を別管理し、入金状況を更新する", async () => {
    const p = await purchase(buyer, [{ cost_incl: 1_000 }]);
    const r = await sell(buyer, [{ item_id: p.items[0].id, revenue_incl: 10_000 }], {
      channel: "ec",
      expected_receipt_amount: 9_000,
      payment_due_date: "2026-12-10",
    });
    let s = await superQuery("select payment_status from public.sales where id = $1", [r.sale_id]);
    expect(s[0].payment_status).toBe("unpaid");
    const sum1 = await summary(buyer, buyer);
    await rpc(buyer, "record_payment", { sale_id: r.sale_id, amount: 4_000, idempotency_key: uuid() });
    s = await superQuery("select payment_status from public.sales where id = $1", [r.sale_id]);
    expect(s[0].payment_status).toBe("partial");
    await rpc(buyer, "record_payment", { sale_id: r.sale_id, amount: 5_000, idempotency_key: uuid() });
    s = await superQuery("select payment_status from public.sales where id = $1", [r.sale_id]);
    expect(s[0].payment_status).toBe("paid");
    // 入金しても売上は変わらない
    const sum2 = await summary(buyer, buyer);
    expect(sum2.revenue).toBe(sum1.revenue);
    expect(sum2.receivables).toBe(sum1.receivables - 9_000);
    // 他人の販売には入金を記録できない
    await expectError(rpc(seller, "record_payment", { sale_id: r.sale_id, amount: 1, idempotency_key: uuid() }), "FORBIDDEN");
  });
});

describe("返品・キャンセル", () => {
  it("返品: 在庫が戻り、返品日の期間に売上・原価がマイナス計上される", async () => {
    const acc = await reserveAccount(buyer);
    const p = await purchase(buyer, [{ cost_incl: 40_000 }, { cost_incl: 10_000 }]);
    const fundAfterPurchase = await balance(acc);
    const r = await sell(seller, p.items.map((i, k) => ({ item_id: i.id, revenue_incl: k === 0 ? 70_000 : 20_000 })), {
      expenses: [{ expense_type: "shipping", amount_incl: 1_800 }],
    });
    const before = await summary(buyer, buyer);
    const lines = await superQuery("select id from public.sale_items where sale_id = $1 order by line_no", [r.sale_id]);

    // 販売担当（seller）が1点目を返品
    const ret = await rpc(seller, "register_return", {
      idempotency_key: uuid(),
      original_sale_id: r.sale_id,
      lines: [{ sale_item_id: lines[0].id, quantity: 1 }],
      expenses: [{ expense_type: "shipping", amount_incl: 900 }],
    });
    expect(ret.refund_incl).toBe(70_000);
    expect(await stock(p.items[0].id)).toMatchObject({ qty: 1, cost_incl: 40_000 });
    const st = await superQuery("select status from public.purchase_items where id = $1", [p.items[0].id]);
    expect(st[0].status).toBe("in_stock");

    const after = await summary(buyer, buyer);
    expect(after.revenue - before.revenue).toBe(-70_000);
    expect(after.cost_of_sales - before.cost_of_sales).toBe(-40_000);
    expect(after.direct_expense - before.direct_expense).toBe(900); // 返送料
    expect(after.inventory_cost - before.inventory_cost).toBe(40_000);
    expect(after.return_count - before.return_count).toBe(1);
    // 販売・返品は準備金に影響しない
    expect(await balance(acc)).toBe(fundAfterPurchase);

    // 返品済み数量を超える返品は不可
    await expectError(
      rpc(seller, "register_return", { idempotency_key: uuid(), original_sale_id: r.sale_id, lines: [{ sale_item_id: lines[0].id, quantity: 1 }] }),
      "VALIDATION",
    );
    // 返品のある販売はキャンセル不可
    await expectError(rpc(owner, "cancel_sale", r.sale_id, "誤登録"), "HAS_RETURNS");
    // 再販売できる
    await sell(seller, [{ item_id: p.items[0].id, revenue_incl: 65_000 }]);
  });

  it("キャンセル: 在庫が戻り、売上から除外される（従業員は承認申請が必要）", async () => {
    const p = await purchase(buyer, [{ cost_incl: 8_000 }]);
    const r = await sell(buyer, [{ item_id: p.items[0].id, revenue_incl: 12_000 }]);
    const before = await summary(buyer, buyer);
    await expectError(rpc(buyer, "cancel_sale", r.sale_id, "誤登録"), "FORBIDDEN");
    const req = await rpc(buyer, "create_approval_request", {
      idempotency_key: uuid(),
      request_type: "sale_cancel",
      target_id: r.sale_id,
      reason: "金額誤り",
    });
    await rpc(owner, "decide_approval_request", req.request_id, true, null);
    const after = await summary(buyer, buyer);
    expect(after.revenue - before.revenue).toBe(-12_000);
    expect(after.cost_of_sales - before.cost_of_sales).toBe(-8_000);
    expect(await stock(p.items[0].id)).toMatchObject({ qty: 1, cost_incl: 8_000 });
    const s = await superQuery("select status from public.sales where id = $1", [r.sale_id]);
    expect(s[0].status).toBe("cancelled");
  });

  it("入金済みの販売はキャンセルできない", async () => {
    const p = await purchase(buyer, [{ cost_incl: 100 }]);
    const r = await sell(buyer, [{ item_id: p.items[0].id, revenue_incl: 200 }], { received_now: true });
    await expectError(rpc(owner, "cancel_sale", r.sale_id, "x"), "HAS_PAYMENTS");
  });
});

describe("時系列集計", () => {
  it("実績のない日も0で返す", async () => {
    const rows = await query(buyer, "select * from public.report_timeseries('2001-01-01', '2001-01-07', 'day', null)");
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.revenue === 0 && r.purchase_count === 0)).toBe(true);
    const months = await query(buyer, "select * from public.report_timeseries('2001-01-15', '2001-03-02', 'month', null)");
    expect(months.map((m) => m.bucket.toISOString().slice(0, 7))).toEqual(["2001-01", "2001-02", "2001-03"]);
  });
});
