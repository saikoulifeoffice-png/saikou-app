import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

/** テスト用の架空ユーザー（代表・従業員2名）を作成し、従業員Aに準備金を補充する */
export default async function globalSetup() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  if (!/127\.0\.0\.1|localhost/.test(url)) throw new Error("E2E はローカル Supabase でのみ実行できます");
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const password = `E2e-${randomUUID()}`;
  const tag = randomUUID().slice(0, 6);
  const users: Record<string, { email: string; name: string; id?: string }> = {
    owner: { email: `e2e-owner-${tag}@example.test`, name: `E2E代表${tag}` },
    staffA: { email: `e2e-a-${tag}@example.test`, name: `E2E従業員A${tag}` },
    staffB: { email: `e2e-b-${tag}@example.test`, name: `E2E従業員B${tag}` },
  };
  for (const [k, u] of Object.entries(users)) {
    const { data, error } = await admin.auth.admin.createUser({
      email: u.email, password, email_confirm: true,
      app_metadata: { role: k === "owner" ? "owner" : "staff" }, user_metadata: { display_name: u.name },
    });
    if (error) throw error;
    u.id = data.user.id;
  }
  const owner = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  await owner.auth.signInWithPassword({ email: users.owner.email, password });
  const { data: acc } = await admin.from("fund_accounts").select("id").eq("owner_profile_id", users.staffA.id!).single();
  const { error } = await owner.rpc("fund_operation", { p: { idempotency_key: randomUUID(), type: "replenish", account_id: acc!.id, amount: 1_000_000 } });
  if (error) throw error;
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/e2e-users.json", JSON.stringify({ password, users }));
}
