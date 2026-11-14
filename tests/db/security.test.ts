import { beforeAll, describe, expect, it } from "vitest";
import {
  anonClient,
  createUser,
  expectError,
  purchase,
  query,
  replenish,
  reserveAccount,
  rpc,
  sell,
  signIn,
  superQuery,
  uuid,
  type PurchaseResult,
  type TestUser,
} from "./helpers";

let owner: TestUser;
let staffA: TestUser;
let staffB: TestUser;
let pA: PurchaseResult;
let saleA: string;

// 1x1 JPEG
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);

beforeAll(async () => {
  owner = await createUser("owner");
  staffA = await createUser("staff", "機密A");
  staffB = await createUser("staff", "機密B");
  await replenish(owner, staffA, 1_000_000);
  pA = await purchase(staffA, [{ cost_incl: 77_777, name: "Aの在庫" }, { cost_incl: 1_000, name: "Aの販売済" }], {
    customer: { name: "架空 太郎", phone: "090-0000-0001" },
    identity: { verification_method: "運転免許証", encrypted_payload: "dGVzdA==", key_version: 1 },
  });
  saleA = (await sell(staffA, [{ item_id: pA.items[1].id, revenue_incl: 5_000 }])).sale_id;
});

describe("従業員は他人の機密情報を取得できない（REST / RLS）", () => {
  it("買取取引・顧客・資金台帳・本人確認記録", async () => {
    const b = await signIn(staffB);
    const tx = await b.from("purchase_transactions").select("*").eq("id", pA.purchase_id);
    expect(tx.error).toBeNull();
    expect(tx.data).toEqual([]);

    const items = await b.from("purchase_items").select("id, cost_incl").in("id", pA.items.map((i) => i.id));
    expect(items.data).toEqual([]);

    const cust = await b.from("customers").select("*").eq("name", "架空 太郎");
    expect(cust.data).toEqual([]);

    const ft = await b.from("fund_transactions").select("*").eq("account_id", await reserveAccount(staffA));
    expect(ft.data).toEqual([]);

    const fa = await b.from("fund_accounts").select("*");
    expect(fa.data?.every((a) => a.owner_profile_id === staffB.id)).toBe(true);

    const idr = await b.from("customer_identity_records").select("*");
    expect(idr.error).not.toBeNull(); // 権限なし

    const audit = await b.from("audit_logs").select("*").limit(1);
    expect(audit.data).toEqual([]);

    const sales = await b.from("sales").select("*").eq("id", saleA);
    expect(sales.data).toEqual([]);
  });

  it("本人確認記録は担当者本人・管理者のみ、閲覧は監査ログに記録される", async () => {
    const rec = await superQuery("select id from public.customer_identity_records where purchase_transaction_id = $1", [pA.purchase_id]);
    expect(await query(staffB, "select * from public.get_identity_record($1, '確認')", [rec[0].id])).toEqual([]);
    const own = await query(staffA, "select * from public.get_identity_record($1, '再来店時の確認')", [rec[0].id]);
    expect(own[0].encrypted_payload).toBe("dGVzdA==");
    const logs = await superQuery(
      "select action, actor_id from public.audit_logs where table_name = 'customer_identity_records' and record_id = $1 order by id",
      [rec[0].id],
    );
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(["identity_access_denied", "identity_view"]));
    // 監査ログに暗号文は複製されない
    const ins = await superQuery("select after_data from public.audit_logs where table_name = 'customer_identity_records' and action = 'insert' and record_id = $1", [rec[0].id]);
    expect(ins[0].after_data.encrypted_payload).toBeUndefined();
  });

  it("他人の在庫は検索できるが原価・製造番号は返らない", async () => {
    const rows = await query(staffB, "select * from public.search_items($1, null, 'all', 'all', null, 50, 0)", ["Aの"]);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(pA.items[0].id); // 在庫中は見える
    expect(ids).not.toContain(pA.items[1].id); // 販売済みの他人商品は見えない
    expect(rows.find((r) => r.id === pA.items[0].id)?.stock_cost).toBeNull();
    const item = await rpc(staffB, "get_item", pA.items[0].id);
    expect(item.cost_incl).toBeNull();
    expect(item.serial_no).toBeNull();
    expect(item.movements).toBeNull();
    await expectError(rpc(staffB, "get_item", pA.items[1].id), "NOT_FOUND");
  });

  it("販売明細の原価列は直接参照できない", async () => {
    const a = await signIn(staffA);
    const r = await a.from("sale_items").select("cost_incl").eq("sale_id", saleA);
    expect(r.error).not.toBeNull();
    const ok = await a.from("sale_items").select("revenue_incl").eq("sale_id", saleA);
    expect(ok.data).toEqual([{ revenue_incl: 5_000 }]);
  });

  it("他人の実績・全社集計は取得できない", async () => {
    await expectError(rpc(staffB, "report_summary", "2000-01-01", "2100-01-01", staffA.id), "FORBIDDEN");
    await expectError(query(staffB, "select * from public.report_staff_ranking('2000-01-01', '2100-01-01')"), "FORBIDDEN");
    await expectError(query(staffB, "select * from public.admin_list_staff()"), "FORBIDDEN");
    // 自分を指定しない場合も自分の範囲に限定される
    const s = await rpc(staffB, "report_summary", "2000-01-01", "2100-01-01", null);
    expect(s.staff_id).toBe(staffB.id);
    expect(s.revenue).toBe(0);
  });

  it("テーブルへの直接書き込みはできない", async () => {
    const a = await signIn(staffA);
    const ins = await a.from("fund_transactions").insert({
      account_id: await reserveAccount(staffA),
      tx_type: "opening",
      amount: 999_999,
      occurred_at: new Date().toISOString(),
      idempotency_key: uuid(),
      created_by: staffA.id,
    });
    expect(ins.error).not.toBeNull();
    const up = await a.from("purchase_items").update({ cost_incl: 1 }).eq("id", pA.items[0].id);
    expect(up.error).not.toBeNull();
    const del = await a.from("sales").delete().eq("id", saleA);
    expect(del.error).not.toBeNull();
    const role = await a.from("profiles").update({ role: "owner" }).eq("id", staffA.id);
    expect(role.error).not.toBeNull();
    await expectError(rpc(staffA, "set_user_role", staffA.id, "owner"), "FORBIDDEN");
    const p = await superQuery("select role from public.profiles where id = $1", [staffA.id]);
    expect(p[0].role).toBe("staff");
  });

  it("未ログイン（anon）は何も取得・実行できない", async () => {
    const anon = anonClient();
    for (const t of ["profiles", "purchase_items", "sales", "fund_transactions", "customers", "app_settings"]) {
      const r = await anon.from(t).select("*").limit(1);
      expect(r.error !== null || (r.data ?? []).length === 0).toBe(true);
    }
    const r = await anon.rpc("report_summary", { p_from: "2000-01-01", p_to: "2100-01-01" });
    expect(r.error).not.toBeNull();
  });

  it("無効化された従業員は操作できない", async () => {
    const s = await createUser("staff");
    await rpc(owner, "set_user_active", s.id, false);
    await expectError(rpc(s, "report_summary", "2000-01-01", "2100-01-01", null), "UNAUTHORIZED");
    const rows = await query(s, "select id from public.profiles");
    expect(rows).toEqual([]);
  });
});

describe("商品写真の非公開アクセス", () => {
  it("担当者はアップロード・閲覧でき、権限のない者はアクセスできない", async () => {
    const a = await signIn(staffA);
    const b = await signIn(staffB);
    const item = pA.items[0].id;
    const sold = pA.items[1].id;
    const path = `items/${item}/${uuid()}.jpg`;
    const soldPath = `items/${sold}/${uuid()}.jpg`;

    const up = await a.storage.from("item-photos").upload(path, JPEG, { contentType: "image/jpeg" });
    expect(up.error).toBeNull();
    const up2 = await a.storage.from("item-photos").upload(soldPath, JPEG, { contentType: "image/jpeg" });
    expect(up2.error).toBeNull();
    await rpc(staffA, "add_item_photo", item, path, "image/jpeg", JPEG.length);

    // 他人の商品フォルダへのアップロードは不可
    const bad = await b.storage.from("item-photos").upload(`items/${item}/${uuid()}.jpg`, JPEG, { contentType: "image/jpeg" });
    expect(bad.error).not.toBeNull();
    // 実在しないパスの登録は不可
    await expectError(rpc(staffA, "add_item_photo", item, `items/${item}/nofile.jpg`, "image/jpeg", 10), "NOT_FOUND");
    await expectError(rpc(staffA, "add_item_photo", item, soldPath, "image/jpeg", 10), "VALIDATION");

    // 本人: 期限付きURLを発行できる
    const signed = await a.storage.from("item-photos").createSignedUrl(path, 60);
    expect(signed.error).toBeNull();
    const res = await fetch(signed.data!.signedUrl);
    expect(res.status).toBe(200);

    // 他人: 販売済み（在庫外）商品の写真は取得できない
    const bs = await b.storage.from("item-photos").createSignedUrl(soldPath, 60);
    expect(bs.error).not.toBeNull();
    const bd = await b.storage.from("item-photos").download(soldPath);
    expect(bd.error).not.toBeNull();

    // 未ログイン・公開URLでは取得できない
    const anon = anonClient();
    const ad = await anon.storage.from("item-photos").download(path);
    expect(ad.error).not.toBeNull();
    const pub = anon.storage.from("item-photos").getPublicUrl(path);
    expect((await fetch(pub.data.publicUrl)).status).toBeGreaterThanOrEqual(400);

    // 削除は Storage から直接はできない
    const rm = await a.storage.from("item-photos").remove([path]);
    expect(rm.data ?? []).toEqual([]);
  });
});
