import { expect, test } from "@playwright/test";
import { login, users } from "./helpers";
import { setUiMode } from "./mode";

// このファイルは全機能モードの画面を検証する
test.beforeAll(async () => setUiMode("full"));
test.afterAll(async () => setUiMode("simple"));

test("未ログインはログイン画面へリダイレクトされる", async ({ page }) => {
  await page.goto("/funds");
  await expect(page).toHaveURL(/\/login\?next=%2Ffunds/);
  await expect(page.getByRole("heading", { name: "ログイン" })).toBeVisible();
});

test("誤ったパスワードではログインできない", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(users().users.staffA.email);
  await page.getByLabel("パスワード").fill("wrong-password-1");
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByText("メールアドレスまたはパスワードが正しくありません")).toBeVisible();
});

test("買取登録（写真付き）→ 在庫 → 他の従業員が販売 → 実績は買取担当に帰属", async ({ browser }) => {
  const itemName = `E2Eテスト時計 ${Date.now()}`;
  // 従業員A: 買取登録
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  await login(a, "staffA");
  await expect(a.getByText("1,000,000")).toBeVisible();
  await a.goto("/purchases/new");
  await a.getByPlaceholder("例: サブマリーナ デイト").fill(itemName);
  await a.getByLabel("商品1の買取金額").fill("120000");
  await a.getByLabel("商品1の買取金額").blur();
  await a.locator('input[type=file][multiple]').first().setInputFiles("e2e/fixtures/sample.jpg");
  await expect(a.getByText("1/20枚")).toBeVisible();
  await a.getByRole("button", { name: "確認へ" }).click();
  await expect(a.getByRole("dialog")).toContainText("120,000円");
  await a.getByRole("button", { name: "この内容で登録" }).click();
  await expect(a.getByText("買取を登録しました")).toBeVisible();
  await expect(a.getByText(/写真 1\/1枚を保存しました/)).toBeVisible({ timeout: 20_000 });

  // 買取取引詳細・商品詳細が表示される
  await a.getByRole("link", { name: "買取取引を見る" }).click();
  await expect(a.getByRole("heading", { name: /^買取 P\d{4}-\d{6}$/ })).toBeVisible();
  await a.getByRole("link", { name: new RegExp(itemName) }).click();
  await expect(a.getByRole("heading", { name: itemName })).toBeVisible();
  await expect(a.getByAltText("商品写真1")).toBeVisible();
  await expect(a.getByText("120,000円").first()).toBeVisible();

  // 準備金が減っている
  await a.goto("/funds");
  await expect(a.getByText("880,000").first()).toBeVisible();

  // 在庫一覧に写真付きで表示される（期限付きURL）
  await a.goto(`/items?q=${encodeURIComponent(itemName)}`);
  const img = a.locator("li img").first();
  await expect(img).toBeVisible();
  expect(await img.getAttribute("src")).toContain("token=");

  // 従業員B: 他人の在庫を販売（原価は見えない）
  const ctxB = await browser.newContext();
  const b = await ctxB.newPage();
  await login(b, "staffB");
  await b.goto("/sales/new");
  await b.getByLabel("在庫検索").fill(itemName);
  await b.getByRole("button", { name: "検索" }).click();
  await b.getByRole("button", { name: new RegExp(itemName) }).click();
  await expect(b.getByText("原価非表示").first()).toBeVisible();
  await b.getByLabel(`${itemName}の販売金額`).fill("200000");
  await b.getByLabel(`${itemName}の販売金額`).blur();
  await b.getByRole("button", { name: "確認へ" }).click();
  await b.getByRole("button", { name: "この内容で登録" }).click();
  await expect(b.getByText("販売を登録しました")).toBeVisible();

  // 二重送信防止: 同じ画面で再送しても重複しない（ボタンは結果画面に置き換わる）
  await b.getByRole("link", { name: "販売詳細を見る" }).click();
  await expect(b.getByText("原価非表示").first()).toBeVisible();

  // 従業員Aの個人実績に売上・利益が反映される
  await a.goto("/home");
  await expect(a.locator("text=売上").first()).toBeVisible();
  await a.goto("/performance");
  await expect(a.getByText("200,000").first()).toBeVisible();
  await expect(a.getByText("80,000").first()).toBeVisible();

  // 従業員Bの個人実績には計上されない
  await b.goto("/performance");
  const revenueCard = b.locator("div", { hasText: /^売上/ }).first();
  await expect(revenueCard).toBeVisible();
  await expect(b.getByText("200,000円")).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});

test("従業員は全社ダッシュボード・設定にアクセスできない", async ({ page }) => {
  await login(page, "staffB");
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/home\?denied=1/);
  await expect(page.getByText("そのページを表示する権限がありません")).toBeVisible();
  const res = await page.request.get("/api/export/ranking?from=2026-01-01&to=2026-12-31");
  expect(res.status()).toBe(403);
});

test("代表は全社ダッシュボードとCSVを取得できる", async ({ page }) => {
  await login(page, "owner");
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "全社ダッシュボード" })).toBeVisible();
  const res = await page.request.get("/api/export/timeseries?from=2026-11-01&to=2026-11-30&grain=day");
  expect(res.status()).toBe(200);
  const text = await res.text();
  expect(text.split("\r\n").length).toBeGreaterThan(30); // 実績のない日も含めて全日出力
});

test("従業員の資金補充申請 → 代表の承認で残高に反映", async ({ browser }) => {
  const s = await browser.newContext();
  const sp = await s.newPage();
  await login(sp, "staffB");
  await sp.goto("/funds");
  await sp.getByRole("button", { name: "補充を申請" }).click();
  await sp.getByLabel("金額").fill("30000");
  await sp.getByRole("dialog").getByRole("textbox").last().fill("出張買取の準備");
  await sp.getByRole("button", { name: "申請する" }).click();
  await expect(sp.getByText("承認待ち").first()).toBeVisible();

  const o = await browser.newContext();
  const op = await o.newPage();
  await login(op, "owner");
  await op.goto("/approvals");
  const row = op.locator("li", { hasText: "出張買取の準備" });
  await row.getByRole("button", { name: "承認" }).click();
  await op.getByRole("button", { name: "承認する" }).click();
  await expect(op.locator("li", { hasText: "出張買取の準備" })).toHaveCount(0);

  await sp.goto("/funds");
  await expect(sp.getByText("30,000").first()).toBeVisible();
  await s.close();
  await o.close();
});
