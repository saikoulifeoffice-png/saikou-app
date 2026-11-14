-- 自動生成ファイル（npm run db:bundle）。直接編集しないでください。
-- 新規の Supabase プロジェクトの SQL Editor に貼り付けて1回だけ実行します。

-- ===== 20261113000100_core_schema.sql =====
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


-- ===== 20261113000200_helpers_triggers.sql =====
-- =============================================================================
-- ヘルパー関数・トリガー
-- =============================================================================

-- エラー送出: メッセージ形式 'SAIKOU:<CODE>:<日本語メッセージ>'（アプリ側で解析）
create or replace function app.fail(p_code text, p_message text)
returns void language plpgsql as $$
begin
  raise exception 'SAIKOU:%:%', p_code, p_message using errcode = 'P0001';
end $$;

-- -----------------------------------------------------------------------------
-- 認可ヘルパー
-- -----------------------------------------------------------------------------
create or replace function app.current_role()
returns public.user_role language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.is_active
$$;

create or replace function app.is_active_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active)
$$;

create or replace function app.is_manager()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(app.current_role() in ('owner', 'admin'), false)
$$;

create or replace function app.is_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(app.current_role() = 'owner', false)
$$;

-- 現在ユーザーを取得（未ログイン・無効ユーザーは例外）
create or replace function app.require_user()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v uuid := auth.uid();
begin
  if v is null or not app.is_active_user() then
    perform app.fail('UNAUTHORIZED', 'ログインが必要です');
  end if;
  return v;
end $$;

create or replace function app.require_manager()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v uuid := app.require_user();
begin
  if not app.is_manager() then
    perform app.fail('FORBIDDEN', 'この操作は代表または管理者のみ実行できます');
  end if;
  return v;
end $$;

create or replace function app.require_owner()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v uuid := app.require_user();
begin
  if not app.is_owner() then
    perform app.fail('FORBIDDEN', 'この操作は代表のみ実行できます');
  end if;
  return v;
end $$;

-- 資金承認権限（代表、または設定で許可された管理者）
create or replace function app.can_approve_funds()
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_owner()
      or (app.current_role() = 'admin' and (select s.admin_can_approve_funds from public.app_settings s))
$$;

create or replace function app.try_uuid(p text)
returns uuid language plpgsql immutable as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

-- 商品の閲覧可否（写真の Storage ポリシーでも使用）
create or replace function app.can_view_item(p_item_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_active_user() and (
    app.is_manager()
    or exists (select 1 from public.purchase_items i where i.id = p_item_id and i.staff_id = auth.uid())
    or (
      (select s.staff_can_view_other_inventory from public.app_settings s)
      and exists (select 1 from public.purchase_items i where i.id = p_item_id and i.status in ('in_stock', 'partially_sold'))
    )
  )
$$;

-- 商品の編集可否（写真追加・分割）
create or replace function app.can_edit_item(p_item_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_active_user() and (
    app.is_manager()
    or exists (select 1 from public.purchase_items i where i.id = p_item_id and i.staff_id = auth.uid())
  )
$$;

-- -----------------------------------------------------------------------------
-- 日付・会計期間
-- -----------------------------------------------------------------------------
create or replace function app.jst_month(p_ts timestamptz)
returns date language sql immutable as $$
  select date_trunc('month', p_ts at time zone 'Asia/Tokyo')::date
$$;

create or replace function app.assert_period_open(p_ts timestamptz)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.accounting_periods ap
    where ap.period_month = app.jst_month(p_ts) and ap.status = 'closed'
  ) then
    perform app.fail('PERIOD_CLOSED',
      to_char(app.jst_month(p_ts), 'YYYY年MM月') || 'は締め済みのため登録・変更できません');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 金額計算（lib/money と同一仕様。テストで一致を検証）
-- -----------------------------------------------------------------------------
create or replace function app.tax_rate(p_cat public.tax_category)
returns integer language sql immutable as $$
  select case p_cat when 'standard_10' then 10 when 'reduced_8' then 8 else 0 end
$$;

-- 非負整数の除算（端数処理指定）
create or replace function app.div_round(p_num numeric, p_den numeric, p_mode public.rounding_mode)
returns bigint language sql immutable as $$
  select case p_mode
    when 'floor' then floor(p_num / p_den)
    when 'ceil' then ceil(p_num / p_den)
    else floor((p_num * 2 + p_den) / (p_den * 2))   -- 四捨五入（0.5は切上げ）
  end::bigint
$$;

-- 税込金額から消費税額を算出（符号は元の金額に従う）
create or replace function app.tax_from_incl(p_incl bigint, p_cat public.tax_category, p_mode public.rounding_mode)
returns bigint language sql immutable as $$
  select case when app.tax_rate(p_cat) = 0 or p_incl = 0 then 0::bigint
    else sign(p_incl)::bigint * app.div_round(abs(p_incl)::numeric * app.tax_rate(p_cat), 100 + app.tax_rate(p_cat), p_mode)
  end
$$;

create or replace function app.current_rounding()
returns public.rounding_mode language sql stable security definer set search_path = '' as $$
  select s.tax_rounding from public.app_settings s
$$;

-- 最大剰余法による按分。合計は必ず p_total と一致。
-- 剰余が同じ場合は配列の前方を優先（決定的）。重みがすべて0なら均等。
create or replace function app.allocate(p_total bigint, p_weights bigint[])
returns bigint[] language plpgsql immutable as $$
declare
  n integer := coalesce(array_length(p_weights, 1), 0);
  w numeric[];
  s numeric := 0;
  base bigint[] := '{}';
  rem numeric[] := '{}';
  total numeric := abs(p_total);
  leftover bigint;
  i integer;
  idx integer;
  sgn integer := case when p_total < 0 then -1 else 1 end;
begin
  if n = 0 then
    perform app.fail('INVALID_ALLOCATION', '按分対象がありません');
  end if;
  for i in 1..n loop
    if p_weights[i] is null or p_weights[i] < 0 then
      perform app.fail('INVALID_ALLOCATION', '按分の重みは0以上である必要があります');
    end if;
    s := s + p_weights[i];
  end loop;
  w := p_weights::numeric[];
  if s = 0 then
    w := array_fill(1::numeric, array[n]);
    s := n;
  end if;
  leftover := total;
  for i in 1..n loop
    base := base || floor(total * w[i] / s)::bigint;
    rem := rem || mod(total * w[i], s);
    leftover := leftover - base[i];
  end loop;
  for idx in
    select t.i from unnest(rem) with ordinality as t(r, i) order by t.r desc, t.i asc limit leftover
  loop
    base[idx] := base[idx] + 1;
  end loop;
  if sgn < 0 then
    for i in 1..n loop base[i] := -base[i]; end loop;
  end if;
  return base;
end $$;

-- 在庫の残数量・残原価（台帳から算出）
create or replace function app.item_stock(p_item_id uuid, out qty integer, out cost_incl bigint, out cost_excl bigint)
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(m.quantity_delta), 0)::integer,
         coalesce(sum(m.cost_incl_delta), 0)::bigint,
         coalesce(sum(m.cost_excl_delta), 0)::bigint
  from public.inventory_movements m where m.item_id = p_item_id
$$;

-- 在庫から一部数量を出す場合の原価（残原価×数量÷残数量。最後の1点で残原価をすべて充当）
create or replace function app.cost_for_quantity(p_remaining_cost bigint, p_remaining_qty integer, p_qty integer)
returns bigint language sql immutable as $$
  select case when p_qty >= p_remaining_qty then p_remaining_cost
              else floor(p_remaining_cost::numeric * p_qty / p_remaining_qty)::bigint end
$$;

-- 採番: <prefix><YYMM>-<6桁>
create or replace function app.next_doc_no(p_prefix text, p_ts timestamptz)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_period text := to_char(p_ts at time zone 'Asia/Tokyo', 'YYMM');
  v_no integer;
begin
  insert into app.doc_counters as c (prefix, period, last_value) values (p_prefix, v_period, 1)
  on conflict (prefix, period) do update set last_value = c.last_value + 1
  returning last_value into v_no;
  return p_prefix || v_period || '-' || lpad(v_no::text, 6, '0');
end $$;

-- 資金口座残高
create or replace function app.fund_balance(p_account_id uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(t.amount), 0)::bigint from public.fund_transactions t where t.account_id = p_account_id
$$;

-- -----------------------------------------------------------------------------
-- 監査ログ
-- -----------------------------------------------------------------------------
create or replace function app.audit(p_action text, p_table text, p_record_id text, p_before jsonb, p_after jsonb, p_context jsonb default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs (actor_id, action, table_name, record_id, before_data, after_data, context)
  values (auth.uid(), p_action, p_table, p_record_id, p_before, p_after, p_context)
$$;

create or replace function app.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  -- 暗号文は監査ログに複製しない
  v_old := v_old - 'encrypted_payload';
  v_new := v_new - 'encrypted_payload';
  insert into public.audit_logs (actor_id, action, table_name, record_id, before_data, after_data)
  values (auth.uid(), lower(tg_op), tg_table_name, coalesce(v_new ->> 'id', v_old ->> 'id'), v_old, v_new);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'app_settings', 'profiles', 'customers', 'customer_identity_records', 'purchase_transactions', 'purchase_items',
    'item_photos', 'sales', 'sale_items', 'sale_expenses', 'payment_records', 'expenses', 'expense_allocations',
    'fund_accounts', 'fund_transactions', 'fund_reconciliations', 'approval_requests', 'accounting_periods',
    'inventory_movements', 'item_categories'
  ] loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function app.audit_row()', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 不変（追記専用）テーブル・物理削除禁止
-- -----------------------------------------------------------------------------
create or replace function app.reject_modification()
returns trigger language plpgsql as $$
begin
  raise exception 'SAIKOU:IMMUTABLE:% は変更・削除できません（取消・訂正は逆仕訳で記録してください）', tg_table_name
    using errcode = 'P0001';
end $$;

do $$
declare t text;
begin
  -- 追記専用（UPDATE も DELETE も不可）
  foreach t in array array['fund_transactions', 'inventory_movements', 'audit_logs', 'sale_items', 'sale_expenses', 'payment_records', 'fund_reconciliations'] loop
    execute format('create trigger immutable_%1$s before update or delete on public.%1$I for each row execute function app.reject_modification()', t);
  end loop;
  -- 状態更新は可・物理削除は不可
  foreach t in array array['profiles', 'customers', 'customer_identity_records', 'purchase_transactions', 'purchase_items',
                           'item_photos', 'sales', 'expenses', 'expense_allocations', 'fund_accounts', 'approval_requests', 'accounting_periods'] loop
    execute format('create trigger nodelete_%1$s before delete on public.%1$I for each row execute function app.reject_modification()', t);
  end loop;
end $$;

-- 締め済み期間への書き込み防止（日付を持つ帳簿行）
create or replace function app.check_period_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_col text;
begin
  -- 入金状況の更新のみは締め後も許可（入金は入金日の期間に記録される）
  if tg_op = 'UPDATE' and tg_table_name = 'sales'
     and (to_jsonb(new) - 'payment_status') = (to_jsonb(old) - 'payment_status') then
    return new;
  end if;
  v_col := case tg_table_name
    when 'purchase_transactions' then 'purchased_at'
    when 'sales' then 'sold_at'
    when 'payment_records' then 'received_at'
    else 'occurred_at'
  end;
  perform app.assert_period_open((to_jsonb(new) ->> v_col)::timestamptz);
  if tg_op = 'UPDATE' then
    perform app.assert_period_open((to_jsonb(old) ->> v_col)::timestamptz);
  end if;
  return new;
end $$;

create trigger period_purchase_transactions before insert or update on public.purchase_transactions
  for each row execute function app.check_period_trigger();
create trigger period_sales before insert or update on public.sales
  for each row execute function app.check_period_trigger();
create trigger period_fund_transactions before insert on public.fund_transactions
  for each row execute function app.check_period_trigger();
create trigger period_inventory_movements before insert on public.inventory_movements
  for each row execute function app.check_period_trigger();
create trigger period_payment_records before insert on public.payment_records
  for each row execute function app.check_period_trigger();

-- 対になる資金仕訳（transfer_group_id）の合計が0であることをコミット時に検証（二重仕訳相当）
create or replace function app.check_transfer_group_balanced()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_sum bigint; v_cnt integer;
begin
  if new.transfer_group_id is null then return null; end if;
  select coalesce(sum(amount), 0), count(*) into v_sum, v_cnt
  from public.fund_transactions where transfer_group_id = new.transfer_group_id;
  if v_sum <> 0 or v_cnt < 2 then
    raise exception 'SAIKOU:UNBALANCED_TRANSFER:資金移動の貸借が一致しません（group=%）', new.transfer_group_id
      using errcode = 'P0001';
  end if;
  return null;
end $$;

create constraint trigger fund_transfer_balanced after insert on public.fund_transactions
  deferrable initially deferred for each row execute function app.check_transfer_group_balanced();

-- 従業員準備金はマイナス残高不可（同時実行でも RPC 側の行ロックと合わせて保証）
create or replace function app.check_reserve_non_negative()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.fund_accounts a where a.id = new.account_id and a.kind = 'staff_reserve')
     and app.fund_balance(new.account_id) < 0 then
    raise exception 'SAIKOU:INSUFFICIENT_FUNDS:準備金残高が不足しています' using errcode = 'P0001';
  end if;
  return null;
end $$;

create constraint trigger fund_reserve_non_negative after insert on public.fund_transactions
  deferrable initially deferred for each row execute function app.check_reserve_non_negative();

-- updated_at
create or replace function app.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger touch_profiles before update on public.profiles for each row execute function app.touch_updated_at();
create trigger touch_customers before update on public.customers for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- 新規ユーザー → プロフィール・準備金口座の自動作成
--   role は app_metadata（サービスロールのみ設定可）から取得。未指定は staff。
-- -----------------------------------------------------------------------------
create or replace function app.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_role public.user_role := 'staff';
  v_name text;
begin
  if (new.raw_app_meta_data ->> 'role') in ('owner', 'admin', 'staff') then
    v_role := (new.raw_app_meta_data ->> 'role')::public.user_role;
  end if;
  v_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1), '従業員');
  insert into public.profiles (id, display_name, email, role) values (new.id, left(v_name, 100), new.email, v_role);
  insert into public.fund_accounts (kind, owner_profile_id, name) values ('staff_reserve', new.id, left(v_name, 90) || ' 準備金');
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

-- Auth API は app_metadata をユーザー作成直後の UPDATE で設定する場合があるため、
-- app_metadata.role が変更されたときのみプロフィールの役割を同期する（サービスロールのみ変更可能な値）
create or replace function app.handle_user_role_metadata()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.raw_app_meta_data ->> 'role') is distinct from (old.raw_app_meta_data ->> 'role')
     and (new.raw_app_meta_data ->> 'role') in ('owner', 'admin', 'staff') then
    update public.profiles set role = (new.raw_app_meta_data ->> 'role')::public.user_role where id = new.id;
  end if;
  return new;
end $$;

create trigger on_auth_user_role_metadata after update of raw_app_meta_data on auth.users
  for each row execute function app.handle_user_role_metadata();


-- ===== 20261113000300_business_rpc.sql =====
-- =============================================================================
-- 業務処理 RPC（すべて 1 トランザクションで原子的に実行）
--   - SECURITY DEFINER + search_path 固定
--   - 先頭で auth.uid() と役割を検証。クライアント送信の担当者IDは管理者以外無視
--   - idempotency_key で二重送信を吸収（同じキーの再送は既存結果を返す）
-- =============================================================================

-- 冪等キー単位の排他（同一キーの同時実行を直列化）
create or replace function app.lock_key(p_key uuid)
returns void language sql as $$
  select pg_advisory_xact_lock(hashtextextended(p_key::text, 7341))
$$;

-- 口座行ロック（残高判定の直列化）
create or replace function app.lock_account(p_account_id uuid)
returns public.fund_accounts language plpgsql security definer set search_path = '' as $$
declare v public.fund_accounts;
begin
  select * into v from public.fund_accounts where id = p_account_id for update;
  if not found then perform app.fail('NOT_FOUND', '資金口座が見つかりません'); end if;
  if not v.is_active then perform app.fail('ACCOUNT_INACTIVE', '無効な資金口座です'); end if;
  return v;
end $$;

create or replace function app.staff_reserve_account(p_staff_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.fund_accounts where kind = 'staff_reserve' and owner_profile_id = p_staff_id
$$;

create or replace function app.company_account(p_kind public.fund_account_kind)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.fund_accounts where kind = p_kind and owner_profile_id is null and is_active
$$;

-- 従業員 → 指定担当者の解決（従業員は常に自分）
create or replace function app.resolve_staff(p_requested uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := app.require_user();
begin
  if p_requested is null or p_requested = v_uid then return v_uid; end if;
  if not app.is_manager() then
    -- 従業員が他人を担当者に指定しても無視せず明示的に拒否する
    perform app.fail('FORBIDDEN', '担当者を変更できるのは代表または管理者のみです');
  end if;
  if not exists (select 1 from public.profiles where id = p_requested and is_active) then
    perform app.fail('NOT_FOUND', '指定された担当者が見つからないか無効です');
  end if;
  return p_requested;
end $$;

-- 商品ステータスを台帳から再計算
create or replace function app.refresh_item_status(p_item_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_item public.purchase_items;
  v_stock record;
  v_status public.item_status;
begin
  select * into v_item from public.purchase_items where id = p_item_id;
  if v_item.status in ('voided', 'split') then return; end if;
  select * into v_stock from app.item_stock(p_item_id);
  v_status := case
    when v_stock.qty <= 0 then 'sold'
    when v_stock.qty < v_item.quantity then 'partially_sold'
    else 'in_stock' end;
  if v_status is distinct from v_item.status then
    update public.purchase_items set status = v_status where id = p_item_id;
  end if;
end $$;

-- =============================================================================
-- 買取登録
-- =============================================================================
-- p 例:
-- { "idempotency_key": uuid, "purchased_at": ts, "staff_id": uuid|null,
--   "customer_id": uuid|null, "customer": {"name","name_kana","phone","note"}|null,
--   "method": "store", "payment_method": "cash", "note": text,
--   "identity": {"verification_method","encrypted_payload","key_version"}|null,
--   "items": [{"category_id","brand","name","model_no","serial_no","condition","quantity",
--              "cost_incl","tax_category","storage_location","note"}] }
create or replace function public.register_purchase(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_user();
  v_key uuid := (p ->> 'idempotency_key')::uuid;
  v_existing public.purchase_transactions;
  v_staff uuid;
  v_at timestamptz := coalesce((p ->> 'purchased_at')::timestamptz, now());
  v_pay public.payment_method := (p ->> 'payment_method')::public.payment_method;
  v_account public.fund_accounts;
  v_customer uuid := (p ->> 'customer_id')::uuid;
  v_tx_id uuid := gen_random_uuid();
  v_item jsonb;
  v_line integer := 0;
  v_cost bigint;
  v_tax bigint;
  v_cat public.tax_category;
  v_qty integer;
  v_total_incl bigint := 0;
  v_total_tax bigint := 0;
  v_item_id uuid;
  v_items jsonb := '[]'::jsonb;
  v_mode public.rounding_mode := app.current_rounding();
  v_balance bigint;
  v_years integer;
begin
  if v_key is null then perform app.fail('VALIDATION', '冪等キーがありません'); end if;
  perform app.lock_key(v_key);
  select * into v_existing from public.purchase_transactions where idempotency_key = v_key;
  if found then
    if v_existing.entered_by <> v_uid then perform app.fail('CONFLICT', '冪等キーが重複しています'); end if;
    return jsonb_build_object('purchase_id', v_existing.id, 'purchase_no', v_existing.purchase_no, 'duplicate', true,
      'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'item_no', i.item_no, 'line_no', i.line_no) order by i.line_no), '[]')
                from public.purchase_items i where i.purchase_transaction_id = v_existing.id));
  end if;

  v_staff := app.resolve_staff((p ->> 'staff_id')::uuid);
  if v_at > now() + interval '1 day' then perform app.fail('VALIDATION', '買取日時が未来です'); end if;
  perform app.assert_period_open(v_at);

  if jsonb_typeof(p -> 'items') <> 'array' or jsonb_array_length(p -> 'items') = 0 then
    perform app.fail('VALIDATION', '商品を1点以上入力してください');
  end if;
  if jsonb_array_length(p -> 'items') > 200 then
    perform app.fail('VALIDATION', '1取引の商品は200点までです');
  end if;

  -- 合計
  for v_item in select * from jsonb_array_elements(p -> 'items') loop
    v_cost := (v_item ->> 'cost_incl')::bigint;
    if v_cost is null or v_cost < 0 then perform app.fail('VALIDATION', '買取金額は0円以上で入力してください'); end if;
    v_total_incl := v_total_incl + v_cost;
  end loop;
  if p ? 'total_incl' and (p ->> 'total_incl')::bigint <> v_total_incl then
    perform app.fail('TOTAL_MISMATCH', '買取合計と商品別金額の合計が一致しません');
  end if;

  -- 支払元口座: 現金 = 担当者の準備金 / 振込・その他 = 会社口座
  if v_pay = 'cash' then
    select * into v_account from app.lock_account(app.staff_reserve_account(v_staff));
  else
    select * into v_account from app.lock_account(app.company_account('company_bank'));
  end if;
  if v_account.kind = 'staff_reserve' then
    v_balance := app.fund_balance(v_account.id);
    if v_balance < v_total_incl then
      perform app.fail('INSUFFICIENT_FUNDS',
        format('準備金残高が不足しています（残高 %s円 / 必要額 %s円）', v_balance, v_total_incl));
    end if;
  end if;

  -- 顧客
  if v_customer is not null then
    if not (app.is_manager()
            or exists (select 1 from public.customers c where c.id = v_customer and c.created_by = v_uid)
            or exists (select 1 from public.purchase_transactions t where t.customer_id = v_customer and t.staff_id = v_uid)
            -- 電話番号検索で見つけた既存顧客: 電話番号の一致を再確認
            or exists (select 1 from public.customers c where c.id = v_customer and c.phone is not null
                       and c.phone = regexp_replace(coalesce(p ->> 'customer_phone', ''), '[^0-9+\-]', '', 'g'))) then
      perform app.fail('FORBIDDEN', 'この顧客を参照する権限がありません');
    end if;
  elsif p -> 'customer' is not null and jsonb_typeof(p -> 'customer') = 'object' then
    insert into public.customers (name, name_kana, phone, note, created_by)
    values (trim(p -> 'customer' ->> 'name'), nullif(trim(p -> 'customer' ->> 'name_kana'), ''),
            nullif(regexp_replace(coalesce(p -> 'customer' ->> 'phone', ''), '[^0-9+\-]', '', 'g'), ''),
            nullif(p -> 'customer' ->> 'note', ''), v_uid)
    returning id into v_customer;
  end if;

  insert into public.purchase_transactions (id, purchase_no, purchased_at, staff_id, entered_by, customer_id, method,
    payment_method, fund_account_id, total_incl, total_excl, total_tax, note, idempotency_key)
  values (v_tx_id, app.next_doc_no('P', v_at), v_at, v_staff, v_uid, v_customer, (p ->> 'method')::public.purchase_method,
    v_pay, v_account.id, 0, 0, 0, nullif(p ->> 'note', ''), v_key);

  for v_item in select * from jsonb_array_elements(p -> 'items') loop
    v_line := v_line + 1;
    v_cost := (v_item ->> 'cost_incl')::bigint;
    v_cat := coalesce((v_item ->> 'tax_category')::public.tax_category, 'standard_10');
    v_qty := coalesce((v_item ->> 'quantity')::integer, 1);
    if v_qty <= 0 then perform app.fail('VALIDATION', '数量は1以上で入力してください'); end if;
    v_tax := app.tax_from_incl(v_cost, v_cat, v_mode);
    v_total_tax := v_total_tax + v_tax;
    insert into public.purchase_items (item_no, purchase_transaction_id, line_no, staff_id, purchased_at, category_id,
      brand, name, model_no, serial_no, condition, quantity, cost_incl, cost_excl, cost_tax, tax_category,
      storage_location, note)
    values (app.next_doc_no('K', v_at), v_tx_id, v_line, v_staff, v_at, (v_item ->> 'category_id')::uuid,
      nullif(trim(v_item ->> 'brand'), ''), trim(v_item ->> 'name'), nullif(trim(v_item ->> 'model_no'), ''),
      nullif(trim(v_item ->> 'serial_no'), ''), (v_item ->> 'condition')::public.item_condition, v_qty,
      v_cost, v_cost - v_tax, v_tax, v_cat, nullif(trim(v_item ->> 'storage_location'), ''), nullif(v_item ->> 'note', ''))
    returning id into v_item_id;
    insert into public.inventory_movements (item_id, movement_type, quantity_delta, cost_incl_delta, cost_excl_delta, occurred_at, created_by)
    values (v_item_id, 'purchase_in', v_qty, v_cost, v_cost - v_tax, v_at, v_uid);
    v_items := v_items || jsonb_build_object('id', v_item_id, 'line_no', v_line,
      'item_no', (select item_no from public.purchase_items where id = v_item_id));
  end loop;

  update public.purchase_transactions
     set total_incl = v_total_incl, total_excl = v_total_incl - v_total_tax, total_tax = v_total_tax
   where id = v_tx_id;

  if v_total_incl > 0 then
    insert into public.fund_transactions (account_id, tx_type, amount, occurred_at, purchase_transaction_id, idempotency_key, memo, created_by)
    values (v_account.id, 'purchase_payment', -v_total_incl, v_at, v_tx_id, v_key,
            '買取 ' || (select purchase_no from public.purchase_transactions where id = v_tx_id), v_uid);
  end if;

  -- 本人確認記録（暗号化済みペイロードを保存）
  if p -> 'identity' is not null and jsonb_typeof(p -> 'identity') = 'object' then
    if v_customer is null then perform app.fail('VALIDATION', '本人確認記録には顧客情報が必要です'); end if;
    select identity_retention_years into v_years from public.app_settings;
    insert into public.customer_identity_records (customer_id, purchase_transaction_id, verification_method,
      encrypted_payload, key_version, verified_at, verified_by, retain_until)
    values (v_customer, v_tx_id, p -> 'identity' ->> 'verification_method', p -> 'identity' ->> 'encrypted_payload',
      (p -> 'identity' ->> 'key_version')::integer, v_at, v_uid,
      ((v_at at time zone 'Asia/Tokyo')::date + make_interval(years => v_years))::date);
  end if;

  return jsonb_build_object('purchase_id', v_tx_id,
    'purchase_no', (select purchase_no from public.purchase_transactions where id = v_tx_id),
    'total_incl', v_total_incl, 'items', v_items, 'duplicate', false);
end $$;

-- =============================================================================
-- 買取取消（代表・管理者。従業員は承認申請 → approve_request から実行）
-- =============================================================================
create or replace function app.void_purchase_internal(p_purchase_id uuid, p_reason text, p_actor uuid, p_approval uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tx public.purchase_transactions;
  v_item record;
begin
  select * into v_tx from public.purchase_transactions where id = p_purchase_id for update;
  if not found then perform app.fail('NOT_FOUND', '買取取引が見つかりません'); end if;
  if v_tx.status = 'voided' then return jsonb_build_object('purchase_id', v_tx.id, 'duplicate', true); end if;
  perform app.assert_period_open(v_tx.purchased_at);
  perform app.lock_account(v_tx.fund_account_id);

  -- 全商品が未処理（買取入庫以外の移動がない）であること
  if exists (
    select 1 from public.inventory_movements m join public.purchase_items i on i.id = m.item_id
    where i.purchase_transaction_id = v_tx.id and m.movement_type <> 'purchase_in'
  ) then
    perform app.fail('ITEM_ALREADY_PROCESSED', '販売・分割済みの商品を含むため取消できません');
  end if;

  for v_item in select * from public.purchase_items where purchase_transaction_id = v_tx.id for update loop
    insert into public.inventory_movements (item_id, movement_type, quantity_delta, cost_incl_delta, cost_excl_delta, occurred_at, created_by)
    values (v_item.id, 'purchase_void_out', -v_item.quantity, -v_item.cost_incl, -v_item.cost_excl, v_tx.purchased_at, p_actor);
    update public.purchase_items set status = 'voided' where id = v_item.id;
  end loop;

  if v_tx.total_incl > 0 then
    insert into public.fund_transactions (account_id, tx_type, amount, occurred_at, purchase_transaction_id,
      approval_request_id, idempotency_key, memo, created_by)
    values (v_tx.fund_account_id, 'purchase_refund', v_tx.total_incl, v_tx.purchased_at, v_tx.id, p_approval,
      gen_random_uuid(), '買取取消 ' || v_tx.purchase_no, p_actor);
  end if;

  update public.purchase_transactions
     set status = 'voided', voided_at = now(), voided_by = p_actor, void_reason = p_reason
   where id = v_tx.id;
  return jsonb_build_object('purchase_id', v_tx.id, 'duplicate', false);
end $$;

create or replace function public.void_purchase(p_purchase_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_manager();
begin
  if coalesce(trim(p_reason), '') = '' then perform app.fail('VALIDATION', '取消理由を入力してください'); end if;
  return app.void_purchase_internal(p_purchase_id, p_reason, v_uid, null);
end $$;

-- =============================================================================
-- セット商品の分割
-- p: { "item_id", "idempotency_key", "children": [{"name","brand","model_no","serial_no","condition","category_id","quantity","cost_incl"}] }
-- =============================================================================
create or replace function public.split_item(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_user();
  v_parent public.purchase_items;
  v_child jsonb;
  v_children jsonb := p -> 'children';
  v_sum bigint := 0;
  v_weights bigint[] := '{}';
  v_excl bigint[];
  v_i integer := 0;
  v_cost bigint;
  v_id uuid;
  v_out jsonb := '[]'::jsonb;
  v_now timestamptz := now();
begin
  perform app.lock_key((p ->> 'idempotency_key')::uuid);
  select * into v_parent from public.purchase_items where id = (p ->> 'item_id')::uuid for update;
  if not found then perform app.fail('NOT_FOUND', '商品が見つかりません'); end if;
  if v_parent.status = 'split' then
    return jsonb_build_object('item_id', v_parent.id, 'duplicate', true);
  end if;
  if not app.can_edit_item(v_parent.id) then perform app.fail('FORBIDDEN', 'この商品を編集する権限がありません'); end if;
  if v_parent.status <> 'in_stock' or exists (
    select 1 from public.inventory_movements where item_id = v_parent.id and movement_type <> 'purchase_in') then
    perform app.fail('ITEM_ALREADY_PROCESSED', '販売・分割済みの商品は分割できません');
  end if;
  if jsonb_typeof(v_children) <> 'array' or jsonb_array_length(v_children) < 2 then
    perform app.fail('VALIDATION', '2点以上に分割してください');
  end if;
  perform app.assert_period_open(v_now);

  for v_child in select * from jsonb_array_elements(v_children) loop
    v_cost := (v_child ->> 'cost_incl')::bigint;
    if v_cost is null or v_cost < 0 then perform app.fail('VALIDATION', '原価は0円以上で入力してください'); end if;
    v_sum := v_sum + v_cost;
    v_weights := v_weights || v_cost;
  end loop;
  if v_sum <> v_parent.cost_incl then
    perform app.fail('TOTAL_MISMATCH', format('分割後の原価合計（%s円）が元の原価（%s円）と一致しません', v_sum, v_parent.cost_incl));
  end if;
  v_excl := app.allocate(v_parent.cost_excl, v_weights);

  insert into public.inventory_movements (item_id, movement_type, quantity_delta, cost_incl_delta, cost_excl_delta, occurred_at, created_by)
  values (v_parent.id, 'split_out', -v_parent.quantity, -v_parent.cost_incl, -v_parent.cost_excl, v_now, v_uid);
  update public.purchase_items set status = 'split' where id = v_parent.id;

  for v_child in select * from jsonb_array_elements(v_children) loop
    v_i := v_i + 1;
    v_cost := (v_child ->> 'cost_incl')::bigint;
    insert into public.purchase_items (item_no, purchase_transaction_id, parent_item_id, line_no, staff_id, purchased_at,
      category_id, brand, name, model_no, serial_no, condition, quantity, cost_incl, cost_excl, cost_tax, tax_category,
      storage_location, note)
    values (app.next_doc_no('K', v_now), v_parent.purchase_transaction_id, v_parent.id, v_parent.line_no, v_parent.staff_id,
      v_parent.purchased_at, coalesce((v_child ->> 'category_id')::uuid, v_parent.category_id),
      coalesce(nullif(trim(v_child ->> 'brand'), ''), v_parent.brand), trim(v_child ->> 'name'),
      nullif(trim(v_child ->> 'model_no'), ''), nullif(trim(v_child ->> 'serial_no'), ''),
      coalesce((v_child ->> 'condition')::public.item_condition, v_parent.condition),
      coalesce((v_child ->> 'quantity')::integer, 1), v_cost, v_excl[v_i], v_cost - v_excl[v_i], v_parent.tax_category,
      v_parent.storage_location, '分割元: ' || v_parent.item_no)
    returning id into v_id;
    insert into public.inventory_movements (item_id, movement_type, quantity_delta, cost_incl_delta, cost_excl_delta, occurred_at, created_by)
    values (v_id, 'split_in', coalesce((v_child ->> 'quantity')::integer, 1), v_cost, v_excl[v_i], v_now, v_uid);
    v_out := v_out || jsonb_build_object('id', v_id, 'item_no', (select item_no from public.purchase_items where id = v_id));
  end loop;
  return jsonb_build_object('item_id', v_parent.id, 'children', v_out, 'duplicate', false);
end $$;

-- =============================================================================
-- 商品写真の登録（Storage アップロード後に呼び出す）
-- =============================================================================
create or replace function public.add_item_photo(p_item_id uuid, p_path text, p_content_type text, p_size integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_user();
  v_id uuid;
begin
  if not app.can_edit_item(p_item_id) then perform app.fail('FORBIDDEN', 'この商品に写真を追加する権限がありません'); end if;
  if p_path not like 'items/' || p_item_id::text || '/%' or p_path like '%..%' then
    perform app.fail('VALIDATION', '写真の保存先が不正です');
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'item-photos' and o.name = p_path) then
    perform app.fail('NOT_FOUND', '写真ファイルがアップロードされていません');
  end if;
  insert into public.item_photos (item_id, storage_path, content_type, size_bytes, sort_order, uploaded_by)
  values (p_item_id, p_path, p_content_type, p_size,
          coalesce((select max(sort_order) + 1 from public.item_photos where item_id = p_item_id), 0), v_uid)
  on conflict (storage_path) do nothing
  returning id into v_id;
  if v_id is null then select id into v_id from public.item_photos where storage_path = p_path; end if;
  return v_id;
end $$;

create or replace function public.remove_item_photo(p_photo_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_user();
  v_item uuid;
begin
  select item_id into v_item from public.item_photos where id = p_photo_id and deleted_at is null;
  if v_item is null then perform app.fail('NOT_FOUND', '写真が見つかりません'); end if;
  if not app.can_edit_item(v_item) then perform app.fail('FORBIDDEN', 'この写真を削除する権限がありません'); end if;
  update public.item_photos set deleted_at = now(), deleted_by = v_uid where id = p_photo_id;
end $$;

-- =============================================================================
-- 販売登録
-- p 例:
-- { "idempotency_key", "sold_at", "sales_staff_id", "channel", "buyer_name", "note",
--   "allocation": "manual" | "cost",          -- manual: 明細ごとの金額 / cost: 一括金額を原価比で按分
--   "total_revenue_incl": 100000,             -- allocation=cost の場合必須
--   "lines": [{"item_id","quantity","revenue_incl","tax_category"}],
--   "expenses": [{"expense_type","amount_incl","tax_category","note"}],
--   "expected_receipt_amount": null,          -- 省略時は売上合計
--   "payment_due_date": "2026-11-30", "received_now": false, "payment_method": "cash" }
-- =============================================================================
create or replace function public.register_sale(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_user();
  v_key uuid := (p ->> 'idempotency_key')::uuid;
  v_existing public.sales;
  v_staff uuid;
  v_at timestamptz := coalesce((p ->> 'sold_at')::timestamptz, now());
  v_mode public.rounding_mode := app.current_rounding();
  v_alloc text := coalesce(p ->> 'allocation', 'manual');
  v_lines jsonb := p -> 'lines';
  v_n integer;
  v_line jsonb;
  v_item public.purchase_items;
  v_stock record;
  v_i integer := 0;
  v_qty integer;
  v_item_ids uuid[] := '{}';
  v_qtys integer[] := '{}';
  v_cost_incl bigint[] := '{}';
  v_cost_excl bigint[] := '{}';
  v_rev bigint[] := '{}';
  v_cats public.tax_category[] := '{}';
  v_staffs uuid[] := '{}';
  v_catids uuid[] := '{}';
  v_exp_incl_total bigint := 0;
  v_exp_excl_total bigint := 0;
  v_exp jsonb;
  v_amt bigint;
  v_tax bigint;
  v_cat public.tax_category;
  v_exp_incl bigint[];
  v_exp_excl bigint[];
  v_rev_total bigint := 0;
  v_rev_tax_total bigint := 0;
  v_sale_id uuid := gen_random_uuid();
  v_sale_item_id uuid;
  v_expected bigint;
  v_lines_out jsonb := '[]'::jsonb;
begin
  if v_key is null then perform app.fail('VALIDATION', '冪等キーがありません'); end if;
  perform app.lock_key(v_key);
  select * into v_existing from public.sales where idempotency_key = v_key;
  if found then
    if v_existing.entered_by <> v_uid then perform app.fail('CONFLICT', '冪等キーが重複しています'); end if;
    return jsonb_build_object('sale_id', v_existing.id, 'sale_no', v_existing.sale_no, 'duplicate', true);
  end if;

  v_staff := app.resolve_staff((p ->> 'sales_staff_id')::uuid);
  if v_at > now() + interval '1 day' then perform app.fail('VALIDATION', '販売日時が未来です'); end if;
  perform app.assert_period_open(v_at);
  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then
    perform app.fail('VALIDATION', '販売する商品を1点以上選択してください');
  end if;
  v_n := jsonb_array_length(v_lines);
  if v_alloc not in ('manual', 'cost') then perform app.fail('VALIDATION', '按分方法が不正です'); end if;

  -- 在庫をロックして数量・原価を確定（商品ID順にロックしてデッドロックを回避）
  perform 1 from public.purchase_items
   where id in (select (e ->> 'item_id')::uuid from jsonb_array_elements(v_lines) e)
   order by id for update;

  for v_line in select * from jsonb_array_elements(v_lines) loop
    v_i := v_i + 1;
    select * into v_item from public.purchase_items where id = (v_line ->> 'item_id')::uuid;
    if not found then perform app.fail('NOT_FOUND', '商品が見つかりません'); end if;
    if v_item.id = any (v_item_ids) then perform app.fail('VALIDATION', '同じ商品が重複しています: ' || v_item.item_no); end if;
    if v_item.status not in ('in_stock', 'partially_sold') then
      perform app.fail('OUT_OF_STOCK', v_item.item_no || ' は在庫がありません');
    end if;
    if not app.can_view_item(v_item.id) then perform app.fail('FORBIDDEN', v_item.item_no || ' を販売する権限がありません'); end if;
    v_qty := coalesce((v_line ->> 'quantity')::integer, 1);
    select * into v_stock from app.item_stock(v_item.id);
    if v_qty <= 0 or v_qty > v_stock.qty then
      perform app.fail('OUT_OF_STOCK', format('%s の在庫数量が不足しています（在庫 %s / 販売 %s）', v_item.item_no, v_stock.qty, v_qty));
    end if;
    v_item_ids := v_item_ids || v_item.id;
    v_qtys := v_qtys || v_qty;
    v_cost_incl := v_cost_incl || app.cost_for_quantity(v_stock.cost_incl, v_stock.qty, v_qty);
    v_cost_excl := v_cost_excl || app.cost_for_quantity(v_stock.cost_excl, v_stock.qty, v_qty);
    v_cats := v_cats || coalesce((v_line ->> 'tax_category')::public.tax_category, 'standard_10');
    v_staffs := v_staffs || v_item.staff_id;
    v_catids := v_catids || v_item.category_id;
    if v_alloc = 'manual' then
      v_amt := (v_line ->> 'revenue_incl')::bigint;
      if v_amt is null or v_amt < 0 then perform app.fail('VALIDATION', '販売金額は0円以上で入力してください'); end if;
      v_rev := v_rev || v_amt;
    end if;
  end loop;

  if v_alloc = 'cost' then
    v_amt := (p ->> 'total_revenue_incl')::bigint;
    if v_amt is null or v_amt < 0 then perform app.fail('VALIDATION', '販売合計金額を入力してください'); end if;
    v_rev := app.allocate(v_amt, v_cost_incl);
  end if;
  select coalesce(sum(x), 0) into v_rev_total from unnest(v_rev) x;

  -- 販売直接費（売上比で配分。売上0なら原価比→均等）
  if jsonb_typeof(p -> 'expenses') = 'array' then
    for v_exp in select * from jsonb_array_elements(p -> 'expenses') loop
      v_amt := coalesce((v_exp ->> 'amount_incl')::bigint, 0);
      if v_amt < 0 then perform app.fail('VALIDATION', '経費は0円以上で入力してください'); end if;
      if v_amt = 0 then continue; end if;
      v_cat := coalesce((v_exp ->> 'tax_category')::public.tax_category, 'standard_10');
      v_tax := app.tax_from_incl(v_amt, v_cat, v_mode);
      v_exp_incl_total := v_exp_incl_total + v_amt;
      v_exp_excl_total := v_exp_excl_total + v_amt - v_tax;
    end loop;
  end if;
  v_exp_incl := app.allocate(v_exp_incl_total, case when v_rev_total > 0 then v_rev else v_cost_incl end);
  v_exp_excl := app.allocate(v_exp_excl_total, case when v_rev_total > 0 then v_rev else v_cost_incl end);

  v_expected := coalesce((p ->> 'expected_receipt_amount')::bigint, v_rev_total);
  if v_expected < 0 then perform app.fail('VALIDATION', '入金予定額が不正です'); end if;

  insert into public.sales (id, sale_no, kind, channel, sold_at, sales_staff_id, entered_by, buyer_name,
    revenue_incl, revenue_excl, revenue_tax, direct_expense_incl, direct_expense_excl,
    expected_receipt_amount, payment_due_date, note, idempotency_key)
  values (v_sale_id, app.next_doc_no('S', v_at), 'sale', (p ->> 'channel')::public.sales_channel, v_at, v_staff, v_uid,
    nullif(trim(p ->> 'buyer_name'), ''), 0, 0, 0, v_exp_incl_total, v_exp_excl_total,
    v_expected, (p ->> 'payment_due_date')::date, nullif(p ->> 'note', ''), v_key);

  for v_i in 1..v_n loop
    v_tax := app.tax_from_incl(v_rev[v_i], v_cats[v_i], v_mode);
    v_rev_tax_total := v_rev_tax_total + v_tax;
    insert into public.sale_items (sale_id, line_no, item_id, quantity, tax_category, revenue_incl, revenue_excl, revenue_tax,
      cost_incl, cost_excl, direct_expense_incl, direct_expense_excl, purchaser_staff_id, category_id)
    values (v_sale_id, v_i, v_item_ids[v_i], v_qtys[v_i], v_cats[v_i], v_rev[v_i], v_rev[v_i] - v_tax, v_tax,
      v_cost_incl[v_i], v_cost_excl[v_i], v_exp_incl[v_i], v_exp_excl[v_i], v_staffs[v_i], v_catids[v_i])
    returning id into v_sale_item_id;
    insert into public.inventory_movements (item_id, movement_type, quantity_delta, cost_incl_delta, cost_excl_delta,
      sale_item_id, occurred_at, created_by)
    values (v_item_ids[v_i], 'sale_out', -v_qtys[v_i], -v_cost_incl[v_i], -v_cost_excl[v_i], v_sale_item_id, v_at, v_uid);
    perform app.refresh_item_status(v_item_ids[v_i]);
    v_lines_out := v_lines_out || jsonb_build_object('sale_item_id', v_sale_item_id, 'item_id', v_item_ids[v_i],
      'revenue_incl', v_rev[v_i], 'direct_expense_incl', v_exp_incl[v_i]);
  end loop;

  if jsonb_typeof(p -> 'expenses') = 'array' then
    insert into public.sale_expenses (sale_id, expense_type, tax_category, amount_incl, amount_excl, amount_tax, note)
    select v_sale_id, (e ->> 'expense_type')::public.sale_expense_type,
           coalesce((e ->> 'tax_category')::public.tax_category, 'standard_10'),
           (e ->> 'amount_incl')::bigint,
           (e ->> 'amount_incl')::bigint - app.tax_from_incl((e ->> 'amount_incl')::bigint, coalesce((e ->> 'tax_category')::public.tax_category, 'standard_10'), v_mode),
           app.tax_from_incl((e ->> 'amount_incl')::bigint, coalesce((e ->> 'tax_category')::public.tax_category, 'standard_10'), v_mode),
           nullif(e ->> 'note', '')
    from jsonb_array_elements(p -> 'expenses') e
    where coalesce((e ->> 'amount_incl')::bigint, 0) > 0;
  end if;

  update public.sales set revenue_incl = v_rev_total, revenue_excl = v_rev_total - v_rev_tax_total, revenue_tax = v_rev_tax_total
   where id = v_sale_id;

  if coalesce((p ->> 'received_now')::boolean, false) and v_expected > 0 then
    insert into public.payment_records (sale_id, kind, amount, received_at, method, recorded_by, idempotency_key)
    values (v_sale_id, 'receipt', v_expected, v_at, nullif(p ->> 'payment_method', ''), v_uid, gen_random_uuid());
  end if;
  perform app.refresh_payment_status(v_sale_id);

  return jsonb_build_object('sale_id', v_sale_id, 'sale_no', (select sale_no from public.sales where id = v_sale_id),
    'revenue_incl', v_rev_total, 'lines', v_lines_out, 'duplicate', false);
end $$;

-- 入金状況の再計算
create or replace function app.refresh_payment_status(p_sale_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_sale public.sales;
  v_net bigint;
  v_status public.payment_status;
begin
  select * into v_sale from public.sales where id = p_sale_id;
  select coalesce(sum(case kind when 'receipt' then amount else -amount end), 0) into v_net
  from public.payment_records where sale_id = p_sale_id;
  v_status := case
    when v_sale.expected_receipt_amount = 0 then 'paid'
    when v_sale.expected_receipt_amount > 0 and v_net >= v_sale.expected_receipt_amount then 'paid'
    when v_sale.expected_receipt_amount < 0 and v_net <= v_sale.expected_receipt_amount then 'paid'
    when v_net = 0 then 'unpaid'
    else 'partial' end;
  if v_status is distinct from v_sale.payment_status then
    update public.sales set payment_status = v_status where id = p_sale_id;
  end if;
end $$;

-- =============================================================================
-- 入金・返金の記録
-- p: { "sale_id", "kind": "receipt"|"refund", "amount", "received_at", "method", "note", "idempotency_key" }
-- =============================================================================
create or replace function public.record_payment(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_user();
  v_key uuid := (p ->> 'idempotency_key')::uuid;
  v_sale public.sales;
  v_id uuid;
  v_amt bigint := (p ->> 'amount')::bigint;
begin
  if v_key is null then perform app.fail('VALIDATION', '冪等キーがありません'); end if;
  perform app.lock_key(v_key);
  select id into v_id from public.payment_records where idempotency_key = v_key;
  if found then return jsonb_build_object('payment_id', v_id, 'duplicate', true); end if;
  select * into v_sale from public.sales where id = (p ->> 'sale_id')::uuid for update;
  if not found then perform app.fail('NOT_FOUND', '販売が見つかりません'); end if;
  if not (app.is_manager() or v_sale.sales_staff_id = v_uid) then
    perform app.fail('FORBIDDEN', 'この販売の入金を記録する権限がありません');
  end if;
  if v_sale.status = 'cancelled' then perform app.fail('SALE_CANCELLED', 'キャンセル済みの販売です'); end if;
  if v_amt is null or v_amt <= 0 then perform app.fail('VALIDATION', '金額は1円以上で入力してください'); end if;
  insert into public.payment_records (sale_id, kind, amount, received_at, method, note, recorded_by, idempotency_key)
  values (v_sale.id, coalesce((p ->> 'kind')::public.payment_record_kind, 'receipt'), v_amt,
    coalesce((p ->> 'received_at')::timestamptz, now()), nullif(p ->> 'method', ''), nullif(p ->> 'note', ''), v_uid, v_key)
  returning id into v_id;
  perform app.refresh_payment_status(v_sale.id);
  return jsonb_build_object('payment_id', v_id, 'duplicate', false);
end $$;

-- =============================================================================
-- 販売キャンセル（訂正。締め前のみ。代表・管理者 or 承認経由）
-- =============================================================================
create or replace function app.cancel_sale_internal(p_sale_id uuid, p_reason text, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_sale public.sales;
  v_line record;
  v_net bigint;
begin
  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then perform app.fail('NOT_FOUND', '販売が見つかりません'); end if;
  if v_sale.status = 'cancelled' then return jsonb_build_object('sale_id', v_sale.id, 'duplicate', true); end if;
  if v_sale.kind <> 'sale' then perform app.fail('VALIDATION', '返品伝票はキャンセルできません'); end if;
  perform app.assert_period_open(v_sale.sold_at);
  if exists (select 1 from public.sales where original_sale_id = v_sale.id and status = 'confirmed') then
    perform app.fail('HAS_RETURNS', '返品が登録されている販売はキャンセルできません');
  end if;
  select coalesce(sum(case kind when 'receipt' then amount else -amount end), 0) into v_net
  from public.payment_records where sale_id = v_sale.id;
  if v_net <> 0 then
    perform app.fail('HAS_PAYMENTS', '入金済みの販売はキャンセルできません。返金を記録するか返品として処理してください');
  end if;

  perform 1 from public.purchase_items where id in (select item_id from public.sale_items where sale_id = v_sale.id) order by id for update;
  for v_line in select * from public.sale_items where sale_id = v_sale.id loop
    insert into public.inventory_movements (item_id, movement_type, quantity_delta, cost_incl_delta, cost_excl_delta,
      sale_item_id, occurred_at, created_by)
    values (v_line.item_id, 'sale_cancel_in', v_line.quantity, v_line.cost_incl, v_line.cost_excl, v_line.id, v_sale.sold_at, p_actor);
    perform app.refresh_item_status(v_line.item_id);
  end loop;
  update public.sales set status = 'cancelled', cancelled_at = now(), cancelled_by = p_actor, cancel_reason = p_reason
   where id = v_sale.id;
  return jsonb_build_object('sale_id', v_sale.id, 'duplicate', false);
end $$;

create or replace function public.cancel_sale(p_sale_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_manager();
begin
  if coalesce(trim(p_reason), '') = '' then perform app.fail('VALIDATION', 'キャンセル理由を入力してください'); end if;
  return app.cancel_sale_internal(p_sale_id, p_reason, v_uid);
end $$;

-- =============================================================================
-- 返品（返品日の期間にマイナス計上。元の販売は変更しない）
-- p: { "idempotency_key", "original_sale_id", "returned_at", "lines": [{"sale_item_id","quantity"}],
--      "refund_total_incl": null, "expenses": [...], "note" }
-- =============================================================================
create or replace function public.register_return(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_user();
  v_key uuid := (p ->> 'idempotency_key')::uuid;
  v_orig public.sales;
  v_existing public.sales;
  v_at timestamptz := coalesce((p ->> 'returned_at')::timestamptz, now());
  v_mode public.rounding_mode := app.current_rounding();
  v_line jsonb;
  v_si public.sale_items;
  v_returned integer;
  v_qty integer;
  v_n integer := 0;
  v_si_ids uuid[] := '{}';
  v_qtys integer[] := '{}';
  v_rev bigint[] := '{}';
  v_ci bigint[] := '{}';
  v_ce bigint[] := '{}';
  v_rev_total bigint;
  v_refund bigint;
  v_rev_final bigint[];
  v_tax bigint;
  v_tax_total bigint := 0;
  v_exp_incl_total bigint := 0;
  v_exp_excl_total bigint := 0;
  v_exp jsonb;
  v_exp_incl bigint[];
  v_exp_excl bigint[];
  v_ret_id uuid := gen_random_uuid();
  v_new_si uuid;
  v_i integer;
  v_prior record;
  v_rem_qty integer;
begin
  if v_key is null then perform app.fail('VALIDATION', '冪等キーがありません'); end if;
  perform app.lock_key(v_key);
  select * into v_existing from public.sales where idempotency_key = v_key;
  if found then return jsonb_build_object('sale_id', v_existing.id, 'sale_no', v_existing.sale_no, 'duplicate', true); end if;

  select * into v_orig from public.sales where id = (p ->> 'original_sale_id')::uuid for update;
  if not found then perform app.fail('NOT_FOUND', '元の販売が見つかりません'); end if;
  if v_orig.kind <> 'sale' or v_orig.status <> 'confirmed' then perform app.fail('VALIDATION', '返品できない販売です'); end if;
  if not (app.is_manager() or v_orig.sales_staff_id = v_uid) then
    perform app.fail('FORBIDDEN', 'この販売の返品を登録する権限がありません');
  end if;
  if v_at < v_orig.sold_at then perform app.fail('VALIDATION', '返品日は販売日以降にしてください'); end if;
  perform app.assert_period_open(v_at);
  if jsonb_typeof(p -> 'lines') <> 'array' or jsonb_array_length(p -> 'lines') = 0 then
    perform app.fail('VALIDATION', '返品する商品を選択してください');
  end if;

  for v_line in select * from jsonb_array_elements(p -> 'lines') loop
    select * into v_si from public.sale_items where id = (v_line ->> 'sale_item_id')::uuid and sale_id = v_orig.id;
    if not found then perform app.fail('NOT_FOUND', '返品対象の明細が見つかりません'); end if;
    if v_si.id = any (v_si_ids) then perform app.fail('VALIDATION', '同じ明細が重複しています'); end if;
    v_qty := coalesce((v_line ->> 'quantity')::integer, v_si.quantity);
    -- 既返品分
    select coalesce(-sum(r.quantity), 0)::integer as q, coalesce(-sum(r.revenue_incl), 0)::bigint as rev,
           coalesce(-sum(r.cost_incl), 0)::bigint as ci, coalesce(-sum(r.cost_excl), 0)::bigint as ce
      into v_prior
      from public.sale_items r join public.sales s on s.id = r.sale_id
     where r.returned_from_sale_item_id = v_si.id and s.status = 'confirmed';
    v_rem_qty := v_si.quantity - v_prior.q;
    if v_qty <= 0 or v_qty > v_rem_qty then
      perform app.fail('VALIDATION', format('返品数量が不正です（返品可能数 %s）', v_rem_qty));
    end if;
    v_n := v_n + 1;
    v_si_ids := v_si_ids || v_si.id;
    v_qtys := v_qtys || v_qty;
    v_rev := v_rev || app.cost_for_quantity(v_si.revenue_incl - v_prior.rev, v_rem_qty, v_qty);
    v_ci := v_ci || app.cost_for_quantity(v_si.cost_incl - v_prior.ci, v_rem_qty, v_qty);
    v_ce := v_ce || app.cost_for_quantity(v_si.cost_excl - v_prior.ce, v_rem_qty, v_qty);
  end loop;

  select coalesce(sum(x), 0) into v_rev_total from unnest(v_rev) x;
  v_refund := coalesce((p ->> 'refund_total_incl')::bigint, v_rev_total);
  if v_refund < 0 or v_refund > v_rev_total then
    perform app.fail('VALIDATION', format('返金額は0〜%s円の範囲で入力してください', v_rev_total));
  end if;
  v_rev_final := app.allocate(v_refund, v_rev);

  if jsonb_typeof(p -> 'expenses') = 'array' then
    for v_exp in select * from jsonb_array_elements(p -> 'expenses') loop
      if coalesce((v_exp ->> 'amount_incl')::bigint, 0) <= 0 then continue; end if;
      v_tax := app.tax_from_incl((v_exp ->> 'amount_incl')::bigint, coalesce((v_exp ->> 'tax_category')::public.tax_category, 'standard_10'), v_mode);
      v_exp_incl_total := v_exp_incl_total + (v_exp ->> 'amount_incl')::bigint;
      v_exp_excl_total := v_exp_excl_total + (v_exp ->> 'amount_incl')::bigint - v_tax;
    end loop;
  end if;
  v_exp_incl := app.allocate(v_exp_incl_total, v_rev);
  v_exp_excl := app.allocate(v_exp_excl_total, v_rev);

  insert into public.sales (id, sale_no, kind, original_sale_id, channel, sold_at, sales_staff_id, entered_by, buyer_name,
    revenue_incl, revenue_excl, revenue_tax, direct_expense_incl, direct_expense_excl, expected_receipt_amount, note, idempotency_key)
  values (v_ret_id, app.next_doc_no('R', v_at), 'return', v_orig.id, v_orig.channel, v_at, v_orig.sales_staff_id, v_uid, v_orig.buyer_name,
    0, 0, 0, v_exp_incl_total, v_exp_excl_total, -v_refund, nullif(p ->> 'note', ''), v_key);

  perform 1 from public.purchase_items where id in (select item_id from public.sale_items where id = any (v_si_ids)) order by id for update;
  for v_i in 1..v_n loop
    select * into v_si from public.sale_items where id = v_si_ids[v_i];
    v_tax := app.tax_from_incl(v_rev_final[v_i], v_si.tax_category, v_mode);
    v_tax_total := v_tax_total + v_tax;
    insert into public.sale_items (sale_id, line_no, item_id, returned_from_sale_item_id, quantity, tax_category,
      revenue_incl, revenue_excl, revenue_tax, cost_incl, cost_excl, direct_expense_incl, direct_expense_excl,
      purchaser_staff_id, category_id)
    values (v_ret_id, v_i, v_si.item_id, v_si.id, -v_qtys[v_i], v_si.tax_category,
      -v_rev_final[v_i], -(v_rev_final[v_i] - v_tax), -v_tax, -v_ci[v_i], -v_ce[v_i], v_exp_incl[v_i], v_exp_excl[v_i],
      v_si.purchaser_staff_id, v_si.category_id)
    returning id into v_new_si;
    insert into public.inventory_movements (item_id, movement_type, quantity_delta, cost_incl_delta, cost_excl_delta,
      sale_item_id, occurred_at, created_by)
    values (v_si.item_id, 'return_in', v_qtys[v_i], v_ci[v_i], v_ce[v_i], v_new_si, v_at, v_uid);
    perform app.refresh_item_status(v_si.item_id);
  end loop;

  if jsonb_typeof(p -> 'expenses') = 'array' then
    insert into public.sale_expenses (sale_id, expense_type, tax_category, amount_incl, amount_excl, amount_tax, note)
    select v_ret_id, (e ->> 'expense_type')::public.sale_expense_type,
           coalesce((e ->> 'tax_category')::public.tax_category, 'standard_10'),
           (e ->> 'amount_incl')::bigint,
           (e ->> 'amount_incl')::bigint - app.tax_from_incl((e ->> 'amount_incl')::bigint, coalesce((e ->> 'tax_category')::public.tax_category, 'standard_10'), v_mode),
           app.tax_from_incl((e ->> 'amount_incl')::bigint, coalesce((e ->> 'tax_category')::public.tax_category, 'standard_10'), v_mode),
           nullif(e ->> 'note', '')
    from jsonb_array_elements(p -> 'expenses') e
    where coalesce((e ->> 'amount_incl')::bigint, 0) > 0;
  end if;

  update public.sales set revenue_incl = -v_refund, revenue_excl = -(v_refund - v_tax_total), revenue_tax = -v_tax_total
   where id = v_ret_id;
  perform app.refresh_payment_status(v_ret_id);
  return jsonb_build_object('sale_id', v_ret_id, 'sale_no', (select sale_no from public.sales where id = v_ret_id),
    'refund_incl', v_refund, 'duplicate', false);
end $$;

-- =============================================================================
-- 資金操作
-- =============================================================================
-- 2口座間の移動（同一 transfer_group で貸借ゼロ）
create or replace function app.fund_move(p_from uuid, p_to uuid, p_amount bigint, p_type public.fund_tx_type,
  p_key uuid, p_memo text, p_actor uuid, p_approval uuid, p_at timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_group uuid := gen_random_uuid();
  v_from public.fund_accounts;
  v_balance bigint;
begin
  if p_amount is null or p_amount <= 0 then perform app.fail('VALIDATION', '金額は1円以上で入力してください'); end if;
  if p_from = p_to then perform app.fail('VALIDATION', '同じ口座間では移動できません'); end if;
  perform app.assert_period_open(p_at);
  -- 口座IDの順にロック（デッドロック回避）
  perform app.lock_account(least(p_from, p_to));
  perform app.lock_account(greatest(p_from, p_to));
  select * into v_from from public.fund_accounts where id = p_from;
  if v_from.kind = 'staff_reserve' then
    v_balance := app.fund_balance(p_from);
    if v_balance < p_amount then
      perform app.fail('INSUFFICIENT_FUNDS', format('移動元の残高が不足しています（残高 %s円 / 移動額 %s円）', v_balance, p_amount));
    end if;
  end if;
  insert into public.fund_transactions (account_id, tx_type, amount, occurred_at, transfer_group_id, approval_request_id, idempotency_key, memo, created_by)
  values (p_from, p_type, -p_amount, p_at, v_group, p_approval, p_key, p_memo, p_actor),
         (p_to, p_type, p_amount, p_at, v_group, p_approval, p_key, p_memo, p_actor);
  return v_group;
end $$;

-- p: { "idempotency_key", "type": "opening"|"replenish"|"return_to_company"|"transfer",
--      "account_id" (対象の準備金口座), "counterpart_account_id" (会社口座 or 移動先準備金), "amount", "memo", "occurred_at" }
create or replace function public.fund_operation(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_user();
  v_key uuid := (p ->> 'idempotency_key')::uuid;
  v_type text := p ->> 'type';
  v_account uuid := (p ->> 'account_id')::uuid;
  v_counter uuid := (p ->> 'counterpart_account_id')::uuid;
  v_amount bigint := (p ->> 'amount')::bigint;
  v_at timestamptz := coalesce((p ->> 'occurred_at')::timestamptz, now());
  v_acc public.fund_accounts;
  v_group uuid;
  v_id uuid;
begin
  if v_key is null then perform app.fail('VALIDATION', '冪等キーがありません'); end if;
  perform app.lock_key(v_key);
  if exists (select 1 from public.fund_transactions where idempotency_key = v_key) then
    return jsonb_build_object('duplicate', true);
  end if;
  if not app.can_approve_funds() then
    perform app.fail('FORBIDDEN', '資金操作の権限がありません。承認申請を作成してください');
  end if;
  select * into v_acc from public.fund_accounts where id = v_account;
  if not found then perform app.fail('NOT_FOUND', '資金口座が見つかりません'); end if;

  if v_type = 'opening' then
    if v_amount is null or v_amount <= 0 then perform app.fail('VALIDATION', '金額は1円以上で入力してください'); end if;
    if exists (select 1 from public.fund_transactions where account_id = v_account) then
      perform app.fail('VALIDATION', '初期残高は取引のない口座にのみ登録できます');
    end if;
    perform app.assert_period_open(v_at);
    perform app.lock_account(v_account);
    insert into public.fund_transactions (account_id, tx_type, amount, occurred_at, idempotency_key, memo, created_by)
    values (v_account, 'opening', v_amount, v_at, v_key, coalesce(nullif(p ->> 'memo', ''), '初期残高'), v_uid)
    returning id into v_id;
    return jsonb_build_object('transaction_id', v_id, 'duplicate', false);
  elsif v_type = 'replenish' then
    v_counter := coalesce(v_counter, app.company_account('company_cash'));
    if (select kind from public.fund_accounts where id = v_counter) = 'staff_reserve' or v_acc.kind <> 'staff_reserve' then
      perform app.fail('VALIDATION', '補充は会社口座から従業員準備金へ行ってください');
    end if;
    v_group := app.fund_move(v_counter, v_account, v_amount, 'replenish', v_key, coalesce(nullif(p ->> 'memo', ''), '資金補充'), v_uid, null, v_at);
  elsif v_type = 'return_to_company' then
    v_counter := coalesce(v_counter, app.company_account('company_cash'));
    if (select kind from public.fund_accounts where id = v_counter) = 'staff_reserve' or v_acc.kind <> 'staff_reserve' then
      perform app.fail('VALIDATION', '返却は従業員準備金から会社口座へ行ってください');
    end if;
    v_group := app.fund_move(v_account, v_counter, v_amount, 'return_to_company', v_key, coalesce(nullif(p ->> 'memo', ''), '資金返却'), v_uid, null, v_at);
  elsif v_type = 'transfer' then
    if v_acc.kind <> 'staff_reserve' or (select kind from public.fund_accounts where id = v_counter) is distinct from 'staff_reserve' then
      perform app.fail('VALIDATION', '従業員間移動は準備金口座同士で行ってください');
    end if;
    v_group := app.fund_move(v_account, v_counter, v_amount, 'transfer', v_key, coalesce(nullif(p ->> 'memo', ''), '従業員間移動'), v_uid, null, v_at);
  else
    perform app.fail('VALIDATION', '操作種別が不正です');
  end if;
  return jsonb_build_object('transfer_group_id', v_group, 'duplicate', false);
end $$;

-- 現金照合（差異は自動仕訳せず、必要に応じて調整申請を作成）
create or replace function public.record_reconciliation(p_account_id uuid, p_counted_amount bigint, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_user();
  v_acc public.fund_accounts;
  v_balance bigint;
  v_id uuid;
begin
  select * into v_acc from app.lock_account(p_account_id);
  if not (app.is_manager() or v_acc.owner_profile_id = v_uid) then
    perform app.fail('FORBIDDEN', 'この口座を照合する権限がありません');
  end if;
  if p_counted_amount is null or p_counted_amount < 0 then perform app.fail('VALIDATION', '実査額は0円以上で入力してください'); end if;
  v_balance := app.fund_balance(p_account_id);
  insert into public.fund_reconciliations (account_id, counted_at, counted_amount, ledger_balance, note, counted_by)
  values (p_account_id, now(), p_counted_amount, v_balance, nullif(p_note, ''), v_uid)
  returning id into v_id;
  return jsonb_build_object('reconciliation_id', v_id, 'ledger_balance', v_balance, 'difference', p_counted_amount - v_balance);
end $$;

-- =============================================================================
-- 承認フロー
-- =============================================================================
-- p: { "idempotency_key", "request_type", "target_id", "payload": {...}, "reason" }
create or replace function public.create_approval_request(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_user();
  v_key uuid := (p ->> 'idempotency_key')::uuid;
  v_type public.approval_type := (p ->> 'request_type')::public.approval_type;
  v_target uuid := (p ->> 'target_id')::uuid;
  v_payload jsonb := coalesce(p -> 'payload', '{}'::jsonb);
  v_id uuid;
begin
  if v_key is null then perform app.fail('VALIDATION', '冪等キーがありません'); end if;
  perform app.lock_key(v_key);
  select id into v_id from public.approval_requests where idempotency_key = v_key;
  if found then return jsonb_build_object('request_id', v_id, 'duplicate', true); end if;
  if coalesce(trim(p ->> 'reason'), '') = '' then perform app.fail('VALIDATION', '申請理由を入力してください'); end if;

  -- 申請者が対象にアクセスできることを確認
  if v_type = 'purchase_void' then
    if not exists (select 1 from public.purchase_transactions where id = v_target and (staff_id = v_uid or entered_by = v_uid or app.is_manager())) then
      perform app.fail('FORBIDDEN', '対象の買取取引にアクセスできません');
    end if;
  elsif v_type = 'sale_cancel' then
    if not exists (select 1 from public.sales where id = v_target and (sales_staff_id = v_uid or entered_by = v_uid or app.is_manager())) then
      perform app.fail('FORBIDDEN', '対象の販売にアクセスできません');
    end if;
  elsif v_type in ('fund_adjustment', 'fund_replenish', 'fund_transfer') then
    if (v_payload ->> 'amount')::bigint is null or (v_payload ->> 'amount')::bigint = 0 then
      perform app.fail('VALIDATION', '金額を入力してください');
    end if;
    if v_type <> 'fund_adjustment' and (v_payload ->> 'amount')::bigint < 0 then
      perform app.fail('VALIDATION', '金額は1円以上で入力してください');
    end if;
    -- 従業員は自分の準備金口座についてのみ申請可能
    v_target := coalesce(v_target, app.staff_reserve_account(v_uid));
    if not (app.is_manager() or v_target = app.staff_reserve_account(v_uid)) then
      perform app.fail('FORBIDDEN', '自分の準備金口座についてのみ申請できます');
    end if;
    if v_type = 'fund_transfer' then
      -- 従業員は他人の口座IDを参照できないため、移動先は従業員IDでも指定可能
      if v_payload ->> 'to_account_id' is null and v_payload ->> 'to_profile_id' is not null then
        v_payload := v_payload || jsonb_build_object('to_account_id', app.staff_reserve_account((v_payload ->> 'to_profile_id')::uuid));
      end if;
      if (v_payload ->> 'to_account_id')::uuid = v_target then
        perform app.fail('VALIDATION', '同じ口座間では移動できません');
      end if;
      if (select kind from public.fund_accounts where id = (v_payload ->> 'to_account_id')::uuid) is distinct from 'staff_reserve' then
        perform app.fail('VALIDATION', '移動先の準備金口座を指定してください');
      end if;
    end if;
  end if;

  insert into public.approval_requests (request_type, requested_by, target_id, payload, reason, idempotency_key)
  values (v_type, v_uid, v_target, v_payload, trim(p ->> 'reason'), v_key)
  returning id into v_id;
  return jsonb_build_object('request_id', v_id, 'duplicate', false);
end $$;

create or replace function public.decide_approval_request(p_request_id uuid, p_approve boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_manager();
  v_req public.approval_requests;
  v_result jsonb;
  v_amount bigint;
  v_counter uuid;
begin
  select * into v_req from public.approval_requests where id = p_request_id for update;
  if not found then perform app.fail('NOT_FOUND', '申請が見つかりません'); end if;
  if v_req.status <> 'pending' then
    return jsonb_build_object('request_id', v_req.id, 'status', v_req.status, 'duplicate', true);
  end if;
  if v_req.requested_by = v_uid then perform app.fail('FORBIDDEN', '自分の申請は承認できません'); end if;
  if v_req.request_type in ('fund_adjustment', 'fund_replenish', 'fund_transfer') and not app.can_approve_funds() then
    perform app.fail('FORBIDDEN', '資金の承認権限がありません');
  end if;

  if not p_approve then
    update public.approval_requests set status = 'rejected', decided_by = v_uid, decided_at = now(), decision_note = p_note
     where id = v_req.id;
    return jsonb_build_object('request_id', v_req.id, 'status', 'rejected', 'duplicate', false);
  end if;

  v_amount := (v_req.payload ->> 'amount')::bigint;
  case v_req.request_type
    when 'purchase_void' then
      v_result := app.void_purchase_internal(v_req.target_id, v_req.reason, v_uid, v_req.id);
    when 'sale_cancel' then
      v_result := app.cancel_sale_internal(v_req.target_id, v_req.reason, v_uid);
    when 'fund_replenish' then
      v_counter := coalesce((v_req.payload ->> 'from_account_id')::uuid, app.company_account('company_cash'));
      v_result := jsonb_build_object('transfer_group_id',
        app.fund_move(v_counter, v_req.target_id, v_amount, 'replenish', v_req.id, '資金補充（承認）', v_uid, v_req.id, now()));
    when 'fund_transfer' then
      v_result := jsonb_build_object('transfer_group_id',
        app.fund_move(v_req.target_id, (v_req.payload ->> 'to_account_id')::uuid, v_amount, 'transfer', v_req.id,
                      '従業員間移動（承認）', v_uid, v_req.id, now()));
    when 'fund_adjustment' then
      perform app.assert_period_open(now());
      perform app.lock_account(v_req.target_id);
      insert into public.fund_transactions (account_id, tx_type, amount, occurred_at, approval_request_id, idempotency_key, memo, created_by)
      values (v_req.target_id, 'approved_adjustment', v_amount, now(), v_req.id, v_req.id,
              left('調整（承認）: ' || v_req.reason, 500), v_uid);
      v_result := jsonb_build_object('amount', v_amount);
      update public.fund_reconciliations set adjustment_request_id = v_req.id
       where id = (v_req.payload ->> 'reconciliation_id')::uuid and adjustment_request_id is null;
  end case;

  update public.approval_requests
     set status = 'approved', decided_by = v_uid, decided_at = now(), decision_note = p_note, result = v_result
   where id = v_req.id;
  return jsonb_build_object('request_id', v_req.id, 'status', 'approved', 'result', v_result, 'duplicate', false);
end $$;

create or replace function public.withdraw_approval_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_user();
begin
  update public.approval_requests set status = 'withdrawn'
   where id = p_request_id and requested_by = v_uid and status = 'pending';
  if not found then perform app.fail('NOT_FOUND', '取り下げ可能な申請が見つかりません'); end if;
end $$;

-- =============================================================================
-- 会計期間（締め・解除は代表のみ）
-- =============================================================================
create or replace function public.close_period(p_month date, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_owner();
begin
  if extract(day from p_month) <> 1 then perform app.fail('VALIDATION', '月初日を指定してください'); end if;
  insert into public.accounting_periods (period_month, status, closed_at, closed_by, note)
  values (p_month, 'closed', now(), v_uid, p_note)
  on conflict (period_month) do update set status = 'closed', closed_at = now(), closed_by = v_uid, note = coalesce(p_note, public.accounting_periods.note);
end $$;

create or replace function public.reopen_period(p_month date, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_owner();
begin
  if coalesce(trim(p_note), '') = '' then perform app.fail('VALIDATION', '締め解除の理由を入力してください'); end if;
  update public.accounting_periods set status = 'open', closed_at = null, reopened_at = now(), reopened_by = v_uid, note = p_note
   where period_month = p_month and status = 'closed';
  if not found then perform app.fail('NOT_FOUND', '締め済みの期間が見つかりません'); end if;
end $$;

-- =============================================================================
-- 従業員・設定管理
-- =============================================================================
create or replace function public.set_user_role(p_user_id uuid, p_role public.user_role)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_owner();
begin
  if p_user_id = v_uid and p_role <> 'owner'
     and (select count(*) from public.profiles where role = 'owner' and is_active) <= 1 then
    perform app.fail('LAST_OWNER', '最後の代表の権限は変更できません');
  end if;
  update public.profiles set role = p_role where id = p_user_id;
  if not found then perform app.fail('NOT_FOUND', '従業員が見つかりません'); end if;
end $$;

create or replace function public.set_user_active(p_user_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_owner();
begin
  if p_user_id = v_uid and not p_active then perform app.fail('VALIDATION', '自分自身は無効化できません'); end if;
  update public.profiles set is_active = p_active where id = p_user_id;
  if not found then perform app.fail('NOT_FOUND', '従業員が見つかりません'); end if;
  update public.fund_accounts set is_active = p_active where owner_profile_id = p_user_id;
end $$;

create or replace function public.update_display_name(p_user_id uuid, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_user();
begin
  if p_user_id <> v_uid and not app.is_owner() then perform app.fail('FORBIDDEN', '権限がありません'); end if;
  update public.profiles set display_name = trim(p_name) where id = p_user_id;
end $$;

create or replace function public.update_settings(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_owner();
begin
  update public.app_settings set
    tax_basis = coalesce((p ->> 'tax_basis')::public.tax_basis, tax_basis),
    tax_rounding = coalesce((p ->> 'tax_rounding')::public.rounding_mode, tax_rounding),
    staff_can_view_other_inventory = coalesce((p ->> 'staff_can_view_other_inventory')::boolean, staff_can_view_other_inventory),
    admin_can_approve_funds = coalesce((p ->> 'admin_can_approve_funds')::boolean, admin_can_approve_funds),
    identity_retention_years = coalesce((p ->> 'identity_retention_years')::integer, identity_retention_years),
    long_stay_days = coalesce((p ->> 'long_stay_days')::integer, long_stay_days),
    updated_at = now(), updated_by = v_uid;
end $$;

-- =============================================================================
-- 顧客・本人確認情報
-- =============================================================================
-- 電話番号の完全一致で既存顧客を検索（従業員でも他人の顧客を再利用できるよう最小限の情報のみ返す）
create or replace function public.find_customers_by_phone(p_phone text)
returns table (id uuid, name text, name_kana text)
language plpgsql stable security definer set search_path = '' as $$
declare v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9+\-]', '', 'g');
begin
  perform app.require_user();
  if length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 10 then return; end if;
  return query
    select c.id, c.name, c.name_kana
    from public.customers c where c.phone = v_phone order by c.created_at desc limit 5;
end $$;

-- 暗号化された本人確認記録の取得（閲覧のたびに監査ログを記録）
create or replace function public.get_identity_record(p_record_id uuid, p_purpose text)
returns table (id uuid, customer_id uuid, verification_method text, encrypted_payload text, key_version integer,
               verified_at timestamptz, retain_until date)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_user();
  v_rec public.customer_identity_records;
begin
  select * into v_rec from public.customer_identity_records r where r.id = p_record_id and r.disposed_at is null;
  if not found then perform app.fail('NOT_FOUND', '本人確認記録が見つかりません'); end if;
  if not (app.is_manager()
          or exists (select 1 from public.purchase_transactions t where t.id = v_rec.purchase_transaction_id and t.staff_id = v_uid)) then
    -- 拒否も監査ログに残すため例外ではなく空の結果を返す（例外だと記録がロールバックされる）
    perform app.audit('identity_access_denied', 'customer_identity_records', p_record_id::text, null, null,
                      jsonb_build_object('purpose', p_purpose));
    return;
  end if;
  if coalesce(trim(p_purpose), '') = '' then perform app.fail('VALIDATION', '閲覧目的を入力してください'); end if;
  perform app.audit('identity_view', 'customer_identity_records', p_record_id::text, null, null,
                    jsonb_build_object('purpose', p_purpose));
  return query select v_rec.id, v_rec.customer_id, v_rec.verification_method, v_rec.encrypted_payload, v_rec.key_version,
                      v_rec.verified_at, v_rec.retain_until;
end $$;


-- ===== 20261113000400_reports.sql =====
-- =============================================================================
-- 参照・集計関数
--   - 集計の税基準は app_settings.tax_basis に一元化（混在させない）
--   - 個人実績は sale_items.purchaser_staff_id（買取担当）に帰属
--   - 従業員は自分の範囲のみ。代表・管理者は全社または任意の従業員
-- =============================================================================

-- 集計対象の従業員を決定（従業員は常に自分。他人を指定すると拒否）
create or replace function app.report_scope(p_staff uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := app.require_user();
begin
  if app.is_manager() then return p_staff; end if;
  if p_staff is not null and p_staff <> v_uid then
    perform app.fail('FORBIDDEN', '他の従業員の実績は閲覧できません');
  end if;
  return v_uid;
end $$;

create or replace function app.tax_basis()
returns public.tax_basis language sql stable security definer set search_path = '' as $$
  select tax_basis from public.app_settings
$$;

-- -----------------------------------------------------------------------------
-- 期間サマリー
-- -----------------------------------------------------------------------------
create or replace function public.report_summary(p_from timestamptz, p_to timestamptz, p_staff uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_staff uuid := app.report_scope(p_staff);
  v_incl boolean := app.tax_basis() = 'incl';
  v_sales record;
  v_purch record;
  v_inv record;
  v_fund bigint;
  v_recv bigint;
begin
  select
    coalesce(sum(case when v_incl then si.revenue_incl else si.revenue_excl end), 0)::bigint as revenue,
    coalesce(sum(case when v_incl then si.cost_incl else si.cost_excl end), 0)::bigint as cost,
    coalesce(sum(case when v_incl then si.direct_expense_incl else si.direct_expense_excl end), 0)::bigint as direct,
    count(distinct s.id) filter (where s.kind = 'sale')::integer as sales_count,
    count(distinct s.id) filter (where s.kind = 'return')::integer as return_count,
    coalesce(sum(si.quantity), 0)::integer as quantity
  into v_sales
  from public.sale_items si join public.sales s on s.id = si.sale_id
  where s.status = 'confirmed' and s.sold_at >= p_from and s.sold_at < p_to
    and (v_staff is null or si.purchaser_staff_id = v_staff);

  select count(*)::integer as cnt,
         coalesce(sum(case when v_incl then total_incl else total_excl end), 0)::bigint as amount,
         coalesce(sum(total_incl), 0)::bigint as cash_out
  into v_purch
  from public.purchase_transactions
  where status = 'active' and purchased_at >= p_from and purchased_at < p_to
    and (v_staff is null or staff_id = v_staff);

  select coalesce(sum(m.quantity_delta), 0)::integer as qty,
         coalesce(sum(case when v_incl then m.cost_incl_delta else m.cost_excl_delta end), 0)::bigint as cost
  into v_inv
  from public.inventory_movements m join public.purchase_items i on i.id = m.item_id
  where m.occurred_at < p_to and (v_staff is null or i.staff_id = v_staff);

  select coalesce(sum(t.amount), 0)::bigint into v_fund
  from public.fund_transactions t join public.fund_accounts a on a.id = t.account_id
  where a.kind = 'staff_reserve' and (v_staff is null or a.owner_profile_id = v_staff);

  select coalesce(sum(s.expected_receipt_amount - coalesce(
           (select sum(case pr.kind when 'receipt' then pr.amount else -pr.amount end) from public.payment_records pr where pr.sale_id = s.id), 0)), 0)::bigint
  into v_recv
  from public.sales s
  where s.status = 'confirmed' and s.payment_status <> 'paid' and s.kind = 'sale'
    and (v_staff is null or s.sales_staff_id = v_staff);

  return jsonb_build_object(
    'tax_basis', case when v_incl then 'incl' else 'excl' end,
    'staff_id', v_staff,
    'revenue', v_sales.revenue,
    'cost_of_sales', v_sales.cost,
    'gross_profit', v_sales.revenue - v_sales.cost,
    'direct_expense', v_sales.direct,
    'general_expense', 0,           -- Phase 2（一般経費の配賦）で実装
    'net_profit', v_sales.revenue - v_sales.cost - v_sales.direct,
    'sales_count', v_sales.sales_count,
    'return_count', v_sales.return_count,
    'quantity_sold', v_sales.quantity,
    'purchase_count', v_purch.cnt,
    'purchase_amount', v_purch.amount,
    'purchase_cash_out', v_purch.cash_out,
    'inventory_quantity', v_inv.qty,
    'inventory_cost', v_inv.cost,
    'reserve_balance', v_fund,
    'receivables', v_recv
  );
end $$;

-- -----------------------------------------------------------------------------
-- 時系列（実績のない期間も0で返す）。p_from/p_to は JST の日付（両端含む）
-- -----------------------------------------------------------------------------
create or replace function public.report_timeseries(p_from date, p_to date, p_grain text default 'day', p_staff uuid default null)
returns table (bucket date, revenue bigint, cost_of_sales bigint, gross_profit bigint, direct_expense bigint,
               net_profit bigint, sales_count integer, purchase_count integer, purchase_amount bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_staff uuid := app.report_scope(p_staff);
  v_incl boolean := app.tax_basis() = 'incl';
  v_step interval;
begin
  if p_grain not in ('day', 'week', 'month', 'year') then perform app.fail('VALIDATION', '集計単位が不正です'); end if;
  if p_to < p_from then perform app.fail('VALIDATION', '期間が不正です'); end if;
  if p_to - p_from > 3700 then perform app.fail('VALIDATION', '期間が長すぎます'); end if;
  v_step := ('1 ' || p_grain)::interval;
  return query
  with buckets as (
    select gs::date as b
    from generate_series(date_trunc(p_grain, p_from::timestamp), date_trunc(p_grain, p_to::timestamp), v_step) gs
  ),
  s as (
    select date_trunc(p_grain, sa.sold_at at time zone 'Asia/Tokyo')::date as b,
           sum(case when v_incl then si.revenue_incl else si.revenue_excl end) as rev,
           sum(case when v_incl then si.cost_incl else si.cost_excl end) as cost,
           sum(case when v_incl then si.direct_expense_incl else si.direct_expense_excl end) as direct,
           count(distinct sa.id) filter (where sa.kind = 'sale') as cnt
    from public.sale_items si join public.sales sa on sa.id = si.sale_id
    where sa.status = 'confirmed'
      and (sa.sold_at at time zone 'Asia/Tokyo')::date between p_from and p_to
      and (v_staff is null or si.purchaser_staff_id = v_staff)
    group by 1
  ),
  pu as (
    select date_trunc(p_grain, pt.purchased_at at time zone 'Asia/Tokyo')::date as b,
           count(*) as cnt, sum(case when v_incl then pt.total_incl else pt.total_excl end) as amt
    from public.purchase_transactions pt
    where pt.status = 'active'
      and (pt.purchased_at at time zone 'Asia/Tokyo')::date between p_from and p_to
      and (v_staff is null or pt.staff_id = v_staff)
    group by 1
  )
  select bk.b,
         coalesce(s.rev, 0)::bigint, coalesce(s.cost, 0)::bigint, coalesce(s.rev - s.cost, 0)::bigint,
         coalesce(s.direct, 0)::bigint, coalesce(s.rev - s.cost - s.direct, 0)::bigint,
         coalesce(s.cnt, 0)::integer, coalesce(pu.cnt, 0)::integer, coalesce(pu.amt, 0)::bigint
  from buckets bk left join s on s.b = bk.b left join pu on pu.b = bk.b
  order by bk.b;
end $$;

-- -----------------------------------------------------------------------------
-- 従業員別ランキング（代表・管理者）
-- -----------------------------------------------------------------------------
create or replace function public.report_staff_ranking(p_from timestamptz, p_to timestamptz)
returns table (staff_id uuid, display_name text, revenue bigint, cost_of_sales bigint, gross_profit bigint,
               direct_expense bigint, net_profit bigint, sales_count integer, purchase_count integer, purchase_amount bigint,
               sold_by_staff_revenue bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_incl boolean;
begin
  perform app.require_manager();
  v_incl := app.tax_basis() = 'incl';
  return query
  with s as (
    select si.purchaser_staff_id as sid,
           sum(case when v_incl then si.revenue_incl else si.revenue_excl end) as rev,
           sum(case when v_incl then si.cost_incl else si.cost_excl end) as cost,
           sum(case when v_incl then si.direct_expense_incl else si.direct_expense_excl end) as direct,
           count(distinct sa.id) filter (where sa.kind = 'sale') as cnt
    from public.sale_items si join public.sales sa on sa.id = si.sale_id
    where sa.status = 'confirmed' and sa.sold_at >= p_from and sa.sold_at < p_to
    group by 1
  ),
  sb as (
    select sa.sales_staff_id as sid, sum(case when v_incl then sa.revenue_incl else sa.revenue_excl end) as rev
    from public.sales sa where sa.status = 'confirmed' and sa.sold_at >= p_from and sa.sold_at < p_to
    group by 1
  ),
  pu as (
    select pt.staff_id as sid, count(*) as cnt, sum(case when v_incl then pt.total_incl else pt.total_excl end) as amt
    from public.purchase_transactions pt
    where pt.status = 'active' and pt.purchased_at >= p_from and pt.purchased_at < p_to
    group by 1
  )
  select pr.id, pr.display_name,
         coalesce(s.rev, 0)::bigint, coalesce(s.cost, 0)::bigint, coalesce(s.rev - s.cost, 0)::bigint,
         coalesce(s.direct, 0)::bigint, coalesce(s.rev - s.cost - s.direct, 0)::bigint,
         coalesce(s.cnt, 0)::integer, coalesce(pu.cnt, 0)::integer, coalesce(pu.amt, 0)::bigint, coalesce(sb.rev, 0)::bigint
  from public.profiles pr
  left join s on s.sid = pr.id left join pu on pu.sid = pr.id left join sb on sb.sid = pr.id
  where pr.is_active or s.sid is not null or pu.sid is not null
  order by coalesce(s.rev - s.cost - s.direct, 0) desc, pr.display_name;
end $$;

-- -----------------------------------------------------------------------------
-- 販売経路別・カテゴリー別
-- -----------------------------------------------------------------------------
create or replace function public.report_breakdown(p_from timestamptz, p_to timestamptz, p_dimension text, p_staff uuid default null)
returns table (key text, label text, revenue bigint, cost_of_sales bigint, gross_profit bigint, direct_expense bigint,
               net_profit bigint, quantity integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_staff uuid := app.report_scope(p_staff);
  v_incl boolean := app.tax_basis() = 'incl';
begin
  if p_dimension not in ('channel', 'category') then perform app.fail('VALIDATION', '集計軸が不正です'); end if;
  return query
  select case when p_dimension = 'channel' then sa.channel::text else si.category_id::text end,
         case when p_dimension = 'channel' then max(sa.channel::text) else max(c.name) end,
         sum(case when v_incl then si.revenue_incl else si.revenue_excl end)::bigint,
         sum(case when v_incl then si.cost_incl else si.cost_excl end)::bigint,
         sum(case when v_incl then si.revenue_incl - si.cost_incl else si.revenue_excl - si.cost_excl end)::bigint,
         sum(case when v_incl then si.direct_expense_incl else si.direct_expense_excl end)::bigint,
         sum(case when v_incl then si.revenue_incl - si.cost_incl - si.direct_expense_incl
                  else si.revenue_excl - si.cost_excl - si.direct_expense_excl end)::bigint,
         sum(si.quantity)::integer
  from public.sale_items si
  join public.sales sa on sa.id = si.sale_id
  join public.item_categories c on c.id = si.category_id
  where sa.status = 'confirmed' and sa.sold_at >= p_from and sa.sold_at < p_to
    and (v_staff is null or si.purchaser_staff_id = v_staff)
  group by 1
  order by 7 desc;
end $$;

-- -----------------------------------------------------------------------------
-- 資金残高一覧
-- -----------------------------------------------------------------------------
create or replace function public.fund_balances()
returns table (account_id uuid, kind public.fund_account_kind, name text, owner_profile_id uuid, owner_name text,
               is_active boolean, balance bigint, last_tx_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := app.require_user();
begin
  return query
  select a.id, a.kind, a.name, a.owner_profile_id, p.display_name, a.is_active,
         coalesce(sum(t.amount), 0)::bigint, max(t.occurred_at)
  from public.fund_accounts a
  left join public.profiles p on p.id = a.owner_profile_id
  left join public.fund_transactions t on t.account_id = a.id
  where app.is_manager() or a.owner_profile_id = v_uid
  group by a.id, p.display_name
  order by (a.kind <> 'staff_reserve'), p.display_name nulls last, a.name;
end $$;

-- -----------------------------------------------------------------------------
-- 商品検索（他人の商品は原価・顧客を返さない）
-- -----------------------------------------------------------------------------
create or replace function public.search_items(
  p_q text default null, p_category uuid default null, p_status text default 'in_stock',
  p_scope text default 'all', p_staff uuid default null, p_limit integer default 50, p_offset integer default 0)
returns table (id uuid, item_no text, name text, brand text, model_no text, condition public.item_condition,
               category_id uuid, category_name text, status public.item_status, staff_id uuid, staff_name text,
               purchased_at timestamptz, storage_location text, quantity integer, stock_quantity integer,
               stock_cost bigint, is_mine boolean, can_see_cost boolean, photo_path text, total_count bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_user();
  v_mgr boolean := app.is_manager();
  v_others boolean := (select staff_can_view_other_inventory from public.app_settings);
  v_incl boolean := app.tax_basis() = 'incl';
  v_q text := nullif(trim(p_q), '');
begin
  return query
  select i.id, i.item_no, i.name, i.brand, i.model_no, i.condition, i.category_id, c.name, i.status, i.staff_id,
         pr.display_name, i.purchased_at, i.storage_location, i.quantity,
         st.qty::integer,
         case when v_mgr or i.staff_id = v_uid then st.cost::bigint end,
         i.staff_id = v_uid, v_mgr or i.staff_id = v_uid,
         (select ph.storage_path from public.item_photos ph where ph.item_id = i.id and ph.deleted_at is null
           order by ph.sort_order, ph.created_at limit 1),
         count(*) over ()
  from public.purchase_items i
  join public.item_categories c on c.id = i.category_id
  join public.profiles pr on pr.id = i.staff_id
  cross join lateral (
    select coalesce(sum(m.quantity_delta), 0) as qty,
           coalesce(sum(case when v_incl then m.cost_incl_delta else m.cost_excl_delta end), 0) as cost
    from public.inventory_movements m where m.item_id = i.id
  ) st
  where (
      v_mgr or i.staff_id = v_uid
      or (v_others and i.status in ('in_stock', 'partially_sold'))
    )
    and (p_scope <> 'mine' or i.staff_id = v_uid)
    and (p_staff is null or i.staff_id = p_staff)
    and (p_category is null or i.category_id = p_category)
    and (p_status is null or p_status = 'all'
         or (p_status = 'in_stock' and i.status in ('in_stock', 'partially_sold'))
         or (p_status <> 'in_stock' and i.status::text = p_status))
    and (v_q is null or i.item_no ilike '%' || v_q || '%' or i.name ilike '%' || v_q || '%'
         or i.brand ilike '%' || v_q || '%' or i.model_no ilike '%' || v_q || '%' or i.serial_no ilike '%' || v_q || '%')
  order by i.purchased_at desc, i.item_no desc
  limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end $$;

-- 商品詳細（権限に応じて原価・履歴をマスク）
create or replace function public.get_item(p_item_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_user();
  v_item public.purchase_items;
  v_priv boolean;
  v_stock record;
begin
  select * into v_item from public.purchase_items where id = p_item_id;
  if not found or not app.can_view_item(p_item_id) then
    perform app.fail('NOT_FOUND', '商品が見つからないか、閲覧権限がありません');
  end if;
  v_priv := app.is_manager() or v_item.staff_id = v_uid;
  select * into v_stock from app.item_stock(p_item_id);
  return jsonb_build_object(
    'id', v_item.id, 'item_no', v_item.item_no, 'name', v_item.name, 'brand', v_item.brand, 'model_no', v_item.model_no,
    'serial_no', case when v_priv then v_item.serial_no end,
    'condition', v_item.condition, 'category_id', v_item.category_id,
    'category_name', (select name from public.item_categories where id = v_item.category_id),
    'status', v_item.status, 'quantity', v_item.quantity, 'stock_quantity', v_stock.qty,
    'staff_id', v_item.staff_id, 'staff_name', (select display_name from public.profiles where id = v_item.staff_id),
    'purchased_at', v_item.purchased_at, 'storage_location', v_item.storage_location,
    'note', case when v_priv then v_item.note end,
    'tax_category', v_item.tax_category,
    'parent_item_id', v_item.parent_item_id,
    'parent_item_no', (select item_no from public.purchase_items where id = v_item.parent_item_id),
    'purchase_transaction_id', case when v_priv then v_item.purchase_transaction_id end,
    'purchase_no', case when v_priv then (select purchase_no from public.purchase_transactions where id = v_item.purchase_transaction_id) end,
    'can_see_cost', v_priv,
    'can_edit', app.can_edit_item(p_item_id),
    'cost_incl', case when v_priv then v_item.cost_incl end,
    'cost_excl', case when v_priv then v_item.cost_excl end,
    'stock_cost_incl', case when v_priv then v_stock.cost_incl end,
    'stock_cost_excl', case when v_priv then v_stock.cost_excl end,
    'photos', (select coalesce(jsonb_agg(jsonb_build_object('id', ph.id, 'path', ph.storage_path) order by ph.sort_order, ph.created_at), '[]')
               from public.item_photos ph where ph.item_id = p_item_id and ph.deleted_at is null),
    'children', (select coalesce(jsonb_agg(jsonb_build_object('id', ch.id, 'item_no', ch.item_no, 'name', ch.name, 'status', ch.status)), '[]')
                 from public.purchase_items ch where ch.parent_item_id = p_item_id),
    'movements', case when v_priv then (
      select coalesce(jsonb_agg(jsonb_build_object('type', m.movement_type, 'quantity', m.quantity_delta,
               'cost_incl', m.cost_incl_delta, 'occurred_at', m.occurred_at, 'sale_item_id', m.sale_item_id) order by m.occurred_at, m.created_at), '[]')
      from public.inventory_movements m where m.item_id = p_item_id) end,
    'sales', case when v_priv then (
      select coalesce(jsonb_agg(jsonb_build_object('sale_id', s.id, 'sale_no', s.sale_no, 'kind', s.kind, 'status', s.status,
               'sold_at', s.sold_at, 'channel', s.channel, 'quantity', si.quantity, 'revenue_incl', si.revenue_incl,
               'cost_incl', si.cost_incl, 'direct_expense_incl', si.direct_expense_incl,
               'profit_incl', si.revenue_incl - si.cost_incl - si.direct_expense_incl,
               'sales_staff_name', (select display_name from public.profiles where id = s.sales_staff_id)) order by s.sold_at), '[]')
      from public.sale_items si join public.sales s on s.id = si.sale_id where si.item_id = p_item_id) end
  );
end $$;

-- 販売明細（原価・利益は代表/管理者または買取担当本人のみ）
create or replace function public.get_sale_lines(p_sale_id uuid)
returns table (id uuid, line_no integer, item_id uuid, item_no text, item_name text, quantity integer,
               tax_category public.tax_category, revenue_incl bigint, revenue_excl bigint,
               direct_expense_incl bigint, direct_expense_excl bigint,
               cost_incl bigint, cost_excl bigint, profit_incl bigint, profit_excl bigint,
               purchaser_staff_id uuid, purchaser_name text, returned_from_sale_item_id uuid, returned_quantity integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_user();
  v_mgr boolean := app.is_manager();
begin
  if not exists (
    select 1 from public.sales s where s.id = p_sale_id and (
      v_mgr or s.sales_staff_id = v_uid
      or exists (select 1 from public.sale_items x where x.sale_id = s.id and x.purchaser_staff_id = v_uid))
  ) then
    perform app.fail('NOT_FOUND', '販売が見つからないか、閲覧権限がありません');
  end if;
  return query
  select si.id, si.line_no, si.item_id, i.item_no, i.name, si.quantity, si.tax_category,
         si.revenue_incl, si.revenue_excl, si.direct_expense_incl, si.direct_expense_excl,
         case when v_mgr or si.purchaser_staff_id = v_uid then si.cost_incl end,
         case when v_mgr or si.purchaser_staff_id = v_uid then si.cost_excl end,
         case when v_mgr or si.purchaser_staff_id = v_uid then si.revenue_incl - si.cost_incl - si.direct_expense_incl end,
         case when v_mgr or si.purchaser_staff_id = v_uid then si.revenue_excl - si.cost_excl - si.direct_expense_excl end,
         si.purchaser_staff_id, p.display_name, si.returned_from_sale_item_id,
         coalesce((select -sum(r.quantity) from public.sale_items r join public.sales rs on rs.id = r.sale_id
                   where r.returned_from_sale_item_id = si.id and rs.status = 'confirmed'), 0)::integer
  from public.sale_items si
  join public.purchase_items i on i.id = si.item_id
  join public.profiles p on p.id = si.purchaser_staff_id
  where si.sale_id = p_sale_id
  order by si.line_no;
end $$;

-- 従業員一覧（管理画面用。メールアドレスは代表・管理者のみ）
create or replace function public.admin_list_staff()
returns table (id uuid, display_name text, email text, role public.user_role, is_active boolean, created_at timestamptz,
               reserve_account_id uuid, reserve_balance bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_manager();
  return query
  select p.id, p.display_name, p.email, p.role, p.is_active, p.created_at, a.id, coalesce(app.fund_balance(a.id), 0)
  from public.profiles p left join public.fund_accounts a on a.owner_profile_id = p.id and a.kind = 'staff_reserve'
  order by p.is_active desc, p.role, p.display_name;
end $$;

-- 買取取引に紐づく本人確認記録の一覧（内容は返さない）
create or replace function public.purchase_identity_records(p_purchase_id uuid)
returns table (id uuid, verification_method text, verified_at timestamptz, retain_until date)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := app.require_user();
begin
  if not (app.is_manager() or exists (select 1 from public.purchase_transactions t where t.id = p_purchase_id and t.staff_id = v_uid)) then
    return;
  end if;
  return query select r.id, r.verification_method, r.verified_at, r.retain_until
    from public.customer_identity_records r where r.purchase_transaction_id = p_purchase_id and r.disposed_at is null;
end $$;


-- ===== 20261113000500_rls_grants_storage.sql =====
-- =============================================================================
-- 権限: RLS・GRANT・Storage
--   方針:
--   - anon には一切の権限を与えない
--   - authenticated には SELECT のみ（必要なテーブル・列のみ）。書き込みは RPC 経由
--   - 全テーブルで RLS を有効化
-- =============================================================================

-- -----------------------------------------------------------------------------
-- テーブル権限
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all tables in schema app from public, anon, authenticated;

grant select on
  public.app_settings, public.profiles, public.item_categories, public.customers,
  public.purchase_transactions, public.purchase_items, public.item_photos, public.inventory_movements,
  public.sales, public.sale_expenses, public.payment_records,
  public.fund_accounts, public.fund_transactions, public.fund_reconciliations,
  public.approval_requests, public.accounting_periods, public.audit_logs,
  public.expenses, public.expense_allocations
to authenticated;

-- 販売明細: 原価列は直接参照不可（get_sale_lines / 集計関数経由で権限に応じて返す）
grant select (id, sale_id, line_no, item_id, returned_from_sale_item_id, quantity, tax_category,
              revenue_incl, revenue_excl, revenue_tax, direct_expense_incl, direct_expense_excl,
              purchaser_staff_id, category_id, created_at)
  on public.sale_items to authenticated;

-- プロフィール: メールアドレスは直接参照不可（admin_list_staff 経由）
revoke select on public.profiles from authenticated;
grant select (id, display_name, role, is_active, created_at, updated_at) on public.profiles to authenticated;

-- 本人確認記録: 直接参照不可（get_identity_record 経由・監査ログ記録）
-- customer_identity_records には GRANT しない

-- カテゴリーは代表・管理者が直接編集可
grant insert, update on public.item_categories to authenticated;

-- -----------------------------------------------------------------------------
-- RLS 有効化
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- ポリシー
-- -----------------------------------------------------------------------------
create policy settings_select on public.app_settings for select to authenticated using (app.is_active_user());

create policy profiles_select on public.profiles for select to authenticated using (app.is_active_user());

create policy categories_select on public.item_categories for select to authenticated using (app.is_active_user());
create policy categories_insert on public.item_categories for insert to authenticated with check (app.is_manager());
create policy categories_update on public.item_categories for update to authenticated using (app.is_manager()) with check (app.is_manager());

create policy customers_select on public.customers for select to authenticated using (
  app.is_manager()
  or created_by = auth.uid()
  or exists (select 1 from public.purchase_transactions t where t.customer_id = customers.id and t.staff_id = auth.uid())
);

create policy purchase_tx_select on public.purchase_transactions for select to authenticated using (
  app.is_manager() or staff_id = auth.uid() or entered_by = auth.uid()
);

-- 他人の在庫は search_items / get_item（原価をマスク）経由で参照する
create policy purchase_items_select on public.purchase_items for select to authenticated using (
  app.is_manager() or staff_id = auth.uid()
);

create policy item_photos_select on public.item_photos for select to authenticated using (
  deleted_at is null and app.can_view_item(item_id)
);

create policy inventory_movements_select on public.inventory_movements for select to authenticated using (
  app.is_manager()
  or exists (select 1 from public.purchase_items i where i.id = inventory_movements.item_id and i.staff_id = auth.uid())
);

create or replace function app.can_view_sale(p_sale_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_active_user() and (
    app.is_manager()
    or exists (select 1 from public.sales s where s.id = p_sale_id and (s.sales_staff_id = auth.uid() or s.entered_by = auth.uid()))
    or exists (select 1 from public.sale_items si where si.sale_id = p_sale_id and si.purchaser_staff_id = auth.uid())
  )
$$;

create policy sales_select on public.sales for select to authenticated using (app.can_view_sale(id));
create policy sale_items_select on public.sale_items for select to authenticated using (app.can_view_sale(sale_id));
create policy sale_expenses_select on public.sale_expenses for select to authenticated using (app.can_view_sale(sale_id));
create policy payment_records_select on public.payment_records for select to authenticated using (app.can_view_sale(sale_id));

create policy fund_accounts_select on public.fund_accounts for select to authenticated using (
  app.is_manager() or owner_profile_id = auth.uid()
);
create policy fund_tx_select on public.fund_transactions for select to authenticated using (
  app.is_manager()
  or exists (select 1 from public.fund_accounts a where a.id = fund_transactions.account_id and a.owner_profile_id = auth.uid())
);
create policy fund_recon_select on public.fund_reconciliations for select to authenticated using (
  app.is_manager()
  or exists (select 1 from public.fund_accounts a where a.id = fund_reconciliations.account_id and a.owner_profile_id = auth.uid())
);

create policy approvals_select on public.approval_requests for select to authenticated using (
  app.is_manager() or requested_by = auth.uid()
);

create policy periods_select on public.accounting_periods for select to authenticated using (app.is_active_user());

create policy audit_select on public.audit_logs for select to authenticated using (app.is_manager());

create policy expenses_select on public.expenses for select to authenticated using (
  app.is_manager() or paid_by_staff_id = auth.uid() or attributed_staff_id = auth.uid() or created_by = auth.uid()
);
create policy expense_alloc_select on public.expense_allocations for select to authenticated using (
  app.is_manager() or staff_id = auth.uid()
);

-- customer_identity_records: ポリシーなし（= 直接アクセス不可）

-- -----------------------------------------------------------------------------
-- 関数の実行権限
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema app from public, anon, authenticated;
grant usage on schema app to authenticated;

-- RLS / Storage ポリシーで使用するヘルパー（副作用なし）
grant execute on function
  app.current_role(), app.is_active_user(), app.is_manager(), app.is_owner(),
  app.can_view_item(uuid), app.can_edit_item(uuid), app.can_view_sale(uuid), app.try_uuid(text)
to authenticated;

-- API から呼び出せる RPC
grant execute on function
  public.register_purchase(jsonb), public.void_purchase(uuid, text), public.split_item(jsonb),
  public.add_item_photo(uuid, text, text, integer), public.remove_item_photo(uuid),
  public.register_sale(jsonb), public.record_payment(jsonb), public.cancel_sale(uuid, text), public.register_return(jsonb),
  public.fund_operation(jsonb), public.record_reconciliation(uuid, bigint, text),
  public.create_approval_request(jsonb), public.decide_approval_request(uuid, boolean, text), public.withdraw_approval_request(uuid),
  public.close_period(date, text), public.reopen_period(date, text),
  public.set_user_role(uuid, public.user_role), public.set_user_active(uuid, boolean), public.update_display_name(uuid, text),
  public.update_settings(jsonb),
  public.find_customers_by_phone(text), public.get_identity_record(uuid, text),
  public.report_summary(timestamptz, timestamptz, uuid), public.report_timeseries(date, date, text, uuid),
  public.report_staff_ranking(timestamptz, timestamptz), public.report_breakdown(timestamptz, timestamptz, text, uuid),
  public.fund_balances(), public.search_items(text, uuid, text, text, uuid, integer, integer),
  public.get_item(uuid), public.get_sale_lines(uuid), public.admin_list_staff(), public.purchase_identity_records(uuid)
to authenticated;

-- 今後作成される関数もデフォルトでは実行不可にする
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema app revoke execute on functions from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Storage: 商品写真（非公開バケット）
--   パス: items/<item_id>/<uuid>.<ext>
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('item-photos', 'item-photos', false, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy item_photos_storage_select on storage.objects for select to authenticated using (
  bucket_id = 'item-photos'
  and (storage.foldername(name))[1] = 'items'
  and app.can_view_item(app.try_uuid((storage.foldername(name))[2]))
);

create policy item_photos_storage_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'item-photos'
  and (storage.foldername(name))[1] = 'items'
  and app.can_edit_item(app.try_uuid((storage.foldername(name))[2]))
);
-- UPDATE / DELETE ポリシーは作成しない（写真の削除は item_photos の論理削除で管理）


-- ===== 20261114000100_precious_metal_purchase.sql =====
-- =============================================================================
-- 貴金属買取（簡易版）
--   - 商品別地金金額 = 重量(g) × 参考相場単価(円/g) を1円単位に四捨五入
--   - 地金総額 = 商品別地金金額の合計 / 見込み利益 = 地金総額 − 支払額
--   - 参考相場は日付・品位ごとに保存。買取記録には適用単価をスナップショット保存し、
--     相場マスタを後から修正しても過去の記録は変わらない
--   - 参考相場（ゴールドミセス等の公開買取相場）は「参考価格」であり、実際の売却価格ではない
-- =============================================================================

-- 画面モード（simple: 貴金属買取のみ / full: 在庫・販売・資金管理を含む全機能）
alter table public.app_settings add column ui_mode text not null default 'simple' check (ui_mode in ('simple', 'full'));
alter table public.app_settings add column pm_price_source_name text not null default 'ゴールドミセス 公開買取相場（参考）'
  check (length(pm_price_source_name) between 1 and 100);

-- -----------------------------------------------------------------------------
-- 品位マスタ
-- -----------------------------------------------------------------------------
create table public.pm_grades (
  code text primary key check (code ~ '^[A-Za-z0-9.]{2,10}$'),
  metal text not null check (metal in ('gold', 'platinum', 'silver', 'palladium')),
  label text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true
);
insert into public.pm_grades (code, metal, label, sort_order) values
  ('K24', 'gold', 'K24（純金）', 10), ('K22', 'gold', 'K22', 20), ('K21.6', 'gold', 'K21.6', 25), ('K20', 'gold', 'K20', 30),
  ('K18', 'gold', 'K18', 40), ('K14', 'gold', 'K14', 50), ('K10', 'gold', 'K10', 60), ('K9', 'gold', 'K9', 70),
  ('Pt1000', 'platinum', 'Pt1000（純プラチナ）', 110), ('Pt950', 'platinum', 'Pt950', 120), ('Pt900', 'platinum', 'Pt900', 130),
  ('Pt850', 'platinum', 'Pt850', 140),
  ('SV1000', 'silver', 'SV1000（純銀）', 210), ('SV925', 'silver', 'SV925', 220),
  ('Pd1000', 'palladium', 'Pd1000', 310);

-- -----------------------------------------------------------------------------
-- 参考相場（日付 × 品位）
-- -----------------------------------------------------------------------------
create table public.pm_market_prices (
  id uuid primary key default gen_random_uuid(),
  price_date date not null,
  grade_code text not null references public.pm_grades (code),
  unit_price numeric(12, 2) not null check (unit_price > 0 and unit_price < 10000000),  -- 円/g
  source_name text not null check (length(source_name) between 1 and 100),
  source_url text check (source_url ~ '^https?://' and length(source_url) <= 500),
  fetched_at timestamptz not null,                 -- 取得日時（手動の場合は確認した日時）
  method text not null check (method in ('manual', 'auto')),
  recorded_by uuid references public.profiles (id),
  note text check (length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (price_date, grade_code)
);
create index pm_market_prices_date_idx on public.pm_market_prices (price_date desc);

-- -----------------------------------------------------------------------------
-- 買取取引・商品
-- -----------------------------------------------------------------------------
create table public.pm_purchases (
  id uuid primary key default gen_random_uuid(),
  purchase_no text not null unique,
  purchased_on date not null,
  staff_id uuid not null references public.profiles (id),
  entered_by uuid not null references public.profiles (id),
  customer_name text not null check (length(customer_name) between 1 and 100),
  customer_phone text check (customer_phone ~ '^[0-9+\-]{0,20}$'),
  customer_address text check (length(customer_address) <= 300),
  paid_amount bigint not null check (paid_amount >= 0 and paid_amount <= 1000000000000),
  total_metal_value bigint not null check (total_metal_value >= 0),
  expected_profit bigint generated always as (total_metal_value - paid_amount) stored,
  note text check (length(note) <= 1000),
  status text not null default 'active' check (status in ('active', 'voided')),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id),
  void_reason text,
  idempotency_key uuid not null unique,
  created_at timestamptz not null default now(),
  constraint pm_purchases_void_chk check ((status = 'voided') = (voided_at is not null))
);
create index pm_purchases_staff_idx on public.pm_purchases (staff_id, purchased_on desc);
create index pm_purchases_date_idx on public.pm_purchases (purchased_on desc);
create index pm_purchases_customer_idx on public.pm_purchases (customer_name);

create table public.pm_purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.pm_purchases (id) deferrable initially deferred,  -- 明細→ヘッダーの順で登録
  line_no integer not null check (line_no > 0),
  item_name text check (length(item_name) <= 100),
  grade_code text not null references public.pm_grades (code),
  weight_g numeric(10, 2) not null check (weight_g > 0 and weight_g < 100000000),
  unit_price numeric(12, 2) not null check (unit_price > 0),          -- 適用した参考相場単価（スナップショット）
  price_basis text not null check (price_basis in ('market', 'market_previous', 'manual')),
  market_price_id uuid references public.pm_market_prices (id),
  market_price_date date,                                             -- 適用した相場の日付
  metal_value bigint not null check (metal_value >= 0),
  unique (purchase_id, line_no)
);
create index pm_purchase_items_purchase_idx on public.pm_purchase_items (purchase_id);

-- 監査・不変性
create trigger audit_pm_market_prices after insert or update or delete on public.pm_market_prices for each row execute function app.audit_row();
create trigger audit_pm_purchases after insert or update or delete on public.pm_purchases for each row execute function app.audit_row();
create trigger audit_pm_purchase_items after insert or update or delete on public.pm_purchase_items for each row execute function app.audit_row();
create trigger immutable_pm_purchase_items before update or delete on public.pm_purchase_items for each row execute function app.reject_modification();
create trigger nodelete_pm_purchases before delete on public.pm_purchases for each row execute function app.reject_modification();
create trigger nodelete_pm_market_prices before delete on public.pm_market_prices for each row execute function app.reject_modification();
create trigger touch_pm_market_prices before update on public.pm_market_prices for each row execute function app.touch_updated_at();

-- 買取の金額・内容は登録後に変更不可（取消のみ）
-- expected_profit は生成列のため BEFORE トリガー内では未計算（比較から除外）
create or replace function app.pm_purchase_guard()
returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - array['status', 'voided_at', 'voided_by', 'void_reason', 'expected_profit'])
     is distinct from (to_jsonb(old) - array['status', 'voided_at', 'voided_by', 'void_reason', 'expected_profit']) then
    raise exception 'SAIKOU:IMMUTABLE:登録済みの買取内容は変更できません（取消して再登録してください）' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger guard_pm_purchases before update on public.pm_purchases for each row execute function app.pm_purchase_guard();

-- -----------------------------------------------------------------------------
-- 計算
-- -----------------------------------------------------------------------------
create or replace function app.pm_metal_value(p_weight numeric, p_unit_price numeric)
returns bigint language sql immutable as $$
  select round(p_weight * p_unit_price, 0)::bigint   -- 1円未満四捨五入（正の値のみ）
$$;

-- 指定日に適用する相場（当日の登録がなければ直近の過去日）
create or replace function public.pm_prices_for_date(p_date date)
returns table (grade_code text, unit_price numeric, price_date date, market_price_id uuid, source_name text, fetched_at timestamptz, is_exact_date boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_user();
  return query
  select distinct on (mp.grade_code) mp.grade_code, mp.unit_price, mp.price_date, mp.id, mp.source_name, mp.fetched_at, mp.price_date = p_date
  from public.pm_market_prices mp
  where mp.price_date <= p_date
  order by mp.grade_code, mp.price_date desc;
end $$;

-- -----------------------------------------------------------------------------
-- 相場登録（代表・管理者）
-- p: { "price_date": "2026-11-14", "source_name": "...", "source_url": "...", "fetched_at": ts,
--      "prices": [{"grade_code": "K18", "unit_price": 16500}] }
-- -----------------------------------------------------------------------------
create or replace function public.pm_upsert_market_prices(p jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_manager();
  v_date date := (p ->> 'price_date')::date;
  v_row jsonb;
  v_n integer := 0;
  v_price numeric;
begin
  if v_date is null then perform app.fail('VALIDATION', '相場の日付を指定してください'); end if;
  if v_date > (now() at time zone 'Asia/Tokyo')::date + 1 then perform app.fail('VALIDATION', '未来日の相場は登録できません'); end if;
  if jsonb_typeof(p -> 'prices') <> 'array' then perform app.fail('VALIDATION', '相場を入力してください'); end if;
  for v_row in select * from jsonb_array_elements(p -> 'prices') loop
    v_price := (v_row ->> 'unit_price')::numeric;
    if v_price is null then continue; end if;
    if v_price <= 0 or v_price <> round(v_price, 2) then perform app.fail('VALIDATION', '相場単価は0より大きい金額（小数2桁まで）で入力してください'); end if;
    insert into public.pm_market_prices (price_date, grade_code, unit_price, source_name, source_url, fetched_at, method, recorded_by, note)
    values (v_date, v_row ->> 'grade_code', v_price,
            coalesce(nullif(trim(p ->> 'source_name'), ''), (select pm_price_source_name from public.app_settings)),
            nullif(trim(p ->> 'source_url'), ''), coalesce((p ->> 'fetched_at')::timestamptz, now()), 'manual', v_uid, nullif(p ->> 'note', ''))
    on conflict (price_date, grade_code) do update set
      unit_price = excluded.unit_price, source_name = excluded.source_name, source_url = excluded.source_url,
      fetched_at = excluded.fetched_at, method = 'manual', recorded_by = v_uid, note = excluded.note;
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then perform app.fail('VALIDATION', '相場を1件以上入力してください'); end if;
  return v_n;
end $$;

-- -----------------------------------------------------------------------------
-- 買取登録
-- p: { "idempotency_key", "purchased_on", "staff_id", "customer_name", "customer_phone", "customer_address",
--      "paid_amount", "note",
--      "items": [{"item_name", "grade_code", "weight_g", "unit_price"}] }
--   unit_price を省略すると買取日の参考相場（なければ直近の過去日）を適用
-- -----------------------------------------------------------------------------
create or replace function public.pm_register_purchase(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_user();
  v_key uuid := (p ->> 'idempotency_key')::uuid;
  v_existing public.pm_purchases;
  v_staff uuid;
  v_date date := coalesce((p ->> 'purchased_on')::date, (now() at time zone 'Asia/Tokyo')::date);
  v_paid bigint := (p ->> 'paid_amount')::bigint;
  v_id uuid := gen_random_uuid();
  v_item jsonb;
  v_line integer := 0;
  v_weight numeric;
  v_price numeric;
  v_mp record;
  v_basis text;
  v_value bigint;
  v_total bigint := 0;
  v_warnings jsonb := '[]'::jsonb;
begin
  if v_key is null then perform app.fail('VALIDATION', '冪等キーがありません'); end if;
  perform app.lock_key(v_key);
  select * into v_existing from public.pm_purchases where idempotency_key = v_key;
  if found then
    if v_existing.entered_by <> v_uid then perform app.fail('CONFLICT', '冪等キーが重複しています'); end if;
    return jsonb_build_object('purchase_id', v_existing.id, 'purchase_no', v_existing.purchase_no, 'duplicate', true);
  end if;

  v_staff := app.resolve_staff((p ->> 'staff_id')::uuid);
  if v_date > (now() at time zone 'Asia/Tokyo')::date then perform app.fail('VALIDATION', '買取日が未来です'); end if;
  if coalesce(trim(p ->> 'customer_name'), '') = '' then perform app.fail('VALIDATION', 'お客様の名前を入力してください'); end if;
  if v_paid is null or v_paid < 0 then perform app.fail('VALIDATION', '買取金額（支払額）を0円以上で入力してください'); end if;
  if jsonb_typeof(p -> 'items') <> 'array' or jsonb_array_length(p -> 'items') = 0 then
    perform app.fail('VALIDATION', '商品を1点以上入力してください');
  end if;
  if jsonb_array_length(p -> 'items') > 100 then perform app.fail('VALIDATION', '1取引の商品は100点までです'); end if;

  for v_item in select * from jsonb_array_elements(p -> 'items') loop
    v_line := v_line + 1;
    if not exists (select 1 from public.pm_grades where code = v_item ->> 'grade_code' and is_active) then
      perform app.fail('VALIDATION', format('%s点目の品位が不正です', v_line));
    end if;
    v_weight := (v_item ->> 'weight_g')::numeric;
    if v_weight is null or v_weight <= 0 or v_weight <> round(v_weight, 2) then
      perform app.fail('VALIDATION', format('%s点目の重量は0gより大きい値（小数2桁まで）で入力してください', v_line));
    end if;
    select * into v_mp from public.pm_prices_for_date(v_date) x where x.grade_code = v_item ->> 'grade_code';
    v_price := (v_item ->> 'unit_price')::numeric;
    if v_price is null then
      if v_mp.unit_price is null then
        perform app.fail('NO_MARKET_PRICE', format('%s の参考相場が登録されていません。相場を登録するか単価を入力してください', v_item ->> 'grade_code'));
      end if;
      v_price := v_mp.unit_price;
    end if;
    if v_price <= 0 or v_price <> round(v_price, 2) then
      perform app.fail('VALIDATION', format('%s点目の相場単価は0より大きい金額（小数2桁まで）で入力してください', v_line));
    end if;
    v_basis := case
      when v_mp.unit_price is not null and v_price = v_mp.unit_price and v_mp.is_exact_date then 'market'
      when v_mp.unit_price is not null and v_price = v_mp.unit_price then 'market_previous'
      else 'manual' end;
    if v_basis = 'market_previous' then
      v_warnings := v_warnings || to_jsonb(format('%s は %s の相場を適用しました', v_item ->> 'grade_code', v_mp.price_date));
    end if;
    v_value := app.pm_metal_value(v_weight, v_price);
    v_total := v_total + v_value;
    insert into public.pm_purchase_items (purchase_id, line_no, item_name, grade_code, weight_g, unit_price, price_basis,
      market_price_id, market_price_date, metal_value)
    values (v_id, v_line, nullif(trim(v_item ->> 'item_name'), ''), v_item ->> 'grade_code', v_weight, v_price, v_basis,
      case when v_basis <> 'manual' then v_mp.market_price_id end, case when v_basis <> 'manual' then v_mp.price_date end, v_value);
  end loop;

  -- ヘッダーは合計確定後に1回だけ登録（明細の外部キーはコミット時に検証）
  insert into public.pm_purchases (id, purchase_no, purchased_on, staff_id, entered_by, customer_name, customer_phone,
    customer_address, paid_amount, total_metal_value, note, idempotency_key)
  values (v_id, app.next_doc_no('G', (v_date::timestamp at time zone 'Asia/Tokyo')), v_date, v_staff, v_uid,
    trim(p ->> 'customer_name'),
    nullif(regexp_replace(coalesce(p ->> 'customer_phone', ''), '[^0-9+\-]', '', 'g'), ''),
    nullif(trim(p ->> 'customer_address'), ''), v_paid, v_total, nullif(trim(p ->> 'note'), ''), v_key);

  return jsonb_build_object('purchase_id', v_id, 'purchase_no', (select purchase_no from public.pm_purchases where id = v_id),
    'total_metal_value', v_total, 'expected_profit', v_total - v_paid, 'warnings', v_warnings, 'duplicate', false);
end $$;

create or replace function public.pm_void_purchase(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_manager();
begin
  if coalesce(trim(p_reason), '') = '' then perform app.fail('VALIDATION', '取消理由を入力してください'); end if;
  update public.pm_purchases set status = 'voided', voided_at = now(), voided_by = v_uid, void_reason = trim(p_reason)
   where id = p_id and status = 'active';
  if not found then perform app.fail('NOT_FOUND', '取消できる買取が見つかりません'); end if;
end $$;

-- -----------------------------------------------------------------------------
-- 集計（従業員は自分のみ、代表・管理者は全体または指定従業員）
-- -----------------------------------------------------------------------------
create or replace function public.pm_report_summary(p_from date, p_to date, p_staff uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_staff uuid := app.report_scope(p_staff);
  r record;
begin
  select count(*)::integer as cnt, coalesce(sum(total_metal_value), 0)::bigint as metal,
         coalesce(sum(paid_amount), 0)::bigint as paid, coalesce(sum(expected_profit), 0)::bigint as profit
    into r
  from public.pm_purchases
  where status = 'active' and purchased_on between p_from and p_to and (v_staff is null or staff_id = v_staff);
  return jsonb_build_object('staff_id', v_staff, 'count', r.cnt, 'total_metal_value', r.metal, 'paid_amount', r.paid, 'expected_profit', r.profit);
end $$;

create or replace function public.pm_report_timeseries(p_from date, p_to date, p_grain text default 'day', p_staff uuid default null)
returns table (bucket date, count integer, total_metal_value bigint, paid_amount bigint, expected_profit bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_staff uuid := app.report_scope(p_staff);
begin
  if p_grain not in ('day', 'month') then perform app.fail('VALIDATION', '集計単位が不正です'); end if;
  if p_to < p_from or p_to - p_from > 3700 then perform app.fail('VALIDATION', '期間が不正です'); end if;
  return query
  with b as (
    select gs::date as d from generate_series(date_trunc(p_grain, p_from::timestamp), date_trunc(p_grain, p_to::timestamp), ('1 ' || p_grain)::interval) gs
  ), s as (
    select date_trunc(p_grain, pp.purchased_on::timestamp)::date as d, count(*) as cnt,
           sum(pp.total_metal_value) as metal, sum(pp.paid_amount) as paid, sum(pp.expected_profit) as profit
    from public.pm_purchases pp
    where pp.status = 'active' and pp.purchased_on between p_from and p_to and (v_staff is null or pp.staff_id = v_staff)
    group by 1
  )
  select b.d, coalesce(s.cnt, 0)::integer, coalesce(s.metal, 0)::bigint, coalesce(s.paid, 0)::bigint, coalesce(s.profit, 0)::bigint
  from b left join s on s.d = b.d order by b.d;
end $$;

create or replace function public.pm_report_by_staff(p_from date, p_to date)
returns table (staff_id uuid, display_name text, count integer, total_metal_value bigint, paid_amount bigint, expected_profit bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_manager();
  return query
  select pr.id, pr.display_name, count(pp.id)::integer, coalesce(sum(pp.total_metal_value), 0)::bigint,
         coalesce(sum(pp.paid_amount), 0)::bigint, coalesce(sum(pp.expected_profit), 0)::bigint
  from public.profiles pr
  left join public.pm_purchases pp on pp.staff_id = pr.id and pp.status = 'active' and pp.purchased_on between p_from and p_to
  where pr.is_active or pp.id is not null
  group by pr.id, pr.display_name
  order by 6 desc, 2;
end $$;

-- -----------------------------------------------------------------------------
-- 権限
-- -----------------------------------------------------------------------------
alter table public.pm_grades enable row level security;
alter table public.pm_market_prices enable row level security;
alter table public.pm_purchases enable row level security;
alter table public.pm_purchase_items enable row level security;

revoke all on public.pm_grades, public.pm_market_prices, public.pm_purchases, public.pm_purchase_items from anon, authenticated;
grant select on public.pm_grades, public.pm_market_prices, public.pm_purchases, public.pm_purchase_items to authenticated;

create policy pm_grades_select on public.pm_grades for select to authenticated using (app.is_active_user());
create policy pm_prices_select on public.pm_market_prices for select to authenticated using (app.is_active_user());
create policy pm_purchases_select on public.pm_purchases for select to authenticated using (
  app.is_manager() or staff_id = auth.uid() or entered_by = auth.uid()
);
create policy pm_items_select on public.pm_purchase_items for select to authenticated using (
  exists (select 1 from public.pm_purchases pp where pp.id = pm_purchase_items.purchase_id
          and (app.is_manager() or pp.staff_id = auth.uid() or pp.entered_by = auth.uid()))
);

revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema app from public, anon, authenticated;
grant execute on function
  app.current_role(), app.is_active_user(), app.is_manager(), app.is_owner(),
  app.can_view_item(uuid), app.can_edit_item(uuid), app.can_view_sale(uuid), app.try_uuid(text)
to authenticated;
grant execute on function
  public.register_purchase(jsonb), public.void_purchase(uuid, text), public.split_item(jsonb),
  public.add_item_photo(uuid, text, text, integer), public.remove_item_photo(uuid),
  public.register_sale(jsonb), public.record_payment(jsonb), public.cancel_sale(uuid, text), public.register_return(jsonb),
  public.fund_operation(jsonb), public.record_reconciliation(uuid, bigint, text),
  public.create_approval_request(jsonb), public.decide_approval_request(uuid, boolean, text), public.withdraw_approval_request(uuid),
  public.close_period(date, text), public.reopen_period(date, text),
  public.set_user_role(uuid, public.user_role), public.set_user_active(uuid, boolean), public.update_display_name(uuid, text),
  public.update_settings(jsonb),
  public.find_customers_by_phone(text), public.get_identity_record(uuid, text),
  public.report_summary(timestamptz, timestamptz, uuid), public.report_timeseries(date, date, text, uuid),
  public.report_staff_ranking(timestamptz, timestamptz), public.report_breakdown(timestamptz, timestamptz, text, uuid),
  public.fund_balances(), public.search_items(text, uuid, text, text, uuid, integer, integer),
  public.get_item(uuid), public.get_sale_lines(uuid), public.admin_list_staff(), public.purchase_identity_records(uuid),
  public.pm_prices_for_date(date), public.pm_upsert_market_prices(jsonb), public.pm_register_purchase(jsonb),
  public.pm_void_purchase(uuid, text), public.pm_report_summary(date, date, uuid),
  public.pm_report_timeseries(date, date, text, uuid), public.pm_report_by_staff(date, date)
to authenticated;

-- 設定更新に画面モード・相場の取得元名を追加
create or replace function public.update_settings(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_owner();
begin
  update public.app_settings set
    tax_basis = coalesce((p ->> 'tax_basis')::public.tax_basis, tax_basis),
    tax_rounding = coalesce((p ->> 'tax_rounding')::public.rounding_mode, tax_rounding),
    staff_can_view_other_inventory = coalesce((p ->> 'staff_can_view_other_inventory')::boolean, staff_can_view_other_inventory),
    admin_can_approve_funds = coalesce((p ->> 'admin_can_approve_funds')::boolean, admin_can_approve_funds),
    identity_retention_years = coalesce((p ->> 'identity_retention_years')::integer, identity_retention_years),
    long_stay_days = coalesce((p ->> 'long_stay_days')::integer, long_stay_days),
    ui_mode = coalesce(p ->> 'ui_mode', ui_mode),
    pm_price_source_name = coalesce(nullif(trim(p ->> 'pm_price_source_name'), ''), pm_price_source_name),
    updated_at = now(), updated_by = v_uid;
end $$;
revoke execute on function public.update_settings(jsonb) from public, anon;
grant execute on function public.update_settings(jsonb) to authenticated;


-- ===== 20261114000200_pm_delete.sql =====
-- =============================================================================
-- 貴金属買取（簡易版）: 買取記録・参考相場の削除（代表・管理者のみ）
--   - 通常の UPDATE/DELETE は引き続きトリガーで禁止し、削除用 RPC の中だけ許可する
--   - 削除前の内容は監査ログ（audit_logs, action = delete）に保存される
-- =============================================================================

-- 削除用 RPC 実行中のみ立つフラグ（トランザクション内のローカル設定）
create or replace function app.pm_reject_unless_deleting()
returns trigger language plpgsql as $$
begin
  if current_setting('app.pm_deleting', true) = 'on' then
    -- DELETE は OLD、UPDATE（相場削除時の参照解除）は NEW を返して処理を通す
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'SAIKOU:IMMUTABLE:% は変更・削除できません', tg_table_name using errcode = 'P0001';
end $$;

drop trigger immutable_pm_purchase_items on public.pm_purchase_items;
create trigger immutable_pm_purchase_items before update or delete on public.pm_purchase_items
  for each row execute function app.pm_reject_unless_deleting();
drop trigger nodelete_pm_purchases on public.pm_purchases;
create trigger nodelete_pm_purchases before delete on public.pm_purchases
  for each row execute function app.pm_reject_unless_deleting();
drop trigger nodelete_pm_market_prices on public.pm_market_prices;
create trigger nodelete_pm_market_prices before delete on public.pm_market_prices
  for each row execute function app.pm_reject_unless_deleting();

-- 相場を削除しても買取明細の適用単価（スナップショット）は残し、参照だけ外す
alter table public.pm_purchase_items drop constraint pm_purchase_items_market_price_id_fkey;
alter table public.pm_purchase_items add constraint pm_purchase_items_market_price_id_fkey
  foreign key (market_price_id) references public.pm_market_prices (id) on delete set null;

create or replace function public.pm_delete_purchase(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_manager();
  v_row public.pm_purchases;
begin
  if coalesce(trim(p_reason), '') = '' then perform app.fail('VALIDATION', '削除理由を入力してください'); end if;
  select * into v_row from public.pm_purchases where id = p_id for update;
  if not found then perform app.fail('NOT_FOUND', '買取記録が見つかりません'); end if;
  perform set_config('app.pm_deleting', 'on', true);
  perform app.audit('pm_purchase_delete', 'pm_purchases', p_id::text, to_jsonb(v_row), null,
    jsonb_build_object('reason', trim(p_reason),
      'items', (select jsonb_agg(to_jsonb(i) order by i.line_no) from public.pm_purchase_items i where i.purchase_id = p_id)));
  delete from public.pm_purchase_items where purchase_id = p_id;
  delete from public.pm_purchases where id = p_id;
  perform set_config('app.pm_deleting', 'off', true);
end $$;

-- 指定日の相場を削除（p_grade が null ならその日の全品位）
create or replace function public.pm_delete_market_prices(p_date date, p_grade text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_manager();
  v_n integer;
begin
  perform set_config('app.pm_deleting', 'on', true);
  delete from public.pm_market_prices where price_date = p_date and (p_grade is null or grade_code = p_grade);
  get diagnostics v_n = row_count;
  perform set_config('app.pm_deleting', 'off', true);
  if v_n = 0 then perform app.fail('NOT_FOUND', '削除する相場が見つかりません'); end if;
  return v_n;
end $$;

revoke execute on function public.pm_delete_purchase(uuid, text), public.pm_delete_market_prices(date, text) from public, anon;
grant execute on function public.pm_delete_purchase(uuid, text), public.pm_delete_market_prices(date, text) to authenticated;
revoke execute on function app.pm_reject_unless_deleting() from public, anon, authenticated;

