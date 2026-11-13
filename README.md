# 買取SAIKOU Manager

株式会社saikou「買取SAIKOU」の業務管理 Web アプリです。買取・販売・経費・資金移動を入力すると、全社と個人の売上・利益・買取使用金額・買取準備金・在庫が自動で集計されます。

- 現在の実装範囲: **Phase 1**（認証、買取登録、商品写真、在庫、販売、資金台帳、基本ダッシュボード）
- 設計: [`docs/phase1-design.md`](docs/phase1-design.md)
- 本番公開手順: [`docs/deployment.md`](docs/deployment.md)
- 未実装・要確認事項: [`docs/open-issues.md`](docs/open-issues.md)

## 技術構成

| 区分 | 採用技術 |
|---|---|
| フロントエンド | Next.js 16 (App Router) / React 19 / TypeScript strict / Tailwind CSS 4 / shadcn/ui 方式のコンポーネント（`components/ui`）/ Recharts / React Hook Form / Zod |
| バックエンド | Supabase（Auth・PostgreSQL・Storage）、PostgreSQL RLS、業務処理は PostgreSQL 関数（RPC）で原子的に実行 |
| テスト | Vitest（単体・DB統合）、Playwright（E2E） |
| その他 | PWA（manifest + Service Worker）、日本語 UI、日本円、Asia/Tokyo |

金額はすべて**整数の円**（DB は `bigint`、TS は安全整数 + 内部計算は `BigInt`）で扱い、浮動小数点演算は使いません。

## ディレクトリ

```
app/                 画面（(app) 配下はログイン必須）・Server Actions・CSV出力 API
components/          画面部品（ui/ は shadcn/ui 方式の基本部品）
lib/money            金額計算（按分・税額・原価配分）※DB と同一仕様
lib/calc             利益計算
lib/validation       Zod スキーマ（クライアント/サーバー共用）
lib/supabase         Supabase クライアント（server / browser / admin）
lib/crypto           本人確認情報の暗号化（AES-256-GCM）
supabase/migrations  SQL マイグレーション（スキーマ・トリガー・RPC・集計・RLS・Storage）
scripts/             初期代表作成・架空デモデータ投入
tests/unit           単体テスト
tests/db             DB 統合テスト（実 Auth・RLS・RPC・Storage）
e2e/                 Playwright E2E
```

## ローカル開発のセットアップ

前提: Node.js 22 以上、Docker（ローカル Supabase 用）

```bash
# 1. 依存関係
npm install

# 2. ローカル Supabase を起動（初回はイメージ取得に数分かかります）
npx supabase start
#    マイグレーションは自動で適用されます。作り直す場合: npm run db:reset

# 3. 環境変数
cp .env.example .env.local
#    npx supabase status の API_URL / ANON_KEY / SERVICE_ROLE_KEY を記入
#    暗号化鍵を生成して IDENTITY_ENCRYPTION_KEYS=1:<生成値> に記入
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 4. 初期代表アカウントの作成（下記参照）
npm run create-owner -- --email owner@example.com --name "代表 太郎"

# 5. （任意）架空デモデータ
DEMO_PASSWORD=任意の10文字以上英数字 npm run seed:demo

# 6. 起動
npm run dev        # http://localhost:3000
```

### スマホ等の別端末から確認する（同一オリジン経由モード）

ローカル Supabase（127.0.0.1）にスマホから直接つながらない場合、アプリ経由で Supabase に接続するモードで起動します。

```bash
export NEXT_PUBLIC_SUPABASE_URL=/sb SUPABASE_INTERNAL_URL=http://127.0.0.1:54321
npm run build && npm start -- -H 0.0.0.0
```

ブラウザは `/sb/*` 経由で認証・写真保存に接続し、サーバーが Supabase へ転送します（`next.config.ts` の rewrites）。

## 初期管理者（代表）の安全な作成手順

1. `.env.local`（Git 管理外）に `NEXT_PUBLIC_SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` を設定します。サービスロールキーは**サーバー/作業端末のみ**に置き、チャット・メール・リポジトリに貼らないでください。
2. 次を実行します。パスワードは画面に表示されない対話入力です（CI 等では環境変数 `OWNER_PASSWORD` も可）。
   ```bash
   npm run create-owner -- --email <代表のメールアドレス> --name "<氏名>"
   ```
3. スクリプトは「有効な代表が既に存在する場合」は中止します（2人目以降は `--allow-additional`）。
4. 作成後、代表はログインして「アカウント」画面でパスワードを変更し、以降の従業員アカウントは「従業員・権限」画面から発行します（代表のみ）。
5. 一般公開のサインアップは無効化しています（`supabase/config.toml` の `enable_signup = false`。本番プロジェクトでも同様に設定してください）。

権限（`owner` / `admin` / `staff`）はサーバー側でのみ設定可能な `app_metadata.role` と `profiles.role` で管理し、利用者が自分で変更することはできません。

## コマンド

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー |
| `npm run build` / `npm start` | 本番ビルド / 起動 |
| `npm run lint` / `npm run typecheck` | ESLint / 型チェック |
| `npm test` | 単体テスト |
| `npm run test:db` | DB 統合テスト（ローカル Supabase 起動が必要） |
| `npm run test:e2e` | E2E（ローカル Supabase + `npm run build` 済みであること） |
| `npm run db:reset` | ローカル DB を作り直してマイグレーションを再適用 |
| `npm run db:types` | DB 型定義（`lib/supabase/database.types.ts`）を再生成 |

E2E でインストール済み Chromium を使う場合は `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome` を指定してください。

## テストで検証している主な要件

| 要件 | テスト |
|---|---|
| 買取登録後に在庫が増える / 担当者の準備金が減る | `tests/db/purchase-funds.test.ts` |
| 販売で売上・原価・利益が反映、未販売商品は売上原価に入らない | `tests/db/sales.test.ts` |
| 買取担当と販売担当が違っても実績は買取担当に帰属 | `tests/db/sales.test.ts`, `e2e/flow.spec.ts` |
| 複数商品一括販売の配分（DB と画面プレビューの一致） | `tests/db/sales.test.ts` |
| 返品・キャンセルで残高と在庫が整合 | `tests/db/sales.test.ts` |
| 同時登録・二重送信で二重計上されない | `tests/db/purchase-funds.test.ts`, `tests/db/sales.test.ts` |
| 従業員が他人の機密情報を取得できない（REST/RLS・列権限） | `tests/db/security.test.ts` |
| 写真の非公開アクセス | `tests/db/security.test.ts` |
| 月次締め後の無断変更防止 | `tests/db/period-tax.test.ts` |
| 税区分が異なる取引の集計（税込/税抜の切替） | `tests/db/period-tax.test.ts` |
| SQL と TypeScript の計算一致（按分・税額・原価配分） | `tests/db/period-tax.test.ts` |

## セキュリティ上の要点

- 全テーブルで RLS を有効化。`anon` には権限なし、`authenticated` は SELECT のみ（必要な列のみ）。書き込みはすべて検証付き RPC 経由
- 担当者 ID はクライアント送信値を信用せず、従業員は常に本人、他人の指定は拒否（代表・管理者のみ代理入力可）
- 資金台帳・在庫台帳・監査ログ・販売明細は追記専用（UPDATE/DELETE をトリガーで拒否）。取消は逆仕訳で記録
- 写真は非公開バケット、表示は 10 分有効の署名付き URL（ユーザー権限で発行）
- 顧客本人確認情報はアプリ側で AES-256-GCM 暗号化、閲覧は目的入力必須・監査ログ記録（拒否も記録）
- サービスロールキーは従業員アカウント作成（Auth 管理 API）にのみサーバー側で使用
