import { expect, test } from "@playwright/test";
import { login, users } from "./helpers";
import { setUiMode } from "./mode";

test.beforeAll(async () => setUiMode("simple"));

const customer = `架空 金子${Date.now() % 100000}`;

test("代表が参考相場を登録 → 従業員が複数商品の買取を登録 → 自動計算・履歴・集計", async ({ browser }) => {
  // 代表: 本日の相場を登録
  const o = await browser.newContext();
  const op = await o.newPage();
  await login(op, "owner", "/gold/new");
  await op.goto("/gold/prices");
  await op.getByLabel("K18の相場単価").fill("16500");
  await op.getByLabel("K24の相場単価").fill("21500");
  await op.getByRole("button", { name: "保存", exact: true }).click();
  await op.getByRole("button", { name: "保存する" }).click();
  await expect(op.getByText(/件の相場を保存しました/)).toBeVisible();

  // 従業員A: 買取登録
  const a = await browser.newContext();
  const ap = await a.newPage();
  await login(ap, "staffA", "/gold/new");
  await expect(ap.getByRole("heading", { name: "買取登録" })).toBeVisible();
  await ap.getByLabel("お客様の名前").fill(customer);
  await ap.getByLabel("電話番号").fill("090-0000-0000");
  await ap.getByLabel("住所").fill("東京都架空区1-2-3");
  await ap.getByLabel("1点目の商品名").fill("喜平ネックレス");
  await ap.getByLabel("1点目の品位").selectOption("K18");
  await ap.getByLabel("1点目の重量").fill("10");
  await expect(ap.getByLabel("1点目の相場単価")).toHaveValue("16500");
  await ap.getByRole("button", { name: "商品を追加" }).click();
  await ap.getByLabel("2点目の品位").selectOption("K24");
  await ap.getByLabel("2点目の重量").fill("3.33");
  await ap.getByLabel("お客様に支払った買取金額").fill("200000");
  await ap.getByLabel("お客様に支払った買取金額").blur();
  // 165,000 + 71,595 = 236,595 / 利益 36,595 / 15.5%
  await expect(ap.getByText("236,595円").first()).toBeVisible();
  await expect(ap.getByText("36,595円").first()).toBeVisible();
  await expect(ap.getByText("15.5%").first()).toBeVisible();
  await ap.getByRole("button", { name: "確認", exact: true }).click();
  await ap.getByRole("button", { name: "登録する" }).click();
  await expect(ap.getByText("買取を登録しました")).toBeVisible();

  // 履歴・検索・詳細
  await ap.goto(`/gold?q=${encodeURIComponent(customer)}`);
  await ap.getByRole("link", { name: new RegExp(customer) }).click();
  await expect(ap.getByRole("heading", { name: `${customer} 様` })).toBeVisible();
  await expect(ap.getByText("71,595円")).toBeVisible();
  const detailUrl = ap.url();

  // 相場を修正しても過去の記録は変わらない
  await op.goto("/gold/prices");
  await op.getByLabel("K18の相場単価").fill("99999");
  await op.getByRole("button", { name: "保存", exact: true }).click();
  await op.getByRole("button", { name: "保存する" }).click();
  await expect(op.getByText("件の相場を保存しました")).toBeVisible();
  await ap.reload();
  await expect(ap.getByText("165,000円")).toBeVisible();
  await op.getByLabel("K18の相場単価").fill("16500");
  await op.getByRole("button", { name: "保存", exact: true }).click();
  await op.getByRole("button", { name: "保存する" }).click();

  // 従業員B は A の取引・顧客情報を見られない
  const b = await browser.newContext();
  const bp = await b.newPage();
  await login(bp, "staffB", "/gold/new");
  await bp.goto(`/gold?q=${encodeURIComponent(customer)}`);
  await expect(bp.getByText("該当する買取はありません")).toBeVisible();
  // 詳細URLを直接開いても 404 画面となり、顧客情報は表示されない
  await bp.goto(detailUrl);
  await expect(bp.getByText("This page could not be found.")).toBeVisible();
  expect(await bp.content()).not.toContain(customer);
  expect(await bp.content()).not.toContain("東京都架空区1-2-3");
  // 従業員は相場を登録できない
  await bp.goto("/gold/prices");
  await expect(bp.getByText("相場の登録は代表・管理者が行います。")).toBeVisible();

  // 代表は従業員別集計を見られる
  await op.goto("/gold/reports");
  await expect(op.getByRole("heading", { name: "従業員別" })).toBeVisible();
  await expect(op.getByRole("row", { name: new RegExp(users().users.staffA.name) })).toContainText("36,595円");
  const csv = await op.request.get(`/api/export/gold-staff?from=2026-01-01&to=2030-12-31`);
  expect(csv.status()).toBe(200);
  const forbidden = await bp.request.get(`/api/export/gold-staff?from=2026-01-01&to=2030-12-31`);
  expect(forbidden.status()).toBe(403);

  await Promise.all([o.close(), a.close(), b.close()]);
});

test("相場未登録の品位は警告され、単価を手入力すれば登録できる", async ({ page }) => {
  await login(page, "staffA", "/gold/new");
  await page.getByLabel("お客様の名前").fill(`${customer}-2`);
  await page.getByLabel("1点目の品位").selectOption("Pd1000");
  await expect(page.getByText("参考相場が未登録の品位があります")).toBeVisible();
  await page.getByLabel("1点目の重量").fill("1");
  await page.getByLabel("お客様に支払った買取金額").fill("10000");
  await page.getByRole("button", { name: "確認", exact: true }).click();
  await expect(page.getByText(/相場単価がありません/)).toBeVisible();
  await page.getByLabel("1点目の相場単価").fill("8000");
  await expect(page.getByText("-2,000円").first()).toBeVisible(); // マイナス利益も表示
  await page.getByRole("button", { name: "確認", exact: true }).click();
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByText("買取を登録しました")).toBeVisible();
});

test("相場表の貼り付けで単価を自動入力して保存できる", async ({ page }) => {
  await login(page, "owner", "/gold/new");
  await page.goto("/gold/prices");
  await expect(page.getByRole("link", { name: "ゴールドミセスの相場を開く" })).toHaveAttribute("href", "https://goldmrs.jp/");
  await page.getByPlaceholder(/例:/).fill("Pt900 4,800円\nK10 8,900円\nSV925 120円");
  await page.getByRole("button", { name: "読み取る" }).click();
  await expect(page.getByText("3件を読み取りました")).toBeVisible();
  await expect(page.getByLabel("Pt900の相場単価")).toHaveValue("4800");
  await expect(page.getByLabel("K10の相場単価")).toHaveValue("8900");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "保存する" }).click();
  await expect(page.getByText(/件の相場を保存しました/)).toBeVisible();
});

test("代表は買取記録と相場を削除できる", async ({ browser }) => {
  const a = await browser.newContext();
  const ap = await a.newPage();
  await login(ap, "staffA", "/gold/new");
  const name = `削除対象 ${Date.now() % 100000}`;
  await ap.getByLabel("お客様の名前").fill(name);
  await ap.getByLabel("1点目の品位").selectOption("K18");
  await ap.getByLabel("1点目の重量").fill("1");
  await ap.getByLabel("お客様に支払った買取金額").fill("1000");
  await ap.getByRole("button", { name: "確認", exact: true }).click();
  await ap.getByRole("button", { name: "登録する" }).click();
  await ap.getByRole("link", { name: "登録内容を見る" }).click();
  await ap.waitForURL(/\/gold\/[0-9a-f-]{36}$/);
  const url = ap.url();
  // 従業員には削除ボタンがない
  await expect(ap.getByRole("button", { name: "削除" })).toHaveCount(0);

  const o = await browser.newContext();
  const op = await o.newPage();
  await login(op, "owner", "/gold/new");
  await op.goto(url);
  await op.getByRole("button", { name: "削除" }).click();
  await op.getByPlaceholder("例: テスト入力のため").fill("テスト入力のため");
  await op.getByRole("button", { name: "削除する" }).click();
  await op.waitForURL("**/gold");
  await op.goto(`/gold?q=${encodeURIComponent(name)}`);
  await expect(op.getByText("該当する買取はありません")).toBeVisible();

  // 相場の削除（過去日の相場を作って削除）
  await op.goto("/gold/prices?date=2021-01-05");
  await op.getByLabel("K14の相場単価").fill("11111");
  await op.getByRole("button", { name: "保存", exact: true }).click();
  await op.getByRole("button", { name: "保存する" }).click();
  await expect(op.getByText(/件の相場を保存しました/)).toBeVisible();
  await op.getByRole("button", { name: "2021-01-05の相場を削除" }).click();
  await op.getByRole("button", { name: "削除する" }).click();
  await expect(op.getByRole("button", { name: "2021-01-05の相場を削除" })).toHaveCount(0);
  await Promise.all([a.close(), o.close()]);
});

test("メールアドレスなしのログインIDでログインできる", async ({ page }) => {
  const { config } = await import("dotenv");
  config({ path: ".env.local" });
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.startsWith("/") ? process.env.SUPABASE_INTERNAL_URL! : process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const id = `e2eid${Date.now() % 1000000}`;
  const { error } = await admin.auth.admin.createUser({ email: `${id}@login.saikou.invalid`, password: "IdLogin12345", email_confirm: true, app_metadata: { role: "staff" }, user_metadata: { display_name: "ID従業員" } });
  expect(error).toBeNull();
  await page.goto("/login");
  await page.getByLabel("ログインID または メールアドレス").fill(id.toUpperCase());
  await page.getByLabel("パスワード").fill("IdLogin12345");
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL("**/gold/new");
  await expect(page.getByText("ID従業員").first()).toBeVisible();
});
