// supabase/migrations/*.sql を1ファイルに結合（Supabase ダッシュボードの SQL Editor で一括適用する場合用）
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
const dir = "supabase/migrations";
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const body = files.map((f) => `-- ===== ${f} =====\n${readFileSync(`${dir}/${f}`, "utf8")}`).join("\n\n");
mkdirSync("supabase/bundle", { recursive: true });
writeFileSync("supabase/bundle/all-migrations.sql",
  `-- 自動生成ファイル（npm run db:bundle）。直接編集しないでください。\n-- 新規の Supabase プロジェクトの SQL Editor に貼り付けて1回だけ実行します。\n\n${body}\n`);
console.log(`bundled ${files.length} files`);
