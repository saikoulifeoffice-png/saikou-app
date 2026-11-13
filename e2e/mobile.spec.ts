import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("スマートフォン: 下部ナビゲーションで主要画面に移動できる", async ({ page }) => {
  await login(page, "staffA");
  const nav = page.getByRole("navigation", { name: "下部メニュー" });
  await expect(nav).toBeVisible();
  await expect(page.getByRole("navigation", { name: "メインメニュー" })).toBeHidden();
  await nav.getByRole("link", { name: "買取" }).click();
  await expect(page.getByRole("heading", { name: "買取登録" })).toBeVisible();
  await expect(page.getByRole("button", { name: "撮影" })).toBeVisible();
  await nav.getByRole("link", { name: "メニュー" }).click();
  await expect(page.getByRole("link", { name: "買取準備金" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});
