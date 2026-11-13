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
