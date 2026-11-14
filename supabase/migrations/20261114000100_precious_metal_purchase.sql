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
