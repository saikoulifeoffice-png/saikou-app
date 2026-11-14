import { beforeAll, describe, expect, it } from "vitest";
import {
  balance,
  categoryId,
  createUser,
  expectError,
  purchase,
  query,
  replenish,
  reserveAccount,
  rpc,
  stock,
  superQuery,
  uuid,
  type TestUser,
} from "./helpers";

let owner: TestUser;
let admin: TestUser;
let staffA: TestUser;
let staffB: TestUser;

beforeAll(async () => {
  owner = await createUser("owner", "代表テスト");
  admin = await createUser("admin", "管理者テスト");
  staffA = await createUser("staff", "従業員A");
  staffB = await createUser("staff", "従業員B");
});

describe("ユーザー作成", () => {
  it("プロフィールと準備金口座が自動作成される", async () => {
    const p = await superQuery("select role, display_name from public.profiles where id = $1", [staffA.id]);
    expect(p[0]).toEqual({ role: "staff", display_name: "従業員A" });
    expect(await reserveAccount(staffA)).toBeTruthy();
  });
});

describe("買取登録", () => {
  it("在庫が増え、担当者の準備金が減る（資金台帳と原価が一致）", async () => {
    await replenish(owner, staffA, 500_000);
    const acc = await reserveAccount(staffA);
    expect(await balance(acc)).toBe(500_000);

    const r = await purchase(staffA, [{ cost_incl: 120_000 }, { cost_incl: 30_000, quantity: 3 }]);
    expect(r.items).toHaveLength(2);
    expect(r.purchase_no).toMatch(/^P\d{4}-\d{6}$/);
    expect(r.items[0].item_no).toMatch(/^K\d{4}-\d{6}$/);

    expect(await stock(r.items[0].id)).toMatchObject({ qty: 1, cost_incl: 120_000 });
    expect(await stock(r.items[1].id)).toMatchObject({ qty: 3, cost_incl: 30_000 });
    expect(await balance(acc)).toBe(350_000);

    const tx = await superQuery("select total_incl, total_excl, total_tax from public.purchase_transactions where id = $1", [r.purchase_id]);
    expect(tx[0].total_incl).toBe(150_000);
    expect(tx[0].total_excl + tx[0].total_tax).toBe(150_000);
    const ft = await superQuery("select sum(amount)::bigint as s from public.fund_transactions where purchase_transaction_id = $1", [r.purchase_id]);
    expect(ft[0].s).toBe(-150_000);
  });

  it("残高不足の場合は登録を拒否し、何も記録しない", async () => {
    const acc = await reserveAccount(staffA);
    const before = await balance(acc);
    const cnt = await superQuery("select count(*)::int as c from public.purchase_transactions where staff_id = $1", [staffA.id]);
    await expectError(purchase(staffA, [{ cost_incl: before + 1 }]), "INSUFFICIENT_FUNDS");
    expect(await balance(acc)).toBe(before);
    const cnt2 = await superQuery("select count(*)::int as c from public.purchase_transactions where staff_id = $1", [staffA.id]);
    expect(cnt2[0].c).toBe(cnt[0].c);
  });

  it("振込買取は会社口座から支払われ、準備金は減らない", async () => {
    const acc = await reserveAccount(staffA);
    const before = await balance(acc);
    const r = await purchase(staffA, [{ cost_incl: 1_000_000 }], { payment_method: "bank_transfer" });
    expect(await balance(acc)).toBe(before);
    const t = await superQuery(
      "select a.kind from public.purchase_transactions t join public.fund_accounts a on a.id = t.fund_account_id where t.id = $1",
      [r.purchase_id],
    );
    expect(t[0].kind).toBe("company_bank");
  });

  it("従業員は他人を担当者に指定できない", async () => {
    await expectError(purchase(staffA, [{ cost_incl: 1000 }], { staff_id: staffB.id }), "FORBIDDEN");
  });

  it("管理者は代理入力でき、実績は指定した担当者に帰属する", async () => {
    await replenish(owner, staffB, 100_000);
    const r = await purchase(admin, [{ cost_incl: 10_000 }], { staff_id: staffB.id });
    const t = await superQuery("select staff_id, entered_by from public.purchase_transactions where id = $1", [r.purchase_id]);
    expect(t[0]).toEqual({ staff_id: staffB.id, entered_by: admin.id });
    expect(await balance(await reserveAccount(staffB))).toBe(90_000);
  });

  it("同じ冪等キーの再送・同時送信で二重計上されない", async () => {
    const acc = await reserveAccount(staffA);
    const before = await balance(acc);
    const cat = await categoryId();
    const payload = {
      idempotency_key: uuid(),
      method: "store",
      payment_method: "cash",
      items: [{ category_id: cat, name: "二重送信テスト", condition: "A", quantity: 1, cost_incl: 5_000 }],
    };
    const results = await Promise.all(Array.from({ length: 6 }, () => rpc(staffA, "register_purchase", payload)));
    const ids = new Set(results.map((r) => r.purchase_id));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(await balance(acc)).toBe(before - 5_000);
  });

  it("異なる操作の同時登録でも残高がマイナスにならない", async () => {
    const staff = await createUser("staff");
    await replenish(owner, staff, 50_000);
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () => purchase(staff, [{ cost_incl: 10_000 }])),
    );
    const ok = attempts.filter((a) => a.status === "fulfilled").length;
    expect(ok).toBe(5);
    expect(await balance(await reserveAccount(staff))).toBe(0);
    for (const a of attempts) {
      if (a.status === "rejected") expect(String(a.reason)).toContain("INSUFFICIENT_FUNDS");
    }
  });
});

describe("買取取消・セット分割", () => {
  it("取消で在庫が戻り（除外され）、準備金に返金される", async () => {
    const acc = await reserveAccount(staffA);
    const before = await balance(acc);
    const r = await purchase(staffA, [{ cost_incl: 7_000 }]);
    expect(await balance(acc)).toBe(before - 7_000);
    await expectError(rpc(staffA, "void_purchase", r.purchase_id, "誤登録"), "FORBIDDEN");
    await rpc(admin, "void_purchase", r.purchase_id, "誤登録");
    expect(await balance(acc)).toBe(before);
    expect((await stock(r.items[0].id)).qty).toBe(0);
    const it = await superQuery("select status from public.purchase_items where id = $1", [r.items[0].id]);
    expect(it[0].status).toBe("voided");
    // 再実行しても二重返金しない
    await rpc(admin, "void_purchase", r.purchase_id, "誤登録");
    expect(await balance(acc)).toBe(before);
  });

  it("セット商品を分割し、原価合計を保つ", async () => {
    const r = await purchase(staffA, [{ cost_incl: 10_000, name: "時計セット" }]);
    await expectError(
      rpc(staffA, "split_item", { item_id: r.items[0].id, idempotency_key: uuid(), children: [{ name: "a", cost_incl: 1 }, { name: "b", cost_incl: 2 }] }),
      "TOTAL_MISMATCH",
    );
    const out = await rpc(staffA, "split_item", {
      item_id: r.items[0].id,
      idempotency_key: uuid(),
      children: [
        { name: "本体", cost_incl: 7_000 },
        { name: "付属ベルト", cost_incl: 3_000 },
      ],
    });
    expect(out.children).toHaveLength(2);
    expect((await stock(r.items[0].id)).qty).toBe(0);
    const s1 = await stock(out.children[0].id);
    const s2 = await stock(out.children[1].id);
    expect(s1.cost_incl + s2.cost_incl).toBe(10_000);
    const parent = await superQuery("select cost_excl from public.purchase_items where id = $1", [r.items[0].id]);
    expect(s1.cost_excl + s2.cost_excl).toBe(parent[0].cost_excl);
    // 他の従業員は分割できない
    const r2 = await purchase(staffA, [{ cost_incl: 100 }]);
    await expectError(
      rpc(staffB, "split_item", { item_id: r2.items[0].id, idempotency_key: uuid(), children: [{ name: "a", cost_incl: 50 }, { name: "b", cost_incl: 50 }] }),
      "FORBIDDEN",
    );
  });
});

describe("資金台帳", () => {
  it("従業員間移動は原子的で貸借が一致する", async () => {
    const x = await createUser("staff");
    const y = await createUser("staff");
    await replenish(owner, x, 30_000);
    const ax = await reserveAccount(x);
    const ay = await reserveAccount(y);
    await rpc(owner, "fund_operation", { idempotency_key: uuid(), type: "transfer", account_id: ax, counterpart_account_id: ay, amount: 12_000 });
    expect(await balance(ax)).toBe(18_000);
    expect(await balance(ay)).toBe(12_000);
    const g = await superQuery("select transfer_group_id, sum(amount)::bigint s, count(*)::int c from public.fund_transactions where account_id in ($1,$2) and tx_type = 'transfer' group by 1", [ax, ay]);
    expect(g).toHaveLength(1);
    expect(g[0].s).toBe(0);
    expect(g[0].c).toBe(2);
    // 残高を超える移動は拒否
    await expectError(
      rpc(owner, "fund_operation", { idempotency_key: uuid(), type: "transfer", account_id: ax, counterpart_account_id: ay, amount: 18_001 }),
      "INSUFFICIENT_FUNDS",
    );
    // 同じキーの再送は二重計上しない
    const key = uuid();
    await rpc(owner, "fund_operation", { idempotency_key: key, type: "return_to_company", account_id: ax, amount: 1_000 });
    await rpc(owner, "fund_operation", { idempotency_key: key, type: "return_to_company", account_id: ax, amount: 1_000 });
    expect(await balance(ax)).toBe(17_000);
  });

  it("従業員は資金操作を直接実行できず、承認申請 → 承認で反映される", async () => {
    const s = await createUser("staff");
    const acc = await reserveAccount(s);
    await expectError(rpc(s, "fund_operation", { idempotency_key: uuid(), type: "replenish", account_id: acc, amount: 1000 }), "FORBIDDEN");
    const req = await rpc(s, "create_approval_request", {
      idempotency_key: uuid(),
      request_type: "fund_replenish",
      payload: { amount: 40_000 },
      reason: "週末の出張買取のため",
    });
    expect(await balance(acc)).toBe(0);
    await expectError(rpc(s, "decide_approval_request", req.request_id, true, null), "FORBIDDEN");
    await rpc(owner, "decide_approval_request", req.request_id, true, "承認");
    expect(await balance(acc)).toBe(40_000);
    // 二重承認しても二重計上しない
    const again = await rpc(owner, "decide_approval_request", req.request_id, true, "承認");
    expect(again.duplicate).toBe(true);
    expect(await balance(acc)).toBe(40_000);
  });

  it("従業員間移動の申請（移動先は従業員IDで指定）→ 承認で原子的に移動", async () => {
    const x = await createUser("staff");
    const y = await createUser("staff");
    await replenish(owner, x, 20_000);
    await expectError(
      rpc(x, "create_approval_request", { idempotency_key: uuid(), request_type: "fund_transfer", target_id: await reserveAccount(y), payload: { amount: 1, to_profile_id: x.id }, reason: "他人口座" }),
      "FORBIDDEN",
    );
    const req = await rpc(x, "create_approval_request", {
      idempotency_key: uuid(), request_type: "fund_transfer", payload: { amount: 8_000, to_profile_id: y.id }, reason: "応援出張",
    });
    await rpc(owner, "decide_approval_request", req.request_id, true, null);
    expect(await balance(await reserveAccount(x))).toBe(12_000);
    expect(await balance(await reserveAccount(y))).toBe(8_000);
  });

  it("自分の申請は承認できない", async () => {
    const req = await rpc(admin, "create_approval_request", {
      idempotency_key: uuid(),
      request_type: "fund_adjustment",
      target_id: await reserveAccount(staffB),
      payload: { amount: -100 },
      reason: "現金過不足",
    });
    await expectError(rpc(admin, "decide_approval_request", req.request_id, true, null), "FORBIDDEN");
    await rpc(owner, "decide_approval_request", req.request_id, true, null);
  });

  it("現金照合は差異を記録し、残高は自動で変更しない", async () => {
    const s = await createUser("staff");
    await replenish(owner, s, 10_000);
    const acc = await reserveAccount(s);
    const r = await rpc(s, "record_reconciliation", acc, 9_500, "実査");
    expect(r.difference).toBe(-500);
    expect(await balance(acc)).toBe(10_000);
    await expectError(rpc(staffA, "record_reconciliation", acc, 0, null), "FORBIDDEN");
  });

  it("資金台帳は更新・削除できない（スーパーユーザーでも）", async () => {
    const acc = await reserveAccount(staffA);
    await expectError(superQuery("update public.fund_transactions set amount = 1 where account_id = $1", [acc]), "IMMUTABLE");
    await expectError(superQuery("delete from public.fund_transactions where account_id = $1", [acc]), "IMMUTABLE");
  });

  it("従業員の残高照会は自分の口座のみ", async () => {
    const rows = await query(staffA, "select * from public.fund_balances()");
    expect(rows.every((r) => r.owner_profile_id === staffA.id)).toBe(true);
    const all = await query(owner, "select * from public.fund_balances()");
    expect(all.length).toBeGreaterThan(2);
  });
});
