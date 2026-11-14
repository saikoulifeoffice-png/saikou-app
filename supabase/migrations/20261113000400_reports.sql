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
