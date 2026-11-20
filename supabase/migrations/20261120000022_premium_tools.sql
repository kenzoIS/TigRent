-- Phase 12: server-enforced Premium tools. Free lenders keep single-day blocks;
-- date ranges and safe bulk pausing/unavailability require an active demo plan.

create or replace function public.add_availability_block(p_listing_id uuid, p_start date, p_end date, p_reason text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v public.listings;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_id uuid;
begin
  v := app_private.lock_own_listing(p_listing_id);
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'validation.dates' using errcode = 'P0001', hint = 'The end date must be on or after the start date.';
  end if;
  if p_end < v_today then
    raise exception 'validation.dates_past' using errcode = 'P0001', hint = 'Choose dates from today onwards.';
  end if;
  if p_end - p_start > 365 then
    raise exception 'validation.dates_range' using errcode = 'P0001', hint = 'Block at most one year at a time.';
  end if;
  if p_end > p_start then perform app_private.require_premium(auth.uid()); end if;
  if exists (select 1 from public.bookings b
              where b.listing_id = p_listing_id
                and b.status in ('awaiting_payment', 'confirmed', 'active', 'overdue', 'return_requested', 'disputed')
                and daterange(b.pickup_date, b.return_date, '[]') && daterange(p_start, p_end, '[]')) then
    raise exception 'conflict.dates_booked' using errcode = 'P0001', hint = 'Some of these dates are already booked. Existing bookings are kept.';
  end if;
  insert into public.listing_availability (listing_id, start_date, end_date, reason)
  values (p_listing_id, greatest(p_start, v_today), p_end, nullif(trim(coalesce(p_reason, '')), ''))
  returning id into v_id;
  perform app_private.audit('listing.availability_blocked', 'listing', p_listing_id::text, jsonb_build_object('start', p_start, 'end', p_end, 'premium_range', p_end > p_start));
  return v_id;
end
$$;

create function public.bulk_set_listing_status(p_listing_ids uuid[], p_status public.listing_status) returns integer
language plpgsql security definer set search_path = '' as $$
declare v public.listings; v_count integer := 0; v_expected integer;
begin
  if auth.uid() is null then raise exception 'unauthenticated.no_session' using errcode = 'P0001', hint = 'Please sign in.'; end if;
  perform app_private.require_active_lender();
  perform app_private.require_premium(auth.uid());
  if p_status not in ('paused', 'unavailable') then
    raise exception 'validation.bulk_status' using errcode = 'P0001', hint = 'Bulk tools can only pause or mark listings unavailable.';
  end if;
  select count(distinct x) into v_expected from unnest(coalesce(p_listing_ids, '{}'::uuid[])) as x;
  if v_expected not between 1 and 50 or cardinality(p_listing_ids) <> v_expected then
    raise exception 'validation.bulk_listings' using errcode = 'P0001', hint = 'Choose between 1 and 50 unique listings.';
  end if;
  for v in select * from public.listings where id = any(p_listing_ids) for update loop
    if v.lender_id <> auth.uid() or v.status = 'removed' then
      raise exception 'not_found.listing' using errcode = 'P0001', hint = 'One of these listings can’t be updated.';
    end if;
    v_count := v_count + 1;
  end loop;
  if v_count <> v_expected then raise exception 'not_found.listing' using errcode = 'P0001', hint = 'One of these listings can’t be updated.'; end if;
  update public.listings set status = p_status, is_featured = false, featured_until = null where id = any(p_listing_ids);
  perform app_private.audit('listing.bulk_' || p_status, 'listing_batch', null, jsonb_build_object('listing_ids', p_listing_ids, 'count', v_count));
  return v_count;
end
$$;

revoke all on function public.bulk_set_listing_status(uuid[], public.listing_status) from public, anon;
grant execute on function public.bulk_set_listing_status(uuid[], public.listing_status) to authenticated;
