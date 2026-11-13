# 本番公開手順書（Phase 1）

> **重要**: 本番公開、有料プランの契約、実データの投入、既存データの削除は、代表の承認を得てから実施してください。本書は手順の案内であり、開発作業ではこれらを実施していません。

想定構成: **Supabase（Auth / PostgreSQL / Storage）＋ Vercel（Next.js ホスティング）**。他のホスティング（Node.js が動く環境）でも `npm run build && npm start` で動作します。

## 1. Supabase プロジェクトの作成

1. Supabase ダッシュボードで新規プロジェクトを作成（リージョン: **Tokyo (ap-northeast-1)** 推奨）
2. データベースパスワードはパスワード管理ツールに保管
3. プラン選択時の注意（要確認・要承認）
   - 無料プランは一定期間アクセスがないと一時停止される、自動バックアップがない等の制約があります。業務データを扱う場合は有料プラン（日次バックアップ・PITR 等）を検討してください
   - 料金・機能は契約時点の公式情報を確認してください

## 2. マイグレーションの適用

```bash
npx supabase login
npx supabase link --project-ref <プロジェクトREF>
npx supabase db push          # supabase/migrations を本番に適用
```

適用後、Supabase の SQL エディタで確認:

```sql
select count(*) from public.item_categories;          -- 10
select id, public from storage.buckets;              -- item-photos / false
select relname, relrowsecurity from pg_class
  where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1;  -- すべて true
```

## 3. Auth 設定（ダッシュボード → Authentication）

| 項目 | 設定 |
|---|---|
| Allow new users to sign up | **OFF**（アカウントは代表が発行） |
| Site URL | 本番 URL（例 `https://manager.example.co.jp`） |
| Redirect URLs | 本番 URL |
| パスワード要件 | 最小 10 文字・英数字 |
| SMTP | パスワード再設定メール等を使う場合は独自 SMTP を設定（Phase 1 の画面ではメール送信を使用していません） |
| MFA | 代表・管理者は TOTP の有効化を推奨（Phase 1 の画面は未対応、要検討） |

## 4. 環境変数（Vercel → Settings → Environment Variables）

| 変数 | 公開範囲 | 内容 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ブラウザ | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ブラウザ | anon（publishable）key |
| `SUPABASE_SERVICE_ROLE_KEY` | **サーバーのみ** | service_role（secret）key。従業員アカウント作成にのみ使用 |
| `IDENTITY_ENCRYPTION_KEYS` | **サーバーのみ** | `1:<base64 32バイト>`。開発用とは別の鍵を生成 |
| `IDENTITY_ENCRYPTION_KEY_VERSION` | サーバーのみ | `1` |
| `NEXT_PUBLIC_SITE_URL` | ブラウザ | 本番 URL |

- 暗号化鍵を紛失すると本人確認情報を復号できなくなります。**パスワード管理ツール等で厳重にバックアップ**してください
- 鍵のローテーション: 新しい版を `IDENTITY_ENCRYPTION_KEYS=1:<旧>,2:<新>` のように追加し `IDENTITY_ENCRYPTION_KEY_VERSION=2` に変更（旧データは旧鍵で復号可能。再暗号化ツールは未実装）

## 5. デプロイ

1. Vercel で GitHub リポジトリをインポート（Framework: Next.js）
2. 環境変数を設定してデプロイ
3. 独自ドメインを設定し HTTPS を確認

## 6. 初期代表アカウントの作成

作業端末の `.env.local` に本番の URL とサービスロールキーを一時的に設定し:

```bash
npm run create-owner -- --email <代表のメール> --name "<氏名>"
```

作業後、作業端末の `.env.local` から本番のサービスロールキーを削除してください。

## 7. 公開前チェックリスト

- [ ] 代表でログインし、従業員アカウントを発行できる
- [ ] 従業員でログインし、買取登録（写真付き）→ 販売登録 → 個人実績に反映される
- [ ] 従業員が全社ダッシュボード・他人の準備金を閲覧できない
- [ ] スマートフォン（iOS Safari / Android Chrome）でカメラ撮影・ホーム画面追加ができる
- [ ] 会計期間の締め・税基準・本人確認の保存年数を代表が確認した（`docs/open-issues.md`）
- [ ] バックアップ方針（Supabase のバックアップ設定、定期エクスポート）を決定した
- [ ] **デモデータを投入していない**（`seed:demo` はローカル専用で、本番 URL では実行を拒否します）

## 8. 運用

- マイグレーション追加時: ローカルで `npm run db:reset && npm run test:db` を通してから `npx supabase db push`
- 監査ログ（`audit_logs`）は追記専用。容量が増えた場合のアーカイブ方針は要検討
- 障害時: Vercel の以前のデプロイにロールバック可能。DB は Supabase のバックアップから復元（プランによる）
