-- Preserve the existing availability conflict response before applying the Premium range gate.
-- The Supabase CLI migration generator was unavailable in this offline workspace; this follows
-- the project's established immutable timestamped migration convention.

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
  if exists (select 1 from public.bookings b
              where b.listing_id = p_listing_id
                and b.status in ('awaiting_payment', 'confirmed', 'active', 'overdue', 'return_requested', 'disputed')
                and daterange(b.pickup_date, b.return_date, '[]') && daterange(p_start, p_end, '[]')) then
    raise exception 'conflict.dates_booked' using errcode = 'P0001', hint = 'Some of these dates are already booked. Existing bookings are kept.';
  end if;
  if p_end > p_start then perform app_private.require_premium(auth.uid()); end if;
  insert into public.listing_availability (listing_id, start_date, end_date, reason)
  values (p_listing_id, greatest(p_start, v_today), p_end, nullif(trim(coalesce(p_reason, '')), ''))
  returning id into v_id;
  perform app_private.audit('listing.availability_blocked', 'listing', p_listing_id::text, jsonb_build_object('start', p_start, 'end', p_end, 'premium_range', p_end > p_start));
  return v_id;
end
$$;
