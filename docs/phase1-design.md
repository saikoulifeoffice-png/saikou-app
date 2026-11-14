# 買取SAIKOU Manager — Phase 1 詳細設計・実装計画（レビュー用ドラフト）

- 作成日: 2026-11-13
- ステータス: **承認済み・Phase 1 実装完了**（実装との差分は末尾「実装時の変更点」参照）
- 対象: Phase 1（認証、買取登録、商品写真、在庫、販売、資金台帳、基本ダッシュボード）
- 前提: リポジトリは `README.md` のみの初期状態。既存コードの破壊リスクなし。

---

## 0. 全体方針

| 項目 | 方針 |
|---|---|
| 金額 | すべて **整数の円（PostgreSQL `bigint`、TS `number` の安全整数範囲内を Zod で検証）**。浮動小数点演算は使わない。按分は「最大剰余法」で端数を確定的に配分する |
| 日時 | DB は `timestamptz`（UTC保存）。表示・日次集計の境界は **Asia/Tokyo** で切る（SQL では `AT TIME ZONE 'Asia/Tokyo'`） |
| 書き込み | 帳簿系（買取・販売・資金・在庫）は **PostgreSQL 関数（RPC）経由のみ**。1操作＝1DBトランザクション。テーブルへの直接 INSERT/UPDATE/DELETE は RLS で禁止 |
| 削除 | 帳簿系は **物理削除禁止**（トリガーで拒否）。取消は「取消レコード＋逆仕訳」で表現 |
| 残高・在庫 | 台帳（`fund_transactions` / `inventory_movements`）の合計から算出。残高カラムの手入力上書きは存在しない |
| 冪等性 | 画面ごとにフォーム表示時に UUID の `idempotency_key` を発行し、RPC 側で UNIQUE 制約により二重計上を防止。再送時は既存結果を返す |
| 担当者ID | 従業員が送信した担当者IDは無視し `auth.uid()` を使用。代表・管理者のみ代理入力可（代理入力者も記録） |
| 秘密情報 | `SUPABASE_SERVICE_ROLE_KEY`・暗号鍵はサーバー専用。`NEXT_PUBLIC_` には URL と anon key のみ |

---

## 1. ディレクトリ構成（予定）

```
saikou-app/
├─ app/
│  ├─ (auth)/login/                 ログイン
│  ├─ (app)/layout.tsx              認証ガード＋サイドバー/下部ナビ
│  ├─ (app)/home/                   従業員ホーム
│  ├─ (app)/purchases/new/          買取取引登録（複数商品・写真）
│  ├─ (app)/purchases/[id]/         買取取引詳細・取消
│  ├─ (app)/items/                  商品一覧・検索
│  ├─ (app)/items/[id]/             商品詳細・写真追加・セット分割
│  ├─ (app)/sales/new/              販売登録（複数商品・按分）
│  ├─ (app)/sales/                  販売履歴・入金管理
│  ├─ (app)/sales/[id]/             販売詳細・返品・キャンセル
│  ├─ (app)/funds/                  従業員別買取準備金（台帳・補充・移動）
│  ├─ (app)/me/performance/         個人売上・利益（基本）
│  ├─ (app)/dashboard/              全社ダッシュボード（基本）
│  ├─ (app)/admin/staff/            従業員・権限管理（最小限）
│  └─ api/                          CSV等（Phase 2で拡張）
├─ components/ui/                   shadcn/ui
├─ components/                      業務コンポーネント（MoneyInput, PhotoPicker 等）
├─ lib/
│  ├─ money/                        円整数演算・按分（純関数・単体テスト対象）
│  ├─ calc/                         利益・在庫計算（純関数）
│  ├─ validation/                   Zod スキーマ（クライアント/サーバー共用）
│  ├─ supabase/                     server/client/middleware クライアント
│  ├─ auth/                         requireRole() 等サーバー側認可
│  └─ crypto/                       本人確認情報の暗号化（AES-256-GCM）
├─ supabase/
│  ├─ migrations/                   SQL マイグレーション
│  ├─ seed.sql                      架空サンプルデータ
│  └─ tests/                        SQL/RLS テスト
├─ scripts/create-owner.ts          初期代表アカウント作成（サーバー側で実行）
├─ tests/unit/  tests/db/  e2e/     Vitest / DB統合 / Playwright
├─ public/manifest.webmanifest      PWA
├─ .env.example
└─ docs/
```

---

## 2. データベース設計

### 2.1 共通

- 主キー: `uuid default gen_random_uuid()`
- 共通カラム: `created_at timestamptz not null default now()`, `created_by uuid references profiles`
- 金額: `bigint not null check (x >= 0)`（符号付きが必要な台帳のみ符号あり）
- 列挙は PostgreSQL `enum` 型
- 監査: 主要テーブルに `AFTER INSERT/UPDATE` トリガーで `audit_logs` に before/after を JSONB 記録

### 2.2 税区分

```
enum tax_category: 'standard_10' | 'reduced_8' | 'exempt'(非課税) | 'non_taxable'(不課税) | 'tax_free_export'(免税)
```

金額を持つ明細には次の3値を保存し、`check (amount_incl_tax = amount_excl_tax + tax_amount)` を付与:

- `amount_excl_tax` / `tax_amount` / `amount_incl_tax` / `tax_category`
- 入力は「税込入力」「税抜入力」を選択可能。税額端数処理は会社設定（既定: 切り捨て）
- **集計基準（税込 or 税抜）は会社設定で1つに固定**し、全ダッシュボード・個人実績が同じカラムを参照（混在させない）。設定変更は代表のみ・監査ログ記録

> ⚠ 個人からの中古品買取に係る消費税の扱い（仕入税額控除、インボイス制度の古物商特例の適用要件・帳簿記載事項）は**税理士確認事項**として分離します。システムは「区分と金額を正確に保持する」ことに留め、税務上の適法性は断言しません。

### 2.3 テーブル一覧（Phase 1 で実装するもの = ●、Phase 1 で定義のみ・UIは Phase 2 = ○）

| テーブル | P1 | 概要 |
|---|---|---|
| profiles | ● | auth.users と 1:1。氏名、`role`(owner/admin/staff)、`is_active` |
| customers | ● | 顧客（氏名カナ、連絡先等の非機微情報） |
| customer_identity_records | ● | 本人確認記録（暗号化）。保存期限 `retain_until` |
| purchase_transactions | ● | 買取取引ヘッダ（日時、担当者、顧客、方法、支払方法、支払元口座、合計） |
| purchase_items | ● | 商品（商品番号、カテゴリ、ブランド、型番、製造番号、状態、数量、原価、保管場所、親商品ID） |
| item_photos | ● | 写真メタ（storage path、並び順） |
| inventory_movements | ● | 在庫移動台帳（符号付き数量） |
| sales | ● | 販売ヘッダ（経路、日時、販売担当、販売先、種別=販売/返品、状態） |
| sale_items | ● | 販売明細（商品、数量、配分売上、原価スナップショット、配分直接費、**買取担当スナップショット**） |
| sale_expenses | ● | 販売直接費（手数料、送料、その他） |
| payment_records | ● | 入金予定・入金実績 |
| expenses | ○ | 一般経費（Phase 2） |
| expense_allocations | ○ | 経費配賦（Phase 2） |
| fund_accounts | ● | 資金口座（従業員別準備金口座＋会社口座） |
| fund_transactions | ● | 資金台帳（符号付き金額、冪等キー、移動グループ） |
| fund_reconciliations | ● | 現金照合（実査額と台帳残高の差異記録） |
| approval_requests | ● | 承認申請（P1: 調整・取消・残高不足時の補充申請） |
| accounting_periods | ● | 会計期間（P1: 締め済み期間への書き込み拒否トリガーのみ、締め操作UIは P2） |
| audit_logs | ● | 監査ログ（追記専用） |
| app_settings | ● | 追加: 集計税基準、端数処理、残高不足時の動作など（1行） |
| item_categories | ● | 追加: 商品カテゴリーマスタ |

### 2.4 主要テーブル定義（抜粋）

```sql
-- 権限
create type user_role as enum ('owner','admin','staff');
create table profiles (
  id uuid primary key references auth.users on delete restrict,
  display_name text not null,
  role user_role not null default 'staff',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 買取取引
create type purchase_method as enum ('store','visit','delivery','other');      -- 店頭/出張/宅配/その他
create type payment_method  as enum ('cash','bank_transfer','other');
create table purchase_transactions (
  id uuid primary key default gen_random_uuid(),
  purchase_no text not null unique,                 -- 例 P2611-000123
  purchased_at timestamptz not null,
  staff_id uuid not null references profiles,       -- 買取担当（実績帰属先）
  entered_by uuid not null references profiles,     -- 実際の入力者
  customer_id uuid references customers,
  method purchase_method not null,
  payment_method payment_method not null,
  fund_account_id uuid not null references fund_accounts,  -- 支払元
  total_amount bigint not null check (total_amount >= 0),  -- = Σ items.cost_total（関数内で検証）
  status text not null default 'active' check (status in ('active','voided')),
  idempotency_key uuid not null unique,
  note text,
  created_at timestamptz not null default now()
);
create index on purchase_transactions (staff_id, purchased_at desc);

-- 商品
create type item_condition as enum ('new','S','A','B','C','D','junk');
create table purchase_items (
  id uuid primary key default gen_random_uuid(),
  item_no text not null unique,                     -- 例 K2611-000456（自動発行）
  purchase_transaction_id uuid not null references purchase_transactions,
  parent_item_id uuid references purchase_items,    -- セット分割元
  category_id uuid not null references item_categories,
  brand text, name text not null, model_no text, serial_no text,
  condition item_condition not null,
  quantity int not null check (quantity > 0),       -- 取得時数量
  cost_total bigint not null check (cost_total >= 0),  -- 取得原価合計（円）
  -- 単価は cost_total/quantity を按分で扱う（端数は最大剰余法で確定）
  tax_category tax_category not null,
  storage_location text,
  status text not null default 'in_stock'           -- in_stock/partially_sold/sold/split/voided（表示用・台帳から再計算）
  ,note text, created_at timestamptz not null default now()
);
create index on purchase_items (category_id); create index on purchase_items using gin (to_tsvector('simple', coalesce(brand,'')||' '||name||' '||coalesce(model_no,'')));

-- 在庫移動
create type inventory_movement_type as enum
 ('purchase_in','sale_out','return_in','sale_cancel_in','purchase_void_out','split_out','split_in','adjustment');
create table inventory_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references purchase_items,
  movement_type inventory_movement_type not null,
  quantity_delta int not null check (quantity_delta <> 0),
  cost_delta bigint not null,                       -- 原価の増減（在庫原価を台帳から算出するため）
  ref_sale_item_id uuid references sale_items,
  occurred_at timestamptz not null,
  created_by uuid not null references profiles,
  created_at timestamptz not null default now()
);
create index on inventory_movements (item_id);

-- 資金
create type fund_account_kind as enum ('staff_reserve','company_cash','company_bank');
create table fund_accounts (
  id uuid primary key default gen_random_uuid(),
  kind fund_account_kind not null,
  owner_profile_id uuid references profiles,        -- staff_reserve の場合必須
  name text not null, is_active boolean not null default true,
  check ((kind = 'staff_reserve') = (owner_profile_id is not null))
);
create unique index on fund_accounts (owner_profile_id) where kind = 'staff_reserve';

create type fund_tx_type as enum
 ('opening','replenish','purchase_payment','purchase_refund','return_to_company','transfer_out','transfer_in','approved_adjustment');
create table fund_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references fund_accounts,
  tx_type fund_tx_type not null,
  amount bigint not null check (amount <> 0),       -- 入金＋ / 出金−
  occurred_at timestamptz not null,
  transfer_group_id uuid,                           -- 移動・補充の対となる2行を束ねる
  purchase_transaction_id uuid references purchase_transactions,
  reverses_id uuid references fund_transactions,    -- 取消仕訳
  approval_request_id uuid references approval_requests,
  idempotency_key uuid not null,
  memo text, created_by uuid not null references profiles,
  created_at timestamptz not null default now(),
  unique (idempotency_key, account_id)
);
create index on fund_transactions (account_id, occurred_at);
-- 移動グループの合計が0であることを DEFERRABLE 制約トリガーで検証（二重仕訳相当）
```

残高は `fund_account_balances` ビュー（`sum(amount) group by account_id`）で算出。

### 2.5 不変性・整合性のための DB 機構

1. `fund_transactions` / `inventory_movements` / `audit_logs`: UPDATE・DELETE を拒否するトリガー
2. `transfer_group_id` を持つ行の合計＝0 を `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` で検証
3. 買取: `purchase_transactions.total_amount = Σ purchase_items.cost_total = −(買取支出仕訳額)` を関数内で検証
4. 在庫数量が負にならないことを販売関数内で `SELECT ... FOR UPDATE` 後に検証
5. 締め済み期間（`accounting_periods.status='closed'`）の日付を持つ帳簿行の INSERT を拒否
6. 残高不足: 対象口座行を `FOR UPDATE` でロックしてから残高を計算 → 不足なら例外（同時登録でもマイナスにならない）

### 2.6 RPC（すべて `SECURITY DEFINER`、先頭で `auth.uid()` と役割を検証、`search_path` 固定）

| 関数 | 処理（1トランザクション） |
|---|---|
| `register_purchase(payload jsonb)` | 冪等キー確認 → 担当者確定 → 取引・商品作成（番号発行）→ 在庫 `purchase_in` → 資金 `purchase_payment`（残高チェック）→ 監査 |
| `void_purchase(id, reason)` | 未販売の場合のみ。在庫 `purchase_void_out` → 資金 `purchase_refund`（逆仕訳）→ 承認要否は設定 |
| `split_item(item_id, children jsonb)` | セット商品を子商品に分割、原価を按分（合計一致を検証） |
| `register_sale(payload jsonb)` | 冪等キー → 在庫ロック・数量検証 → 売上・直接費を明細へ按分 → 原価スナップショット → 在庫 `sale_out` → 入金予定作成 |
| `cancel_sale(id, reason)` | 状態を cancelled、在庫 `sale_cancel_in`、売上は集計から除外（記録は残る） |
| `register_return(sale_id, lines jsonb)` | 返品用の `sales(kind='return')` をマイナス計上、在庫 `return_in`、原価戻し |
| `record_payment(sale_id, amount, received_at)` | 入金実績登録、入金状況更新 |
| `fund_replenish / fund_return / fund_transfer` | 会社口座⇔準備金、準備金⇔準備金。2行を同一 `transfer_group_id` で作成 |
| `request_fund_adjustment` / `approve_request` | 調整は申請→代表/管理者承認で `approved_adjustment` 仕訳 |
| `record_reconciliation(account_id, counted_amount)` | 現金実査。差異は自動仕訳せず、調整申請に誘導 |

Next.js 側は Server Action → Zod 検証 → `requireRole()` → `supabase.rpc()`（ユーザーのJWTで呼ぶ。service role は使わない）。

---

## 3. 計算仕様

### 3.1 按分（`lib/money/allocate.ts` と SQL 関数 `allocate_amount` の両方に同一ロジック）

最大剰余法:
1. `floor(total × weight_i / Σweight)` を各明細に割当（整数演算、bigint）
2. 残差を「剰余の大きい順 → 同値なら明細の行番号順」で1円ずつ配分
3. 合計が必ず `total` と一致（テストで保証）

按分の重み（販売時に選択、既定値は確認事項 Q3）:
- 明細ごとに販売額を手入力した場合はそのまま
- 一括金額のみの場合: **買取原価比** で配分
- 販売直接費（手数料・送料・その他）: **配分後の売上比** で配分

### 3.2 利益（集計基準カラム＝設定の税込 or 税抜）

```
総売上            = Σ sale_items.allocated_revenue（計上日が期間内、cancelled除外、返品はマイナス）
売上原価          = Σ sale_items.cost_snapshot（同上）  ※未販売商品は含まれない
粗利益            = 総売上 − 売上原価
販売直接費        = Σ sale_items.allocated_direct_expense
商品利益          = 売上 − 買取原価 − 販売直接費（明細単位）
管理上の純利益    = 粗利益 − 販売直接費 − 配賦一般経費（P1 は一般経費0、P2で実装）
利益率(%)         = 純利益 × 100 ÷ 総売上（総売上0のときは「—」表示、表示時のみ小数1桁に丸め）
在庫原価          = Σ inventory_movements.cost_delta（基準日以前）
個人実績          = sale_items.purchaser_staff_id（販売時に買取担当をスナップショット）で集計
販売担当実績      = sales.sales_staff_id で別集計（参考値）
```

- 売上は **計上日（販売日時）基準**、入金は `payment_records` で別管理
- 返品は返品日の期間にマイナス計上（元の期間は変更しない → 締め後も整合）

### 3.3 原価の単価化
数量 n・原価 C の商品を k 個販売する場合、原価は「残数量・残原価」から `floor(残原価 × k / 残数量)` を割当、最後の1個で残原価をすべて割当（端数が残らない）。

---

## 4. 権限設計

| 機能 | 代表 owner | 管理者 admin | 従業員 staff |
|---|---|---|---|
| 自分の買取・販売・準備金・実績 | 閲覧/登録 | 閲覧/登録 | 閲覧/登録 |
| 他人の取引・商品 | 全件 | 全件 | **在庫商品の基本情報のみ閲覧可**（販売のため。原価・顧客情報は不可）※Q5 |
| 代理入力（担当者指定） | ○ | ○ | × |
| 顧客本人確認情報の復号閲覧 | ○ | ○（監査ログ必須） | 自分が担当した取引のみ ※Q6 |
| 資金補充・移動・調整承認 | ○ | ○（設定で制限可） | 申請のみ |
| 全社ダッシュボード | ○ | ○ | × |
| 従業員・権限管理、設定 | ○ | 閲覧のみ | × |

RLS 実装:
- ヘルパー関数 `app.current_role()`, `app.is_manager()`（owner/admin）を `SECURITY DEFINER STABLE` で定義
- 全テーブル `ENABLE ROW LEVEL SECURITY`（`FORCE` は使わず、SECURITY DEFINER 関数のみ所有者権限で読み書き）
- staff 用 SELECT ポリシー: `staff_id = auth.uid()` 等。他人在庫は原価を含まない `items_public` ビュー（`security_invoker`）経由
- 帳簿テーブルは INSERT/UPDATE/DELETE ポリシーを作らない（＝RPC 以外から書けない）
- Storage: バケット `item-photos`（private）。ポリシーで「パス先頭の item_id を閲覧可能なユーザー」のみ。表示は Server Action で **10分有効の署名付きURL** を発行
- 本人確認情報: アプリ層で AES-256-GCM 暗号化（鍵は `IDENTITY_ENCRYPTION_KEY` サーバー環境変数、DBには暗号文と鍵バージョンのみ）。復号はサーバーでのみ行い、復号のたびに `audit_logs` に記録。`retain_until` を保持し、期限到来一覧を表示（自動削除は承認制、P2）

> ⚠ 古物営業法上の記録事項（取引年月日、品目・数量、特徴、相手方の住所・氏名・職業・年齢、本人確認方法等）、本人確認の方法・免除基準、帳簿の保存期間は**現行法令・所轄警察の指導の確認が必要**です。システムは記録項目を設定可能な形で用意し、適法性の判断は行いません。

---

## 5. 画面設計（Phase 1）

共通: PC はネイビー基調のサイドバー、スマホは下部ナビ（ホーム／買取／商品／販売／資金）。金額は `tabular-nums` で大きく表示、ゴールドは主要アクションと強調数値のみに使用。全画面で読み込み中（スケルトン）・エラー・空データ状態を用意。

| # | 画面 | 主な要素 |
|---|---|---|
| 1 | ログイン | メール＋パスワード（Supabase Auth）。新規登録画面なし（招待制） |
| 2 | 従業員ホーム | 今月の個人売上・利益・買取使用額、準備金残高（大）、クイック操作（買取登録/販売登録）、最近の取引 |
| 3 | 買取取引登録 | ①顧客選択/新規 ②商品行を追加（カテゴリ→ブランド→商品名…、行ごとに写真）③支払方法・支払元口座 ④確認ダイアログ（合計・残高変化を表示）→ 登録。一括金額入力→原価按分ボタンあり |
| 4 | 商品登録・写真 | 3 と同一フォーム内。`<input type=file accept=image/* capture=environment multiple>`、クライアントで長辺2000px/JPEG圧縮後、署名付きアップロードURLへ直接送信 |
| 5 | 商品一覧・検索 | キーワード（商品名/ブランド/型番/商品番号）、カテゴリ、状態、在庫状況、担当者、期間。スマホはカード表示 |
| 6 | 商品詳細 | 写真ギャラリー、属性、原価（権限者のみ）、在庫移動履歴、販売履歴、セット分割、写真追加 |
| 7 | 販売登録 | 経路選択 → 在庫から商品を複数選択 → 明細金額 or 一括金額＋按分 → 手数料/送料/その他 → 入金予定日 → 利益プレビュー（明細別）→ 確認 |
| 8 | 販売履歴・入金管理 | 期間・経路・入金状況で絞込、未入金合計、入金登録、キャンセル・返品（確認ダイアログ＋理由必須） |
| 10 | 準備金 | 残高（大）、台帳（期間絞込）、補充/返却/移動（管理者）、補充申請（従業員）、現金照合 |
| 11 | 個人実績（基本） | 期間指定（日/週/月/年）、売上・原価・粗利・直接費・利益・利益率、買取件数/金額 |
| 12 | 全社ダッシュボード（基本） | 期間売上・利益・利益率、買取使用額、在庫原価、準備金残高合計、日別推移グラフ（実績のない日も0で表示）、未入金合計 |
| 17 | 従業員管理（最小） | 招待（メール）、役割変更、無効化、準備金口座の自動作成 |

---

## 6. テスト計画

| 層 | ツール | 主な検証 |
|---|---|---|
| 単体 | Vitest | 按分（合計一致・端数・決定性）、税計算、利益計算、Zodスキーマ |
| DB統合 | Vitest + ローカル Supabase（Docker、`supabase start`） | 要件13の各ケースを実 DB・実 RLS で検証（下表） |
| E2E | Playwright | ログイン→買取登録（写真）→販売→ダッシュボード反映、スマホ幅での下部ナビ |

要件13 の対応（Phase 1 で検証するもの）:

| ケース | P1 |
|---|---|
| 買取登録後に在庫が増える | ✅ |
| 買取支出で担当者準備金が減る | ✅ |
| 販売で売上・原価・利益が反映 | ✅ |
| 未販売商品が売上原価に入らない | ✅ |
| 買取担当≠販売担当でも帰属が正しい | ✅ |
| 複数商品一括販売の配分 | ✅ |
| 返品・キャンセルで残高・在庫整合 | ✅ |
| 同時登録・二重送信で二重計上なし | ✅（並列RPC呼び出しテスト） |
| 従業員が他人の機密情報を取得不可 | ✅（staff JWT で直接 REST/SQL アクセス） |
| 写真の非公開アクセス | ✅（未認可・他人での Storage 取得失敗） |
| 月次締め後の無断変更防止 | ✅（DBトリガーのみ。締めUIは P2） |
| 税区分混在の集計 | ✅（集計関数レベル） |

---

## 7. 実装ステップ（Phase 1）

1. プロジェクト雛形: Next.js(App Router)+TS strict+Tailwind+shadcn/ui+ESLint+Vitest+Playwright、PWA manifest/Service Worker
2. Supabase ローカル環境、マイグレーション（スキーマ・制約・トリガー・RLS・Storage ポリシー・RPC）
3. `lib/money`・`lib/calc` 純関数＋単体テスト
4. 認証・ミドルウェア・ロール別レイアウト、初期代表作成スクリプト
5. 買取登録＋写真アップロード → 商品一覧/詳細
6. 販売登録・履歴・入金・キャンセル・返品
7. 資金台帳（補充・返却・移動・照合・調整申請/承認）
8. 従業員ホーム・個人実績・基本ダッシュボード
9. DB統合テスト・E2E・架空シードデータ
10. ドキュメント（セットアップ、初期管理者作成、本番公開手順、未実装・要確認一覧）

各ステップ完了ごとにコミットし、`claude/saikou-manager-dev-fftf4q` ブランチへ push します。本番 Supabase / Vercel への接続・公開は行いません（ご承認後）。

---

## 8. ご確認いただきたい事項

| # | 論点 | 提案（既定値） |
|---|---|---|
| Q1 | 集計の税基準 | **税込**で統一（中古品店の管理会計で一般的・入力が簡単）。設定で税抜に切替可 |
| Q2 | 準備金の残高不足時 | **登録を拒否**し、その場で「補充申請」を作成できるようにする（マイナス残高は不可） |
| Q3 | 一括販売の按分基準の既定 | **買取原価比**。明細金額を入力した場合はそれを優先 |
| Q4 | 振込買取の支払元 | 現金買取＝担当者の準備金、振込買取＝**会社口座**（準備金は減らない） |
| Q5 | 従業員が他人の在庫を見られるか | 商品基本情報・写真のみ可（原価・顧客は不可）。販売時に他人の買取品を売れるようにするため |
| Q6 | 従業員による顧客本人確認情報の閲覧 | 自分が担当した取引の分のみ、閲覧時に監査ログ記録 |
| Q7 | 商品番号の形式 | `K` + 年月(YYMM) + `-` + 6桁連番（例 `K2611-000123`）、買取番号は `P` 始まり |
| Q8 | 買取方法の選択肢 | 店頭／出張／宅配／その他 |
| Q9 | 商品状態の選択肢 | 新品・未使用／S／A／B／C／D／ジャンク |
| Q10 | Supabase / ホスティング | 開発はローカル Supabase（Docker）で進め、本番用 Supabase プロジェクト・Vercel 等の作成はご承認後 |

---

## 9. 実装時の変更点（2026-11-13）

| 設計時 | 実装 | 理由 |
|---|---|---|
| RLS に `FORCE` を付与 | `ENABLE` のみ | 検証付き RPC（SECURITY DEFINER）が所有者権限で台帳を書き込むため。利用者ロール（authenticated）には書き込み権限自体を与えていない |
| `items_public` ビュー | `search_items` / `get_item` 関数 | 他担当者の商品の原価・製造番号を権限に応じてマスクするため |
| fund_tx_type `transfer_in` / `transfer_out` | `transfer`（符号で入出金を表現） | 他の移動種別と同じく `transfer_group_id` の合計0で検証 |
| 販売明細の原価列 | 列権限で直接参照不可、`get_sale_lines` 経由 | 販売担当が他人の買取原価を見られないようにするため |
| 本人確認記録の拒否時は例外 | 空結果を返し拒否を監査ログに記録 | 例外だと監査ログもロールバックされるため |
| 追加テーブル | `app_settings`, `item_categories`, `app.doc_counters` | 設定・カテゴリーマスタ・採番 |
| 従業員アカウント | 代表が初期パスワードを設定して発行 | 招待メール（SMTP）未設定でも運用できるため。招待方式は要検討 |
| Next.js | 16（`middleware` は `proxy.ts`、Cache Components は無効） | 認証必須の業務画面のため、リクエストごとの動的描画を採用 |
