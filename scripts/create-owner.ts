/**
 * 初期代表（owner）アカウントの作成
 *
 *   npm run create-owner -- --email owner@example.com --name "代表 太郎"
 *
 * - パスワードは対話入力（画面に表示しない）または環境変数 OWNER_PASSWORD
 * - 既に有効な代表が存在する場合は中止（--allow-additional で追加作成）
 * - サービスロールキーはこのスクリプト実行環境（.env.local）からのみ読み込む
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";

config({ path: ".env.local" });
config();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function promptHidden(question: string): Promise<string> {
  const muted = new Writable({ write: (_c, _e, cb) => cb() });
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
  process.stdout.write(question);
  return new Promise((resolve) => rl.question("", (a) => { rl.close(); process.stdout.write("\n"); resolve(a); }));
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const email = arg("email");
  const name = arg("name") ?? "代表";
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY を .env.local に設定してください");
  if (!email) throw new Error("--email を指定してください");

  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { count, error: cErr } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "owner").eq("is_active", true);
  if (cErr) throw cErr;
  if ((count ?? 0) > 0 && !process.argv.includes("--allow-additional")) {
    throw new Error("有効な代表アカウントが既に存在します。追加する場合は --allow-additional を付けてください");
  }

  const password = process.env.OWNER_PASSWORD ?? (await promptHidden("初期パスワード（10文字以上・英字と数字）: "));
  if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) throw new Error("パスワードは10文字以上で英字と数字を含めてください");

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: "owner" },
    user_metadata: { display_name: name },
  });
  if (error) throw error;
  const { data: profile } = await admin.from("profiles").select("role").eq("id", data.user.id).single();
  if (profile?.role !== "owner") throw new Error("プロフィールの権限設定に失敗しました");
  console.log(`代表アカウントを作成しました: ${email}`);
  console.log("ログイン後、アカウント画面でパスワードを変更することを推奨します。");
}

main().catch((e) => {
  console.error(`エラー: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
