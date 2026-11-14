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
