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
