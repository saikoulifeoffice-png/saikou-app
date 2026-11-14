import { expect, test } from "@playwright/test";
import { login } from "./helpers";
import { setUiMode } from "./mode";

test.beforeAll(async () => setUiMode("simple"));

test("スマートフォン（簡易版）: 下部ナビゲーションで主要画面に移動できる", async ({ page }) => {
  await login(page, "staffA", "/gold/new");
  const nav = page.getByRole("navigation", { name: "下部メニュー" });
  await expect(nav).toBeVisible();
  await expect(page.getByRole("navigation", { name: "メインメニュー" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "買取登録" })).toBeVisible();
  for (const [label, heading] of [["履歴", "買取履歴"], ["相場", "参考相場の管理"], ["集計", "買取集計"], ["買取", "買取登録"]] as const) {
    await nav.getByRole("link", { name: label, exact: true }).click();
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  }
  await nav.getByRole("link", { name: "メニュー" }).click();
  await expect(page.getByRole("link", { name: "アカウント・パスワード" })).toBeVisible();
});
