-- Phase 11: reviews after completion, review reports/moderation, configurable account-health rule with
-- automatic pause, moderator account decisions, user appeals, restricted-lender visibility (plan §2.9, Phase 11).

insert into public.platform_settings (key, value, version, is_current, is_sample, description) values
  ('review_window_days', '30', 1, true, true, 'Days after completion during which each party can leave a review (sample).')
on conflict (key, version) do nothing;

-- ── Schema additions ───────────────────────────────────────────────────────
alter table public.reviews
  add column reported_by uuid references public.profiles (id) on delete set null,
  add column report_reason text check (report_reason is null or char_length(report_reason) <= 300),
  add column reported_at timestamptz,
  add column moderated_by uuid references public.profiles (id) on delete set null,
  add column moderation_note text check (moderation_note is null or char_length(moderation_note) <= 500),
  add column moderated_at timestamptz;
create index reviews_reported on public.reviews (reported_at) where is_reported;

-- Append-only history of account status changes (automatic rule or moderator), shown to the user and staff.
create table public.account_status_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  from_status public.account_status not null,
  to_status public.account_status not null,
  reason text not null check (char_length(reason) between 3 and 1000),
  actor_id uuid references public.profiles (id) on delete set null, -- null = automatic rule
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index account_status_events_user on public.account_status_events (user_id, created_at desc);
create trigger account_status_events_append_only before update or delete on public.account_status_events
  for each row execute function app_private.forbid_mutation();
alter table public.account_status_events enable row level security;
grant select on public.account_status_events to authenticated;
create policy account_status_events_read on public.account_status_events for select to authenticated
  using (user_id = (select auth.uid()) or app_private.is_staff());

-- ── Restricted lenders: their listings leave the marketplace (no new bookings, plan §2.9) ──
create or replace function app_private.can_view_listing(p_listing uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.listings l
     where l.id = p_listing
       and (
         l.lender_id = auth.uid()
         or app_private.is_staff()
         or (l.status = 'active' and l.moderation_status <> 'hidden' and app_private.is_verified_student()
             and exists (select 1 from public.profiles p where p.id = l.lender_id and p.account_status = 'active'))
         or exists (select 1 from public.bookings b where b.listing_id = l.id and auth.uid() in (b.borrower_id, b.lender_id))
       )
  )
$$;

create or replace function app_private.check_request_window(v public.listings, p_pickup date, p_return date) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_max_days integer := coalesce((app_private.setting('max_rental_days'))::int, 30);
  v_max_ahead integer := coalesce((app_private.setting('max_advance_days'))::int, 90);
begin
  if v.id is null or v.status <> 'active' or v.moderation_status = 'hidden'
     or not exists (select 1 from public.profiles p where p.id = v.lender_id and p.account_status = 'active') then
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
end
$$;

-- search_listings (migration 014) + lenders must be in good standing.
create or replace function public.search_listings(
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
       and p.account_status = 'active'
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

-- ── Account health (configurable sample rule) ──────────────────────────────
-- Eligible reviews: visible reviews the member received in either role.
create function app_private.account_health_metrics(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rule jsonb := coalesce(app_private.setting('account_health_rule'), '{"min_reviews": 3, "avg_below": 2.5, "action": "paused_pending_review"}'::jsonb);
  v_count integer;
  v_avg numeric;
  v_min integer := coalesce((v_rule ->> 'min_reviews')::int, 3);
  v_below numeric := coalesce((v_rule ->> 'avg_below')::numeric, 2.5);
begin
  select count(*)::int, round(avg(rating)::numeric, 2) into v_count, v_avg
    from public.reviews where target_id = p_user and moderation_status = 'visible';
  return jsonb_build_object(
    'review_count', v_count, 'avg_rating', v_avg,
    'rule', jsonb_build_object('min_reviews', v_min, 'avg_below', v_below, 'action', coalesce(v_rule ->> 'action', 'paused_pending_review')),
    'rule_is_sample', coalesce((select is_sample from public.platform_settings where key = 'account_health_rule' and is_current), true),
    'rule_met', v_count >= v_min and v_avg < v_below);
end
$$;

create function app_private.set_account_status(p_user uuid, p_to public.account_status, p_reason text, p_actor uuid, p_metadata jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_from public.account_status;
begin
  select account_status into v_from from public.profiles where id = p_user for update;
  if v_from is null or v_from = p_to then
    return;
  end if;
  update public.profiles set account_status = p_to, status_reason = case when p_to = 'active' then null else p_reason end, status_changed_at = now() where id = p_user;
  insert into public.account_status_events (user_id, from_status, to_status, reason, actor_id, metadata)
  values (p_user, v_from, p_to, p_reason, p_actor, coalesce(p_metadata, '{}'::jsonb));
  perform app_private.audit('account.' || p_to, 'profile', p_user::text, coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('from', v_from, 'reason', p_reason));
end
$$;

-- Applies the rule to an active account (never more than once per breach; one low rating never triggers it).
create function app_private.evaluate_account_health(p_user uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  m jsonb := app_private.account_health_metrics(p_user);
  v_action public.account_status;
  v_reason text;
begin
  if not (m ->> 'rule_met')::boolean then
    return false;
  end if;
  if not exists (select 1 from public.profiles where id = p_user and account_status = 'active') then
    return false;
  end if;
  v_action := coalesce(m -> 'rule' ->> 'action', 'paused_pending_review')::public.account_status;
  v_reason := 'Automatic review: ' || (m ->> 'review_count') || ' ratings averaging ' || (m ->> 'avg_rating')
    || ' (sample rule: at least ' || (m -> 'rule' ->> 'min_reviews') || ' ratings averaging below ' || (m -> 'rule' ->> 'avg_below')
    || '). New rentals and listings are paused while a moderator reviews your account.';
  perform app_private.set_account_status(p_user, v_action, v_reason, null, jsonb_build_object('automatic', true, 'metrics', m));
  perform app_private.notify(p_user, 'account.paused', 'Account paused for review', v_reason, 'profile', p_user,
    'account:' || p_user || ':auto:' || extract(epoch from now())::bigint);
  perform app_private.notify_staff('account.review', 'Account needs review', 'The low-rating rule paused an account.', 'profile', p_user,
    'account:' || p_user || ':auto:' || extract(epoch from now())::bigint || ':staff');
  return true;
end
$$;

-- ── Reviews (plan §2.9) ────────────────────────────────────────────────────
create function public.submit_review(p_booking_id uuid, p_rating integer, p_comment text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  v_me uuid := auth.uid();
  v_target uuid;
  v_direction public.review_direction;
  v_comment text := nullif(trim(coalesce(p_comment, '')), '');
  v_window integer := coalesce((app_private.setting('review_window_days'))::int, 30);
  v_id uuid;
  v_name text;
begin
  select * into b from public.bookings where id = p_booking_id;
  if v_me is null or b.id is null or v_me not in (b.borrower_id, b.lender_id) then
    raise exception 'not_found.booking' using errcode = 'P0001', hint = 'You can only review your own rentals.';
  end if;
  if b.status <> 'completed' then
    raise exception 'conflict.not_completed' using errcode = 'P0001', hint = 'You can leave a review once the rental is completed.';
  end if;
  if b.completed_at is not null and now() > b.completed_at + make_interval(days => v_window) then
    raise exception 'conflict.review_window' using errcode = 'P0001', hint = 'Reviews can be left within ' || v_window || ' days of completion.';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'validation.rating' using errcode = 'P0001', hint = 'Choose 1 to 5 stars.';
  end if;
  if v_comment is not null and char_length(v_comment) > 1000 then
    raise exception 'validation.comment' using errcode = 'P0001', hint = 'Keep the comment under 1,000 characters.';
  end if;
  v_target := case when v_me = b.borrower_id then b.lender_id else b.borrower_id end;
  v_direction := case when v_me = b.borrower_id then 'borrower_to_lender' else 'lender_to_borrower' end;
  begin
    insert into public.reviews (booking_id, reviewer_id, target_id, direction, rating, comment)
    values (b.id, v_me, v_target, v_direction, p_rating, v_comment) returning id into v_id;
  exception when unique_violation then
    raise exception 'conflict.already_reviewed' using errcode = 'P0001', hint = 'You’ve already reviewed this rental.';
  end;
  select full_name into v_name from public.profiles where id = v_me;
  perform app_private.notify(v_target, 'review.received', 'New review',
    coalesce(split_part(v_name, ' ', 1), 'A student') || ' rated you ' || p_rating || '/5 for ' || coalesce(b.snapshot ->> 'listing_title', 'a rental') || '.',
    'profile', v_target, 'review:' || v_id);
  perform app_private.evaluate_account_health(v_target);
  return v_id;
end
$$;

create function public.report_review(p_review_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.reviews; v_reason text := trim(coalesce(p_reason, ''));
begin
  select * into r from public.reviews where id = p_review_id for update;
  if auth.uid() is null or r.id is null or not (r.moderation_status = 'visible' or auth.uid() in (r.reviewer_id, r.target_id)) then
    raise exception 'not_found.review' using errcode = 'P0001', hint = 'This review isn’t available.';
  end if;
  if not (app_private.is_verified_student() or app_private.is_staff() or auth.uid() = r.target_id) then
    raise exception 'forbidden.not_verified' using errcode = 'P0001', hint = 'Only verified students can report reviews.';
  end if;
  if auth.uid() = r.reviewer_id then
    raise exception 'forbidden.own_review' using errcode = 'P0001', hint = 'You can’t report your own review.';
  end if;
  if char_length(v_reason) not between 3 and 300 then
    raise exception 'validation.reason' using errcode = 'P0001', hint = 'Tell moderators what’s wrong (3 to 300 characters).';
  end if;
  if r.is_reported then
    return; -- already in the queue; a report never hides a review by itself
  end if;
  update public.reviews set is_reported = true, reported_by = auth.uid(), report_reason = v_reason, reported_at = now() where id = r.id;
  perform app_private.notify_staff('review.reported', 'Review reported', left(v_reason, 140), 'review', r.id, 'review:' || r.id || ':reported');
end
$$;

-- Moderator: keep (clears the report) or hide (excluded from ratings, badges and the low-rating rule).
create function public.moderate_review(p_review_id uuid, p_action text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.reviews; v_note text := trim(coalesce(p_note, ''));
begin
  if not app_private.is_staff() then
    raise exception 'forbidden.staff_only' using errcode = 'P0001', hint = 'Only TigRent moderators moderate reviews.';
  end if;
  if p_action is null or p_action not in ('keep', 'hide', 'restore') then
    raise exception 'validation.action' using errcode = 'P0001', hint = 'Choose keep, hide or restore.';
  end if;
  if char_length(v_note) not between 3 and 500 then
    raise exception 'validation.note' using errcode = 'P0001', hint = 'Add a short moderation note (3 to 500 characters).';
  end if;
  select * into r from public.reviews where id = p_review_id for update;
  if r.id is null then
    raise exception 'not_found.review' using errcode = 'P0001', hint = 'This review no longer exists.';
  end if;
  update public.reviews set
    moderation_status = case p_action when 'hide' then 'hidden' else 'visible' end::public.review_moderation,
    is_reported = false, moderated_by = auth.uid(), moderated_at = now(), moderation_note = v_note
  where id = r.id;
  perform app_private.audit('review.' || p_action, 'review', r.id::text, jsonb_build_object('note', v_note, 'target_id', r.target_id, 'rating', r.rating));
  if p_action = 'hide' then
    perform app_private.notify(r.reviewer_id, 'review.hidden', 'Your review was hidden', 'A moderator hid your review: ' || v_note, 'profile', r.reviewer_id, 'review:' || r.id || ':hidden:' || extract(epoch from now())::bigint);
  end if;
  if p_action = 'restore' then
    perform app_private.evaluate_account_health(r.target_id);
  end if;
end
$$;

create function public.list_reviews(p_user_id uuid, p_direction text default null) returns table (
  id uuid, rating smallint, comment text, created_at timestamptz, direction public.review_direction, reviewer_first_name text,
  listing_title text, is_mine boolean, can_report boolean, is_reported boolean, moderation_status public.review_moderation
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated.no_session' using errcode = 'P0001', hint = 'Please sign in.';
  end if;
  if p_user_id <> auth.uid() and not (app_private.is_verified_student() or app_private.is_staff()) then
    raise exception 'forbidden.not_verified' using errcode = 'P0001', hint = 'Only verified students can view member reviews.';
  end if;
  return query
    select r.id, r.rating, r.comment, r.created_at, r.direction, split_part(p.full_name, ' ', 1),
           b.snapshot ->> 'listing_title', r.reviewer_id = auth.uid(),
           r.reviewer_id <> auth.uid() and not r.is_reported and r.moderation_status = 'visible',
           r.is_reported, r.moderation_status
      from public.reviews r
      join public.profiles p on p.id = r.reviewer_id
      join public.bookings b on b.id = r.booking_id
     where r.target_id = p_user_id
       and (p_direction is null or r.direction::text = p_direction)
       and (r.moderation_status = 'visible' or app_private.is_staff() or auth.uid() in (r.reviewer_id, r.target_id))
     order by r.created_at desc
     limit 100;
end
$$;

-- Completed rentals the caller can still review (prompts on dashboards and the booking).
create function public.list_review_prompts() returns table (
  booking_id uuid, listing_title text, counterpart_name text, my_role text, completed_at timestamptz, review_until timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare v_window integer := coalesce((app_private.setting('review_window_days'))::int, 30);
begin
  if auth.uid() is null then
    raise exception 'unauthenticated.no_session' using errcode = 'P0001', hint = 'Please sign in.';
  end if;
  return query
    select b.id, coalesce(b.snapshot ->> 'listing_title', ''),
           (select p.full_name from public.profiles p where p.id = case when b.borrower_id = auth.uid() then b.lender_id else b.borrower_id end),
           case when b.borrower_id = auth.uid() then 'borrower' else 'lender' end,
           b.completed_at, b.completed_at + make_interval(days => v_window)
      from public.bookings b
     where auth.uid() in (b.borrower_id, b.lender_id) and b.status = 'completed'
       and b.completed_at > now() - make_interval(days => v_window)
       and not exists (select 1 from public.reviews r where r.booking_id = b.id and r.reviewer_id = auth.uid())
     order by b.completed_at desc;
end
$$;

-- The reviews on one booking, for its parties (mine + theirs) and staff.
create function public.get_booking_reviews(p_booking_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare b public.bookings; v_window integer := coalesce((app_private.setting('review_window_days'))::int, 30);
begin
  select * into b from public.bookings where id = p_booking_id;
  if auth.uid() is null or b.id is null or not (auth.uid() in (b.borrower_id, b.lender_id) or app_private.is_staff()) then
    raise exception 'not_found.booking' using errcode = 'P0001', hint = 'This booking isn’t yours or no longer exists.';
  end if;
  return jsonb_build_object(
    'can_review', b.status = 'completed' and auth.uid() in (b.borrower_id, b.lender_id)
                  and (b.completed_at is null or now() <= b.completed_at + make_interval(days => v_window))
                  and not exists (select 1 from public.reviews r where r.booking_id = b.id and r.reviewer_id = auth.uid()),
    'review_until', case when b.completed_at is not null then b.completed_at + make_interval(days => v_window) end,
    'mine', (select jsonb_build_object('id', r.id, 'rating', r.rating, 'comment', r.comment, 'created_at', r.created_at, 'moderation_status', r.moderation_status)
               from public.reviews r where r.booking_id = b.id and r.reviewer_id = auth.uid()),
    'theirs', (select jsonb_build_object('id', r.id, 'rating', r.rating, 'comment', r.comment, 'created_at', r.created_at, 'moderation_status', r.moderation_status,
                                         'is_reported', r.is_reported)
                 from public.reviews r where r.booking_id = b.id and r.target_id = auth.uid() and r.moderation_status <> 'hidden'));
end
$$;

-- ── Account appeals (plan §2.9) ────────────────────────────────────────────
create function public.submit_account_appeal(p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_reason text := trim(coalesce(p_reason, ''));
  v_status public.account_status;
  a public.account_appeals;
begin
  select account_status into v_status from public.profiles where id = v_me;
  if v_me is null or v_status is null then
    raise exception 'unauthenticated.no_session' using errcode = 'P0001', hint = 'Please sign in.';
  end if;
  if v_status = 'active' then
    raise exception 'conflict.not_restricted' using errcode = 'P0001', hint = 'Your account is in good standing; there is nothing to appeal.';
  end if;
  if char_length(v_reason) not between 10 and 2000 then
    raise exception 'validation.reason' using errcode = 'P0001', hint = 'Explain your appeal in 10 to 2,000 characters.';
  end if;
  select * into a from public.account_appeals where user_id = v_me and status in ('open', 'under_review', 'needs_info') for update;
  if a.id is not null then
    if a.status <> 'needs_info' then
      raise exception 'conflict.appeal_open' using errcode = 'P0001', hint = 'Your appeal is already with a moderator.';
    end if;
    -- More information requested: add it to the same appeal and send it back to the queue.
    update public.account_appeals set reason = left(reason || E'\n\nMore information: ' || v_reason, 2000), status = 'open' where id = a.id;
    perform app_private.notify_staff('appeal.updated', 'Appeal updated', 'A member added the information you asked for.', 'appeal', a.id, 'appeal:' || a.id || ':info:' || extract(epoch from now())::bigint);
    return a.id;
  end if;
  insert into public.account_appeals (user_id, reason) values (v_me, v_reason) returning * into a;
  perform app_private.notify_staff('appeal.submitted', 'New account appeal', left(v_reason, 140), 'appeal', a.id, 'appeal:' || a.id || ':submitted');
  perform app_private.audit('appeal.submitted', 'account_appeal', a.id::text, '{}'::jsonb);
  return a.id;
end
$$;

-- Moderator decision on an account: lift, restrict, suspend, or ask for more information (with an open appeal).
create function public.moderate_account(p_user_id uuid, p_decision text, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_note text := trim(coalesce(p_note, ''));
  a public.account_appeals;
  v_to public.account_status;
  v_from public.account_status;
begin
  if not app_private.is_staff() then
    raise exception 'forbidden.staff_only' using errcode = 'P0001', hint = 'Only TigRent moderators can change account status.';
  end if;
  if p_decision is null or p_decision not in ('lift', 'restrict', 'suspend', 'request_info') then
    raise exception 'validation.decision' using errcode = 'P0001', hint = 'Choose lift, restrict, suspend or request information.';
  end if;
  if p_decision = 'suspend' and not app_private.has_role('admin') then
    raise exception 'forbidden.admin_only' using errcode = 'P0001', hint = 'Only administrators can suspend accounts.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'forbidden.self' using errcode = 'P0001', hint = 'You can’t moderate your own account.';
  end if;
  if char_length(v_note) not between 10 and 1000 then
    raise exception 'validation.note' using errcode = 'P0001', hint = 'Explain the decision to the member (10 to 1,000 characters).';
  end if;
  select account_status into v_from from public.profiles where id = p_user_id;
  if v_from is null then
    raise exception 'not_found.profile' using errcode = 'P0001', hint = 'This member could not be found.';
  end if;
  select * into a from public.account_appeals where user_id = p_user_id and status in ('open', 'under_review', 'needs_info') for update;

  if p_decision = 'request_info' then
    if a.id is null then
      raise exception 'conflict.no_appeal' using errcode = 'P0001', hint = 'There is no open appeal to ask about.';
    end if;
    update public.account_appeals set status = 'needs_info', moderator_id = auth.uid(), moderator_note = v_note where id = a.id;
    perform app_private.notify(p_user_id, 'appeal.needs_info', 'More information needed', v_note, 'profile', p_user_id, 'appeal:' || a.id || ':needs_info:' || extract(epoch from now())::bigint);
    perform app_private.audit('appeal.needs_info', 'account_appeal', a.id::text, jsonb_build_object('note', v_note));
    return jsonb_build_object('account_status', v_from, 'appeal_status', 'needs_info');
  end if;

  v_to := case p_decision when 'lift' then 'active' when 'restrict' then 'restricted' else 'suspended' end::public.account_status;
  perform app_private.set_account_status(p_user_id, v_to, v_note, auth.uid(), jsonb_build_object('decision', p_decision));
  if a.id is not null then
    update public.account_appeals set status = case when p_decision = 'lift' then 'lifted' else 'upheld' end::public.appeal_status,
      moderator_id = auth.uid(), moderator_note = v_note, decided_at = now() where id = a.id;
  end if;
  perform app_private.notify(p_user_id, 'account.' || v_to,
    case p_decision when 'lift' then 'Account restored' when 'restrict' then 'Account restricted' else 'Account suspended' end,
    v_note, 'profile', p_user_id, 'account:' || p_user_id || ':' || p_decision || ':' || extract(epoch from now())::bigint);
  return jsonb_build_object('account_status', v_to, 'appeal_status', case when a.id is null then null when p_decision = 'lift' then 'lifted' else 'upheld' end);
end
$$;

-- The member's own account health (restricted screen, profile).
create function public.get_my_account_health() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles; a public.account_appeals;
begin
  select * into p from public.profiles where id = auth.uid();
  if p.id is null then
    raise exception 'unauthenticated.no_session' using errcode = 'P0001', hint = 'Please sign in.';
  end if;
  select * into a from public.account_appeals where user_id = p.id order by created_at desc limit 1;
  return jsonb_build_object(
    'account_status', p.account_status, 'status_reason', p.status_reason, 'metrics', app_private.account_health_metrics(p.id),
    'appeal', case when a.id is null then null else jsonb_build_object('id', a.id, 'status', a.status, 'reason', a.reason, 'moderator_note', a.moderator_note,
                                                                       'created_at', a.created_at, 'decided_at', a.decided_at) end,
    'history', coalesce((select jsonb_agg(jsonb_build_object('from', e.from_status, 'to', e.to_status, 'reason', e.reason, 'automatic', e.actor_id is null, 'at', e.created_at)
                                          order by e.created_at desc)
                           from public.account_status_events e where e.user_id = p.id), '[]'::jsonb),
    'open_obligations', (select count(*) from public.bookings b where p.id in (b.borrower_id, b.lender_id)
                          and b.status in ('confirmed', 'active', 'overdue', 'return_requested', 'disputed')));
end
$$;

-- Moderator queue: accounts that aren't active, open appeals, and accounts the rule currently flags.
create function public.list_account_reviews() returns table (
  user_id uuid, full_name text, account_status public.account_status, status_reason text, review_count integer, avg_rating numeric,
  rule_met boolean, appeal_id uuid, appeal_status public.appeal_status, open_obligations integer, updated_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_staff() then
    raise exception 'forbidden.staff_only' using errcode = 'P0001', hint = 'Moderators only.';
  end if;
  return query
    select p.id, p.full_name, p.account_status, p.status_reason, (m ->> 'review_count')::int, (m ->> 'avg_rating')::numeric, (m ->> 'rule_met')::boolean,
           ap.id, ap.status,
           (select count(*)::int from public.bookings b where p.id in (b.borrower_id, b.lender_id) and b.status in ('confirmed', 'active', 'overdue', 'return_requested', 'disputed')),
           greatest(p.updated_at, ap.created_at)
      from public.profiles p
      cross join lateral app_private.account_health_metrics(p.id) m
      left join lateral (select x.id, x.status, x.created_at from public.account_appeals x where x.user_id = p.id and x.status in ('open', 'under_review', 'needs_info')
                          order by x.created_at desc limit 1) ap on true
     where p.account_status <> 'active' or ap.id is not null or (m ->> 'rule_met')::boolean
     order by (ap.status = 'open') desc nulls last, p.updated_at desc
     limit 200;
end
$$;

-- One member's full account picture for moderators.
create function public.get_account_review(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles; a public.account_appeals;
begin
  if not app_private.is_staff() then
    raise exception 'forbidden.staff_only' using errcode = 'P0001', hint = 'Moderators only.';
  end if;
  select * into p from public.profiles where id = p_user_id;
  if p.id is null then
    raise exception 'not_found.profile' using errcode = 'P0001', hint = 'This member could not be found.';
  end if;
  select * into a from public.account_appeals where user_id = p.id order by created_at desc limit 1;
  return jsonb_build_object(
    'user_id', p.id, 'full_name', p.full_name, 'account_status', p.account_status, 'status_reason', p.status_reason, 'member_since', p.created_at,
    'metrics', app_private.account_health_metrics(p.id),
    'appeal', case when a.id is null then null else jsonb_build_object('id', a.id, 'status', a.status, 'reason', a.reason, 'moderator_note', a.moderator_note,
                                                                       'created_at', a.created_at, 'decided_at', a.decided_at) end,
    'history', coalesce((select jsonb_agg(jsonb_build_object('from', e.from_status, 'to', e.to_status, 'reason', e.reason, 'automatic', e.actor_id is null, 'at', e.created_at)
                                          order by e.created_at desc) from public.account_status_events e where e.user_id = p.id), '[]'::jsonb),
    'open_obligations', (select count(*) from public.bookings b where p.id in (b.borrower_id, b.lender_id)
                          and b.status in ('confirmed', 'active', 'overdue', 'return_requested', 'disputed')),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'rating', r.rating, 'comment', r.comment, 'direction', r.direction, 'created_at', r.created_at,
                                                             'moderation_status', r.moderation_status, 'is_reported', r.is_reported, 'report_reason', r.report_reason)
                                          order by r.created_at desc) from public.reviews r where r.target_id = p.id), '[]'::jsonb));
end
$$;

-- Reported reviews queue.
create function public.list_reported_reviews() returns table (
  id uuid, rating smallint, comment text, direction public.review_direction, report_reason text, reported_at timestamptz,
  reviewer_name text, target_id uuid, target_name text, listing_title text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_staff() then
    raise exception 'forbidden.staff_only' using errcode = 'P0001', hint = 'Moderators only.';
  end if;
  return query
    select r.id, r.rating, r.comment, r.direction, r.report_reason, r.reported_at,
           (select x.full_name from public.profiles x where x.id = r.reviewer_id), r.target_id,
           (select y.full_name from public.profiles y where y.id = r.target_id), b.snapshot ->> 'listing_title'
      from public.reviews r join public.bookings b on b.id = r.booking_id
     where r.is_reported
     order by r.reported_at;
end
$$;

-- ── Seed alignment: Rico's seeded pause gets a matching history entry ──────
insert into public.account_status_events (user_id, from_status, to_status, reason, actor_id, metadata)
select p.id, 'active', p.account_status, coalesce(p.status_reason, 'Paused by the sample low-rating rule.'), null, '{"automatic": true, "seed": true}'
  from public.profiles p
 where p.account_status <> 'active'
   and not exists (select 1 from public.account_status_events e where e.user_id = p.id);

-- ── Grants ─────────────────────────────────────────────────────────────────
revoke all on function
  public.submit_review(uuid, integer, text), public.report_review(uuid, text), public.moderate_review(uuid, text, text),
  public.list_reviews(uuid, text), public.list_review_prompts(), public.get_booking_reviews(uuid),
  public.submit_account_appeal(text), public.moderate_account(uuid, text, text), public.get_my_account_health(),
  public.list_account_reviews(), public.get_account_review(uuid), public.list_reported_reviews()
from public, anon;
grant execute on function
  public.submit_review(uuid, integer, text), public.report_review(uuid, text), public.moderate_review(uuid, text, text),
  public.list_reviews(uuid, text), public.list_review_prompts(), public.get_booking_reviews(uuid),
  public.submit_account_appeal(text), public.moderate_account(uuid, text, text), public.get_my_account_health(),
  public.list_account_reviews(), public.get_account_review(uuid), public.list_reported_reviews()
to authenticated;
revoke execute on function
  app_private.account_health_metrics(uuid), app_private.set_account_status(uuid, public.account_status, text, uuid, jsonb),
  app_private.evaluate_account_health(uuid)
from public, authenticated;
