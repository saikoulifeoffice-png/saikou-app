-- =============================================================================
-- 買取SAIKOU Manager: コアスキーマ
--   - 金額はすべて bigint（円・整数）
--   - 日時は timestamptz（UTC保存）。日付境界は Asia/Tokyo で判定
--   - 帳簿系テーブルへの書き込みは RPC（SECURITY DEFINER 関数）経由のみ
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

create schema if not exists app;
comment on schema app is '内部ヘルパー関数（API非公開）';

-- -----------------------------------------------------------------------------
-- 列挙型
-- -----------------------------------------------------------------------------
create type public.user_role as enum ('owner', 'admin', 'staff');
create type public.purchase_method as enum ('store', 'visit', 'delivery', 'other');
create type public.payment_method as enum ('cash', 'bank_transfer', 'other');
create type public.item_condition as enum ('new', 'S', 'A', 'B', 'C', 'D', 'junk');
create type public.tax_category as enum ('standard_10', 'reduced_8', 'exempt', 'non_taxable', 'tax_free_export');
create type public.item_status as enum ('in_stock', 'partially_sold', 'sold', 'split', 'voided');
create type public.inventory_movement_type as enum (
  'purchase_in', 'sale_out', 'return_in', 'sale_cancel_in', 'purchase_void_out', 'split_out', 'split_in', 'adjustment'
);
create type public.sales_channel as enum ('store', 'dealer', 'auction', 'ec', 'other');
create type public.sale_kind as enum ('sale', 'return');
create type public.sale_status as enum ('confirmed', 'cancelled');
create type public.payment_status as enum ('unpaid', 'partial', 'paid');
create type public.sale_expense_type as enum ('fee', 'shipping', 'other');
create type public.payment_record_kind as enum ('receipt', 'refund');
create type public.fund_account_kind as enum ('staff_reserve', 'company_cash', 'company_bank');
create type public.fund_tx_type as enum (
  'opening',             -- 初期残高
  'replenish',           -- 資金補充（会社→準備金）
  'purchase_payment',    -- 買取支出
  'purchase_refund',     -- 買取返金（買取取消による戻し）
  'return_to_company',   -- 資金返却（準備金→会社）
  'transfer',            -- 従業員間移動
  'approved_adjustment'  -- 管理者承認済み調整
);
create type public.approval_type as enum (
  'fund_adjustment', 'fund_replenish', 'fund_transfer', 'purchase_void', 'sale_cancel'
);
create type public.approval_status as enum ('pending', 'approved', 'rejected', 'withdrawn');
create type public.period_status as enum ('open', 'closed');
create type public.tax_basis as enum ('incl', 'excl');
create type public.rounding_mode as enum ('floor', 'round', 'ceil');
create type public.expense_allocation_basis as enum ('revenue', 'purchase_amount', 'equal', 'manual');

-- -----------------------------------------------------------------------------
-- 設定（1行のみ）
-- -----------------------------------------------------------------------------
create table public.app_settings (
  id boolean primary key default true check (id),
  tax_basis public.tax_basis not null default 'incl',
  tax_rounding public.rounding_mode not null default 'floor',
  staff_can_view_other_inventory boolean not null default true,
  admin_can_approve_funds boolean not null default true,
  identity_retention_years integer not null default 3 check (identity_retention_years between 1 and 30),
  long_stay_days integer not null default 90 check (long_stay_days > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
comment on column public.app_settings.tax_basis is '集計の税基準（税込/税抜）。全集計で単一基準を使用し混在させない';
comment on column public.app_settings.identity_retention_years is '本人確認記録の保存年数（古物営業法上の要件は要確認）';
insert into public.app_settings default values;

-- -----------------------------------------------------------------------------
-- 従業員プロフィール
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  display_name text not null check (length(display_name) between 1 and 100),
  email text,
  role public.user_role not null default 'staff',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_role_idx on public.profiles (role) where is_active;

-- -----------------------------------------------------------------------------
-- 商品カテゴリー
-- -----------------------------------------------------------------------------
create table public.item_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(name) between 1 and 50),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.item_categories (name, sort_order) values
  ('時計', 10), ('バッグ', 20), ('ジュエリー', 30), ('貴金属', 40), ('ブランド小物', 50),
  ('アパレル', 60), ('家電', 70), ('カメラ', 80), ('骨董・美術品', 90), ('その他', 999);

-- -----------------------------------------------------------------------------
-- 顧客・本人確認
-- -----------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 100),
  name_kana text check (length(name_kana) <= 100),
  phone text check (phone ~ '^[0-9+\-]{0,20}$'),
  note text check (length(note) <= 1000),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customers_phone_idx on public.customers (phone);
create index customers_created_by_idx on public.customers (created_by);
comment on table public.customers is '顧客の非機微情報。住所・生年月日・身分証番号等は customer_identity_records に暗号化保存';

-- -----------------------------------------------------------------------------
-- 資金口座
-- -----------------------------------------------------------------------------
create table public.fund_accounts (
  id uuid primary key default gen_random_uuid(),
  kind public.fund_account_kind not null,
  owner_profile_id uuid references public.profiles (id),
  name text not null check (length(name) between 1 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint fund_accounts_owner_chk check ((kind = 'staff_reserve') = (owner_profile_id is not null))
);
create unique index fund_accounts_staff_uniq on public.fund_accounts (owner_profile_id) where kind = 'staff_reserve';
create unique index fund_accounts_company_uniq on public.fund_accounts (kind) where kind <> 'staff_reserve';
insert into public.fund_accounts (kind, name) values ('company_cash', '本社現金'), ('company_bank', '本社口座');

-- -----------------------------------------------------------------------------
-- 承認申請
-- -----------------------------------------------------------------------------
create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  request_type public.approval_type not null,
  status public.approval_status not null default 'pending',
  requested_by uuid not null references public.profiles (id),
  requested_at timestamptz not null default now(),
  target_id uuid,
  payload jsonb not null default '{}'::jsonb,
  reason text not null check (length(reason) between 1 and 1000),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text check (length(decision_note) <= 1000),
  result jsonb,
  idempotency_key uuid not null unique,
  constraint approval_decision_chk check ((status in ('approved', 'rejected')) = (decided_by is not null and decided_at is not null)),
  constraint approval_no_self_chk check (decided_by is null or decided_by <> requested_by)
);
create index approval_requests_status_idx on public.approval_requests (status, requested_at desc);
create index approval_requests_requester_idx on public.approval_requests (requested_by, requested_at desc);

-- -----------------------------------------------------------------------------
-- 買取取引・商品
-- -----------------------------------------------------------------------------
create table public.purchase_transactions (
  id uuid primary key default gen_random_uuid(),
  purchase_no text not null unique,
  purchased_at timestamptz not null,
  staff_id uuid not null references public.profiles (id),
  entered_by uuid not null references public.profiles (id),
  customer_id uuid references public.customers (id),
  method public.purchase_method not null,
  payment_method public.payment_method not null,
  fund_account_id uuid not null references public.fund_accounts (id),
  total_incl bigint not null check (total_incl >= 0),
  total_excl bigint not null check (total_excl >= 0),
  total_tax bigint not null check (total_tax >= 0),
  status text not null default 'active' check (status in ('active', 'voided')),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id),
  void_reason text,
  note text check (length(note) <= 2000),
  idempotency_key uuid not null unique,
  created_at timestamptz not null default now(),
  constraint purchase_tx_tax_chk check (total_incl = total_excl + total_tax),
  constraint purchase_tx_void_chk check ((status = 'voided') = (voided_at is not null))
);
create index purchase_tx_staff_idx on public.purchase_transactions (staff_id, purchased_at desc);
create index purchase_tx_date_idx on public.purchase_transactions (purchased_at desc);
create index purchase_tx_customer_idx on public.purchase_transactions (customer_id);

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  item_no text not null unique,
  purchase_transaction_id uuid not null references public.purchase_transactions (id),
  parent_item_id uuid references public.purchase_items (id),
  line_no integer not null check (line_no > 0),
  staff_id uuid not null references public.profiles (id),  -- 買取担当（取引から複製。RLS高速化用）
  purchased_at timestamptz not null,                       -- 取引から複製
  category_id uuid not null references public.item_categories (id),
  brand text check (length(brand) <= 100),
  name text not null check (length(name) between 1 and 200),
  model_no text check (length(model_no) <= 100),
  serial_no text check (length(serial_no) <= 100),
  condition public.item_condition not null,
  quantity integer not null check (quantity > 0),
  cost_incl bigint not null check (cost_incl >= 0),
  cost_excl bigint not null check (cost_excl >= 0),
  cost_tax bigint not null check (cost_tax >= 0),
  tax_category public.tax_category not null,
  storage_location text check (length(storage_location) <= 100),
  status public.item_status not null default 'in_stock',
  note text check (length(note) <= 2000),
  created_at timestamptz not null default now(),
  constraint purchase_items_tax_chk check (cost_incl = cost_excl + cost_tax)
);
create index purchase_items_tx_idx on public.purchase_items (purchase_transaction_id);
create index purchase_items_staff_idx on public.purchase_items (staff_id, purchased_at desc);
create index purchase_items_status_idx on public.purchase_items (status, purchased_at);
create index purchase_items_category_idx on public.purchase_items (category_id);
create index purchase_items_parent_idx on public.purchase_items (parent_item_id) where parent_item_id is not null;
create index purchase_items_search_idx on public.purchase_items
  using gin (to_tsvector('simple', coalesce(item_no, '') || ' ' || coalesce(brand, '') || ' ' || name || ' ' || coalesce(model_no, '') || ' ' || coalesce(serial_no, '')));

create table public.item_photos (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.purchase_items (id),
  storage_path text not null unique,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 15 * 1024 * 1024),
  sort_order integer not null default 0,
  uploaded_by uuid not null references public.profiles (id),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index item_photos_item_idx on public.item_photos (item_id, sort_order) where deleted_at is null;

-- 本人確認記録（暗号化）
create table public.customer_identity_records (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id),
  purchase_transaction_id uuid references public.purchase_transactions (id),
  verification_method text not null check (length(verification_method) between 1 and 50),
  encrypted_payload text not null,     -- base64(iv|authTag|ciphertext), AES-256-GCM（アプリ側で暗号化）
  key_version integer not null check (key_version > 0),
  verified_at timestamptz not null,
  verified_by uuid not null references public.profiles (id),
  retain_until date not null,
  disposed_at timestamptz,
  disposed_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index identity_customer_idx on public.customer_identity_records (customer_id);
create index identity_retain_idx on public.customer_identity_records (retain_until) where disposed_at is null;

-- -----------------------------------------------------------------------------
-- 販売
-- -----------------------------------------------------------------------------
create table public.sales (
  id uuid primary key default gen_random_uuid(),
  sale_no text not null unique,
  kind public.sale_kind not null default 'sale',
  original_sale_id uuid references public.sales (id),
  channel public.sales_channel not null,
  sold_at timestamptz not null,
  sales_staff_id uuid not null references public.profiles (id),
  entered_by uuid not null references public.profiles (id),
  buyer_name text check (length(buyer_name) <= 200),
  status public.sale_status not null default 'confirmed',
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  cancel_reason text,
  -- 合計（明細の合計。返品はマイナス）
  revenue_incl bigint not null,
  revenue_excl bigint not null,
  revenue_tax bigint not null,
  direct_expense_incl bigint not null default 0,
  direct_expense_excl bigint not null default 0,
  -- 入金
  expected_receipt_amount bigint not null,
  payment_due_date date,
  payment_status public.payment_status not null default 'unpaid',
  note text check (length(note) <= 2000),
  idempotency_key uuid not null unique,
  created_at timestamptz not null default now(),
  constraint sales_tax_chk check (revenue_incl = revenue_excl + revenue_tax),
  constraint sales_return_chk check ((kind = 'return') = (original_sale_id is not null)),
  constraint sales_sign_chk check (
    (kind = 'sale' and revenue_incl >= 0) or (kind = 'return' and revenue_incl <= 0)
  ),
  constraint sales_cancel_chk check ((status = 'cancelled') = (cancelled_at is not null))
);
create index sales_date_idx on public.sales (sold_at desc);
create index sales_staff_idx on public.sales (sales_staff_id, sold_at desc);
create index sales_payment_idx on public.sales (payment_status, payment_due_date) where status = 'confirmed';
create index sales_original_idx on public.sales (original_sale_id) where original_sale_id is not null;

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id),
  line_no integer not null check (line_no > 0),
  item_id uuid not null references public.purchase_items (id),
  returned_from_sale_item_id uuid references public.sale_items (id),
  quantity integer not null check (quantity <> 0),            -- 返品はマイナス
  tax_category public.tax_category not null,
  revenue_incl bigint not null,
  revenue_excl bigint not null,
  revenue_tax bigint not null,
  cost_incl bigint not null,                                  -- 原価スナップショット（返品はマイナス）
  cost_excl bigint not null,
  direct_expense_incl bigint not null default 0,              -- 配分済み販売直接費
  direct_expense_excl bigint not null default 0,
  purchaser_staff_id uuid not null references public.profiles (id),  -- 実績帰属先（買取担当）
  category_id uuid not null references public.item_categories (id),
  created_at timestamptz not null default now(),
  unique (sale_id, line_no),
  constraint sale_items_tax_chk check (revenue_incl = revenue_excl + revenue_tax)
);
create index sale_items_sale_idx on public.sale_items (sale_id);
create index sale_items_item_idx on public.sale_items (item_id);
create index sale_items_purchaser_idx on public.sale_items (purchaser_staff_id);
create index sale_items_returned_from_idx on public.sale_items (returned_from_sale_item_id) where returned_from_sale_item_id is not null;

create table public.sale_expenses (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id),
  expense_type public.sale_expense_type not null,
  tax_category public.tax_category not null,
  amount_incl bigint not null check (amount_incl >= 0),
  amount_excl bigint not null check (amount_excl >= 0),
  amount_tax bigint not null check (amount_tax >= 0),
  note text check (length(note) <= 500),
  created_at timestamptz not null default now(),
  constraint sale_expenses_tax_chk check (amount_incl = amount_excl + amount_tax)
);
create index sale_expenses_sale_idx on public.sale_expenses (sale_id);

create table public.payment_records (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id),
  kind public.payment_record_kind not null,
  amount bigint not null check (amount > 0),
  received_at timestamptz not null,
  method text check (length(method) <= 50),
  note text check (length(note) <= 500),
  recorded_by uuid not null references public.profiles (id),
  reverses_id uuid references public.payment_records (id),
  idempotency_key uuid not null unique,
  created_at timestamptz not null default now()
);
create index payment_records_sale_idx on public.payment_records (sale_id);

-- -----------------------------------------------------------------------------
-- 在庫移動台帳
-- -----------------------------------------------------------------------------
create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.purchase_items (id),
  movement_type public.inventory_movement_type not null,
  quantity_delta integer not null check (quantity_delta <> 0),
  cost_incl_delta bigint not null,
  cost_excl_delta bigint not null,
  sale_item_id uuid references public.sale_items (id),
  occurred_at timestamptz not null,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
create index inventory_movements_item_idx on public.inventory_movements (item_id, occurred_at);
create index inventory_movements_date_idx on public.inventory_movements (occurred_at);

-- -----------------------------------------------------------------------------
-- 経費（Phase 2 で UI 実装。Phase 1 ではスキーマのみ）
-- -----------------------------------------------------------------------------
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_no text not null unique,
  incurred_on date not null,
  category text not null check (length(category) between 1 and 50),
  description text check (length(description) <= 500),
  tax_category public.tax_category not null,
  amount_incl bigint not null check (amount_incl >= 0),
  amount_excl bigint not null check (amount_excl >= 0),
  amount_tax bigint not null check (amount_tax >= 0),
  paid_by_staff_id uuid references public.profiles (id),
  attributed_staff_id uuid references public.profiles (id),  -- 個人に直接帰属する経費
  fund_account_id uuid references public.fund_accounts (id),
  status text not null default 'active' check (status in ('active', 'voided')),
  created_by uuid not null references public.profiles (id),
  idempotency_key uuid not null unique,
  created_at timestamptz not null default now(),
  constraint expenses_tax_chk check (amount_incl = amount_excl + amount_tax)
);
create index expenses_date_idx on public.expenses (incurred_on);

create table public.expense_allocations (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id),
  staff_id uuid not null references public.profiles (id),
  basis public.expense_allocation_basis not null,
  amount_incl bigint not null check (amount_incl >= 0),
  amount_excl bigint not null check (amount_excl >= 0),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (expense_id, staff_id)
);

-- -----------------------------------------------------------------------------
-- 資金台帳
-- -----------------------------------------------------------------------------
create table public.fund_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.fund_accounts (id),
  tx_type public.fund_tx_type not null,
  amount bigint not null check (amount <> 0),   -- 入金＋／出金−
  occurred_at timestamptz not null,
  transfer_group_id uuid,                       -- 対になる仕訳（合計0）
  purchase_transaction_id uuid references public.purchase_transactions (id),
  approval_request_id uuid references public.approval_requests (id),
  idempotency_key uuid not null,
  memo text check (length(memo) <= 500),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (idempotency_key, account_id)
);
create index fund_tx_account_idx on public.fund_transactions (account_id, occurred_at);
create index fund_tx_group_idx on public.fund_transactions (transfer_group_id) where transfer_group_id is not null;
create index fund_tx_purchase_idx on public.fund_transactions (purchase_transaction_id) where purchase_transaction_id is not null;

create table public.fund_reconciliations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.fund_accounts (id),
  counted_at timestamptz not null,
  counted_amount bigint not null check (counted_amount >= 0),
  ledger_balance bigint not null,
  difference bigint generated always as (counted_amount - ledger_balance) stored,
  note text check (length(note) <= 1000),
  adjustment_request_id uuid references public.approval_requests (id),
  counted_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
create index fund_recon_account_idx on public.fund_reconciliations (account_id, counted_at desc);

-- -----------------------------------------------------------------------------
-- 会計期間・監査ログ・採番
-- -----------------------------------------------------------------------------
create table public.accounting_periods (
  id uuid primary key default gen_random_uuid(),
  period_month date not null unique check (extract(day from period_month) = 1),
  status public.period_status not null default 'open',
  closed_at timestamptz,
  closed_by uuid references public.profiles (id),
  reopened_at timestamptz,
  reopened_by uuid references public.profiles (id),
  note text,
  constraint accounting_periods_closed_chk check ((status = 'closed') = (closed_at is not null))
);

create table public.audit_logs (
  id bigserial primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  action text not null,
  table_name text,
  record_id text,
  before_data jsonb,
  after_data jsonb,
  context jsonb
);
create index audit_logs_date_idx on public.audit_logs (occurred_at desc);
create index audit_logs_record_idx on public.audit_logs (table_name, record_id);
create index audit_logs_actor_idx on public.audit_logs (actor_id, occurred_at desc);

create table app.doc_counters (
  prefix text not null,
  period text not null,
  last_value integer not null,
  primary key (prefix, period)
);
