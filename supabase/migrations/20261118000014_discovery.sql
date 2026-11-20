-- Phase 7: borrower discovery, availability previews, price quotes (plan §2.3, §2.4, Phase 7).

-- Sample request-window settings (admin-configurable in Phase 12).
insert into public.platform_settings (key, value, version, is_current, is_sample, description) values
  ('max_rental_days', '30', 1, true, true, 'Longest single rental a borrower can request (sample).'),
  ('max_advance_days', '90', 1, true, true, 'How far ahead a pickup date can be booked (sample).')
on conflict (key, version) do nothing;

-- ── One Trusted Lender rule for badges and search (was inline in get_profile_summary) ──
create function app_private.lender_rating(p_user uuid) returns table (avg numeric, count integer)
language sql stable security definer set search_path = '' as $$
  select round(avg(rating)::numeric, 2), count(*)::integer
    from public.reviews where target_id = p_user and direction = 'borrower_to_lender' and moderation_status = 'visible'
$$;

create function app_private.is_trusted_lender(p_user uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rule jsonb := coalesce(app_private.setting('trusted_lender_rule'),
                           '{"min_completed_lendings": 5, "min_avg_rating": 4.5, "no_unresolved_severe_disputes": true}'::jsonb);
  v_lend integer;
  v_avg numeric;
  v_severe integer;
begin
  if app_private.verification_status(p_user) <> 'verified'
     or exists (select 1 from public.profiles where id = p_user and account_status <> 'active') then
    return false;
  end if;
  select count(*) into v_lend from public.bookings where lender_id = p_user and status = 'completed';
  select avg into v_avg from app_private.lender_rating(p_user);
  select count(*) into v_severe from public.disputes d join public.bookings b on b.id = d.booking_id
   where b.lender_id = p_user and d.severity = 'severe' and d.status not in ('resolved_refund', 'resolved_compensation', 'closed');
  return v_lend >= coalesce((v_rule ->> 'min_completed_lendings')::int, 5)
     and coalesce(v_avg, 0) >= coalesce((v_rule ->> 'min_avg_rating')::numeric, 4.5)
     and (not coalesce((v_rule ->> 'no_unresolved_severe_disputes')::boolean, true) or v_severe = 0);
end
$$;

-- get_profile_summary now uses the shared rule (same output shape as migration 012).
create or replace function public.get_profile_summary(p_user_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_viewer uuid := auth.uid();
  v_user uuid := coalesce(p_user_id, auth.uid());
  v_profile public.profiles;
  v_rule jsonb := coalesce(app_private.setting('trusted_lender_rule'),
                           '{"min_completed_lendings": 5, "min_avg_rating": 4.5, "no_unresolved_severe_disputes": true}'::jsonb);
  v_verified boolean;
  v_lend_count integer;
  v_borrow_count integer;
  v_lender_avg numeric;
  v_lender_reviews integer;
  v_borrower_avg numeric;
  v_borrower_reviews integer;
  v_severe integer;
  v_trusted boolean;
  v_badges jsonb := '[]'::jsonb;
begin
  if v_viewer is null then
    raise exception 'unauthenticated.no_session' using errcode = 'P0001', hint = 'Please sign in.';
  end if;
  if v_user <> v_viewer and not (app_private.is_verified_student() or app_private.is_staff()) then
    raise exception 'forbidden.not_verified' using errcode = 'P0001', hint = 'Only verified students can view member profiles.';
  end if;
  select * into v_profile from public.profiles where id = v_user;
  if not found then
    raise exception 'not_found.profile' using errcode = 'P0001', hint = 'This member could not be found.';
  end if;
  v_verified := app_private.verification_status(v_user) = 'verified';
  select count(*) filter (where b.lender_id = v_user), count(*) filter (where b.borrower_id = v_user)
    into v_lend_count, v_borrow_count
    from public.bookings b where b.status = 'completed' and v_user in (b.lender_id, b.borrower_id);
  select avg, count into v_lender_avg, v_lender_reviews from app_private.lender_rating(v_user);
  select round(avg(rating)::numeric, 2), count(*) into v_borrower_avg, v_borrower_reviews
    from public.reviews where target_id = v_user and direction = 'lender_to_borrower' and moderation_status = 'visible';
  select count(*) into v_severe
    from public.disputes d join public.bookings b on b.id = d.booking_id
   where b.lender_id = v_user and d.severity = 'severe' and d.status not in ('resolved_refund', 'resolved_compensation', 'closed');
  v_trusted := app_private.is_trusted_lender(v_user);
  if v_verified then
    v_badges := v_badges || jsonb_build_array(jsonb_build_object('code', 'student_verified', 'label', 'Student verified'));
  end if;
  if v_trusted then
    v_badges := v_badges || jsonb_build_array(jsonb_build_object('code', 'trusted_lender', 'label', 'Verified Trusted Lender'));
  end if;
  return jsonb_build_object(
    'user_id', v_profile.id, 'full_name', v_profile.full_name, 'avatar_path', v_profile.avatar_path, 'member_since', v_profile.created_at,
    'is_student_verified', v_verified, 'completed_lendings', v_lend_count, 'completed_borrowings', v_borrow_count,
    'lender_rating', jsonb_build_object('avg', v_lender_avg, 'count', v_lender_reviews),
    'borrower_rating', jsonb_build_object('avg', v_borrower_avg, 'count', v_borrower_reviews),
    'badges', v_badges,
    'trusted_lender', jsonb_build_object(
      'earned', v_trusted, 'rule', v_rule,
      'rule_is_sample', coalesce((select is_sample from public.platform_settings where key = 'trusted_lender_rule' and is_current), true),
      'progress', jsonb_build_object('student_verified', v_verified, 'account_in_good_standing', v_profile.account_status = 'active',
        'completed_lendings', v_lend_count, 'avg_rating', v_lender_avg, 'unresolved_severe_disputes', v_severe)));
end
$$;

-- ── Availability (no booking identities leak) ─────────────────────────────
-- Holds whose payment window has passed no longer block dates (lazy expiry; processed in Phase 8).
create function app_private.listing_is_free(p_listing uuid, p_start date, p_end date) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (
           select 1 from public.bookings b
            where b.listing_id = p_listing
              and b.status in ('awaiting_payment', 'confirmed', 'active', 'overdue', 'return_requested', 'disputed')
              and (b.status <> 'awaiting_payment' or b.hold_expires_at > now())
              and daterange(b.pickup_date, b.return_date, '[]') && daterange(p_start, p_end, '[]'))
     and not exists (
           select 1 from public.listing_availability a
            where a.listing_id = p_listing and daterange(a.start_date, a.end_date, '[]') && daterange(p_start, p_end, '[]'))
$$;

create function app_private.require_browser() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated.no_session' using errcode = 'P0001', hint = 'Please sign in.';
  end if;
  if not (app_private.is_verified_student() or app_private.is_staff()) then
    raise exception 'forbidden.not_verified' using errcode = 'P0001', hint = 'Browsing opens once your student verification is approved.';
  end if;
end
$$;

-- Unavailable date ranges for one listing's calendar (merged; reason is generic).
create function public.get_listing_unavailable_dates(p_listing_id uuid, p_from date, p_to date)
returns table (start_date date, end_date date, reason text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_browser();
  if not app_private.can_view_listing(p_listing_id) then
    raise exception 'not_found.listing' using errcode = 'P0001', hint = 'This listing is no longer available.';
  end if;
  return query
    select greatest(b.pickup_date, p_from), least(b.return_date, p_to), 'booked'::text
      from public.bookings b
     where b.listing_id = p_listing_id
       and b.status in ('awaiting_payment', 'confirmed', 'active', 'overdue', 'return_requested', 'disputed')
       and (b.status <> 'awaiting_payment' or b.hold_expires_at > now())
       and b.return_date >= p_from and b.pickup_date <= p_to
    union all
    select greatest(a.start_date, p_from), least(a.end_date, p_to), 'unavailable'::text
      from public.listing_availability a
     where a.listing_id = p_listing_id and a.end_date >= p_from and a.start_date <= p_to
    order by 1;
end
$$;

-- ── Search ─────────────────────────────────────────────────────────────────
create function public.search_listings(
  p_query text default null,
  p_category text default null,
  p_start date default null,
  p_end date default null,
  p_min_rate bigint default null,
  p_max_rate bigint default null,
  p_conditions public.item_condition[] default null,
  p_trusted_only boolean default false,
  p_min_rating numeric default null,
  p_sort text default 'featured',
  p_limit integer default 30,
  p_offset integer default 0
) returns table (
  id uuid, title text, category text, category_label text, condition public.item_condition, daily_rate bigint, deposit bigint,
  late_fee_per_day bigint, is_featured boolean, published_at timestamptz, cover_path text, lender_id uuid, lender_name text,
  lender_rating numeric, lender_reviews integer, lender_trusted boolean, available_for_dates boolean, total_count bigint
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_q text := nullif(trim(coalesce(p_query, '')), '');
begin
  perform app_private.require_browser();
  if (p_start is null) <> (p_end is null) or (p_start is not null and p_end < p_start) then
    raise exception 'validation.dates' using errcode = 'P0001', hint = 'Choose both a pickup and a return date (return on or after pickup).';
  end if;
  if p_sort not in ('featured', 'newest', 'price_asc', 'price_desc', 'rating') then
    raise exception 'validation.sort' using errcode = 'P0001', hint = 'Unknown sort order.';
  end if;
  return query
  with base as (
    select l.*, c.label as cat_label, p.full_name as lname, r.avg as ravg, r.count as rcount,
           app_private.is_trusted_lender(l.lender_id) as trusted,
           case when p_start is null then true else app_private.listing_is_free(l.id, p_start, p_end) end as free,
           (select i.path from public.listing_images i where i.listing_id = l.id order by i.sort_order limit 1) as cover
      from public.listings l
      join public.listing_categories c on c.slug = l.category
      join public.profiles p on p.id = l.lender_id
      cross join lateral app_private.lender_rating(l.lender_id) r
     where l.status = 'active' and l.moderation_status <> 'hidden'
       and l.lender_id <> auth.uid()
       and (v_q is null or l.title ilike '%' || v_q || '%' or l.description ilike '%' || v_q || '%' or c.label ilike '%' || v_q || '%')
       and (p_category is null or l.category = p_category)
       and (p_min_rate is null or l.daily_rate >= p_min_rate)
       and (p_max_rate is null or l.daily_rate <= p_max_rate)
       and (p_conditions is null or cardinality(p_conditions) = 0 or l.condition = any (p_conditions))
  ), filtered as (
    select * from base b
     where b.free
       and (not coalesce(p_trusted_only, false) or b.trusted)
       and (p_min_rating is null or coalesce(b.ravg, 0) >= p_min_rating)
  )
  select f.id, f.title, f.category, f.cat_label, f.condition, f.daily_rate, f.deposit, f.late_fee_per_day, f.is_featured, f.published_at,
         f.cover, f.lender_id, f.lname, f.ravg, f.rcount, f.trusted, f.free, count(*) over ()
    from filtered f
   order by
     case when p_sort = 'featured' then f.is_featured end desc nulls last,
     case when p_sort = 'price_asc' then f.daily_rate end asc,
     case when p_sort = 'price_desc' then f.daily_rate end desc,
     case when p_sort = 'rating' then coalesce(f.ravg, 0) end desc,
     f.published_at desc nulls last, f.title
   limit least(greatest(coalesce(p_limit, 30), 1), 50) offset greatest(coalesce(p_offset, 0), 0);
end
$$;

-- ── Server price quote (the same numbers a booking snapshot will store) ────
create function app_private.price_quote(p_listing public.listings, p_pickup date, p_return date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_days integer := app_private.rental_days(p_pickup, p_return);
  v_bps integer := coalesce((app_private.setting('commission_bps'))::int, 1000);
  v_due_time time := coalesce((app_private.setting('return_due_time_local') #>> '{}')::time, '23:59');
  v_sub bigint := p_listing.daily_rate * v_days;
  v_comm bigint := app_private.commission_amount(v_sub, v_bps);
begin
  return jsonb_build_object(
    'listing_id', p_listing.id, 'pickup_date', p_pickup, 'return_date', p_return, 'rental_days', v_days,
    'daily_rate', p_listing.daily_rate, 'subtotal', v_sub, 'deposit', p_listing.deposit, 'total', v_sub + p_listing.deposit,
    'late_fee_per_day', p_listing.late_fee_per_day, 'commission_bps', v_bps, 'commission', v_comm, 'lender_net', v_sub - v_comm,
    'due_at', app_private.manila_timestamp(p_return, v_due_time), 'return_due_time_local', to_char(v_due_time, 'HH24:MI'));
end
$$;

create function public.quote_booking(p_listing_id uuid, p_pickup date, p_return date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.listings;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_max_days integer := coalesce((app_private.setting('max_rental_days'))::int, 30);
  v_max_ahead integer := coalesce((app_private.setting('max_advance_days'))::int, 90);
  v_quote jsonb;
begin
  perform app_private.require_browser();
  select * into v from public.listings where id = p_listing_id;
  if not found or v.status <> 'active' or v.moderation_status = 'hidden' then
    raise exception 'not_found.listing' using errcode = 'P0001', hint = 'This item isn’t available to rent right now.';
  end if;
  if v.lender_id = auth.uid() then
    raise exception 'forbidden.own_listing' using errcode = 'P0001', hint = 'You can’t rent your own listing.';
  end if;
  if p_pickup is null or p_return is null or p_return < p_pickup then
    raise exception 'validation.dates' using errcode = 'P0001', hint = 'The return date must be on or after the pickup date.';
  end if;
  if p_pickup < v_today then
    raise exception 'validation.pickup_past' using errcode = 'P0001', hint = 'Choose a pickup date from today onwards.';
  end if;
  if p_pickup > v_today + v_max_ahead then
    raise exception 'validation.pickup_too_far' using errcode = 'P0001', hint = 'Pickup can be at most ' || v_max_ahead || ' days ahead.';
  end if;
  if app_private.rental_days(p_pickup, p_return) > v_max_days then
    raise exception 'validation.too_long' using errcode = 'P0001', hint = 'A single rental can be at most ' || v_max_days || ' days.';
  end if;
  v_quote := app_private.price_quote(v, p_pickup, p_return);
  return v_quote || jsonb_build_object(
    'available', app_private.listing_is_free(v.id, p_pickup, p_return),
    'max_rental_days', v_max_days,
    'policy_version', (select version from public.cancellation_policy_versions where is_active),
    'rental_terms_version_id', (select id from public.terms_versions where doc_type = 'rental_terms' and is_active));
end
$$;

revoke all on function
  public.get_listing_unavailable_dates(uuid, date, date),
  public.search_listings(text, text, date, date, bigint, bigint, public.item_condition[], boolean, numeric, text, integer, integer),
  public.quote_booking(uuid, date, date)
from public, anon;
grant execute on function
  public.get_listing_unavailable_dates(uuid, date, date),
  public.search_listings(text, text, date, date, bigint, bigint, public.item_condition[], boolean, numeric, text, integer, integer),
  public.quote_booking(uuid, date, date)
to authenticated;
revoke execute on function app_private.lender_rating(uuid), app_private.is_trusted_lender(uuid), app_private.listing_is_free(uuid, date, date),
  app_private.require_browser(), app_private.price_quote(public.listings, date, date) from public, authenticated;
