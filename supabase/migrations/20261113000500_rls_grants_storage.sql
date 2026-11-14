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
