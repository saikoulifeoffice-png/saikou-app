import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";

export function users(): { password: string; users: Record<"owner" | "staffA" | "staffB", { email: string; name: string; id: string }> } {
  return JSON.parse(readFileSync("test-results/e2e-users.json", "utf8"));
}

export async function login(page: Page, who: "owner" | "staffA" | "staffB") {
  const u = users();
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(u.users[who].email);
  await page.getByLabel("パスワード").fill(u.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL("**/home");
}
