-- Phase 9: rental lifecycle after checkout: handover, booking messages, reminders/overdue, extensions,
-- returns (plan §2.7, §2.8, Phase 9). Late fees, deposit withholding and disputes are Phase 10.

-- Sample settings (admin-configurable in Phase 12; also listed in seed.sql so a demo reset keeps them).
insert into public.platform_settings (key, value, version, is_current, is_sample, description) values
  ('handover_opens_days_before', '1', 1, true, true, 'How many days before the pickup date the handover can be confirmed (sample).'),
  ('reminder_due_soon_hours', '24', 1, true, true, 'Remind both parties this many hours before an item is due (sample).'),
  ('reminder_followup_hours', '6', 1, true, true, 'Nudge the lender about an undecided extension or an uninspected return after this many hours (sample).')
on conflict (key, version) do nothing;

-- ── Shared helpers ─────────────────────────────────────────────────────────

-- A non-status event in a booking's history (handover step, extension, message milestones…).
create function app_private.log_booking_note(b public.bookings, p_kind text, p_actor uuid, p_reason text, p_metadata jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.booking_events (booking_id, actor_id, from_status, to_status, reason, metadata)
  values (b.id, p_actor, b.status, b.status, p_reason, coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('kind', p_kind))
$$;

-- Late days: each started 24 h after the agreed due time (sample rule `late_day_rounding`); never before it.
create function app_private.late_days(p_due timestamptz, p_returned timestamptz) returns integer
language sql immutable set search_path = '' as $$
  select case when p_returned is null or p_returned <= p_due then 0
              else ceil(extract(epoch from (p_returned - p_due)) / 86400.0)::int end
$$;

-- The booking's agreed local due time (snapshot), falling back to the current setting.
create function app_private.booking_due_time(b public.bookings) returns time
language sql stable security definer set search_path = '' as $$
  select coalesce((b.snapshot ->> 'return_due_time_local')::time,
                  (app_private.setting('return_due_time_local') #>> '{}')::time, '23:59'::time)
$$;

-- Evidence photos must be the caller's own uploads in this booking's private folder (max 4).
create function app_private.check_evidence_paths(p_booking uuid, p_paths text[]) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  v_paths text[] := coalesce(p_paths, '{}');
  p text;
begin
  if cardinality(v_paths) > 4 then
    raise exception 'validation.photos' using errcode = 'P0001', hint = 'Add up to 4 photos.';
  end if;
  foreach p in array v_paths loop
    if p not like p_booking::text || '/' || auth.uid()::text || '/%'
       or not exists (select 1 from storage.objects o where o.bucket_id = 'evidence' and o.name = p) then
      raise exception 'validation.photo_path' using errcode = 'P0001', hint = 'A photo didn’t finish uploading. Remove it and try again.';
    end if;
  end loop;
  return v_paths;
end
$$;

create function app_private.check_note(p_text text, p_max integer default 1000) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := nullif(trim(coalesce(p_text, '')), '');
begin
  if v is not null and char_length(v) > p_max then
    raise exception 'validation.notes' using errcode = 'P0001', hint = 'Keep notes under ' || p_max || ' characters.';
  end if;
  return v;
end
$$;

-- Approved extensions hold their extra days while the borrower pays (plan §2.8).
create function app_private.extension_hold_overlaps(p_listing uuid, p_start date, p_end date, p_except_booking uuid default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.extension_requests e join public.bookings b on b.id = e.booking_id
     where b.listing_id = p_listing and b.id is distinct from p_except_booking
       and e.status = 'approved_awaiting_payment' and e.hold_expires_at > now()
       and daterange(e.old_return_date + 1, e.new_return_date, '[]') && daterange(p_start, p_end, '[]'))
$$;

-- listing_is_free (migration 014) now also respects extension holds.
create or replace function app_private.listing_is_free(p_listing uuid, p_start date, p_end date) returns boolean
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
     and not app_private.extension_hold_overlaps(p_listing, p_start, p_end)
$$;

-- Calendar ranges (migration 014) now include extension holds, still without booking identities.
create or replace function public.get_listing_unavailable_dates(p_listing_id uuid, p_from date, p_to date)
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
    select greatest(e.old_return_date + 1, p_from), least(e.new_return_date, p_to), 'booked'::text
      from public.extension_requests e join public.bookings b on b.id = e.booking_id
     where b.listing_id = p_listing_id and e.status = 'approved_awaiting_payment' and e.hold_expires_at > now()
       and e.new_return_date >= p_from and e.old_return_date + 1 <= p_to
    union all
    select greatest(a.start_date, p_from), least(a.end_date, p_to), 'unavailable'::text
      from public.listing_availability a
     where a.listing_id = p_listing_id and a.end_date >= p_from and a.start_date <= p_to
    order by 1;
end
$$;

-- request_conflict (migration 015) now also respects extension holds.
create or replace function app_private.request_conflict(b public.bookings) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when b.status <> 'pending_lender_approval' then null
    when exists (select 1 from public.listings l where l.id = b.listing_id and (l.status = 'removed' or l.moderation_status = 'hidden')) then 'listing_unavailable'
    when b.pickup_date < (now() at time zone 'Asia/Manila')::date then 'pickup_passed'
    when exists (
      select 1 from public.bookings o
       where o.listing_id = b.listing_id and o.id <> b.id
         and o.status in ('awaiting_payment', 'confirmed', 'active', 'overdue', 'return_requested', 'disputed')
         and (o.status <> 'awaiting_payment' or o.hold_expires_at > now())
         and daterange(o.pickup_date, o.return_date, '[]') && daterange(b.pickup_date, b.return_date, '[]'))
      or app_private.extension_hold_overlaps(b.listing_id, b.pickup_date, b.return_date, b.id) then 'dates_taken'
    when exists (
      select 1 from public.listing_availability a
       where a.listing_id = b.listing_id and daterange(a.start_date, a.end_date, '[]') && daterange(b.pickup_date, b.return_date, '[]')) then 'dates_blocked'
    else null
  end
$$;

-- Why an extension's extra days can't be held (null = free).
create function app_private.extension_conflict(b public.bookings, p_new_return date) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (
      select 1 from public.bookings o
       where o.listing_id = b.listing_id and o.id <> b.id
         and o.status in ('awaiting_payment', 'confirmed', 'active', 'overdue', 'return_requested', 'disputed')
         and (o.status <> 'awaiting_payment' or o.hold_expires_at > now())
         and daterange(o.pickup_date, o.return_date, '[]') && daterange(b.return_date + 1, p_new_return, '[]'))
      or app_private.extension_hold_overlaps(b.listing_id, b.return_date + 1, p_new_return, b.id) then 'dates_taken'
    when exists (
      select 1 from public.listing_availability a
       where a.listing_id = b.listing_id and daterange(a.start_date, a.end_date, '[]') && daterange(b.return_date + 1, p_new_return, '[]')) then 'dates_blocked'
    else null
  end
$$;

-- Party guard: the booking row, locked. Callers derive their side from it.
create function app_private.lock_party_booking(p_booking_id uuid) returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated.no_session' using errcode = 'P0001', hint = 'Please sign in.';
  end if;
  select * into b from public.bookings where id = p_booking_id for update;
  if b.id is null or auth.uid() not in (b.borrower_id, b.lender_id) then
    raise exception 'not_found.booking' using errcode = 'P0001', hint = 'This booking isn’t yours or no longer exists.';
  end if;
  return b;
end
$$;

-- ── Booking conversations (plan §4.1, Phase 9) ─────────────────────────────
create function app_private.ensure_booking_conversation(p_booking uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from public.conversations where booking_id = p_booking;
  if v_id is null then
    insert into public.conversations (kind, booking_id) values ('booking', p_booking)
    on conflict do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from public.conversations where booking_id = p_booking;
    end if;
  end if;
  insert into public.conversation_participants (conversation_id, user_id)
  select v_id, u from public.bookings b, unnest(array[b.borrower_id, b.lender_id]) u where b.id = p_booking
  on conflict do nothing;
  return v_id;
end
$$;

create function app_private.on_booking_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.ensure_booking_conversation(new.id);
  return new;
end
$$;
create trigger bookings_conversation after insert on public.bookings
  for each row execute function app_private.on_booking_created();

-- Backfill: every existing booking gets its conversation.
select app_private.ensure_booking_conversation(b.id) from public.bookings b
 where not exists (select 1 from public.conversations c where c.booking_id = b.id);

-- Messages can be sent while the booking is live or recently finished; declined/cancelled/expired requests close it.
create function app_private.conversation_closed_reason(p_status public.booking_status) returns text
language sql immutable set search_path = '' as $$
  select case when p_status in ('rejected', 'cancelled', 'payment_expired')
              then 'This booking was ' || case p_status when 'rejected' then 'declined' when 'cancelled' then 'cancelled' else 'not paid in time' end || ', so messaging is closed.'
         end
$$;

create function public.send_message(p_conversation_id uuid, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_body text := trim(coalesce(p_body, ''));
  c public.conversations;
  b public.bookings;
  v_other uuid;
  v_other_read timestamptz;
  v_id uuid;
  v_name text;
begin
  if v_me is null then
    raise exception 'unauthenticated.no_session' using errcode = 'P0001', hint = 'Please sign in.';
  end if;
  select * into c from public.conversations where id = p_conversation_id;
  if c.id is null or not exists (select 1 from public.conversation_participants where conversation_id = c.id and user_id = v_me) then
    raise exception 'not_found.conversation' using errcode = 'P0001', hint = 'This conversation isn’t available.';
  end if;
  if c.status <> 'open' then
    raise exception 'conflict.conversation_closed' using errcode = 'P0001', hint = 'This conversation is closed.';
  end if;
  select * into b from public.bookings where id = c.booking_id;
  if app_private.conversation_closed_reason(b.status) is not null then
    raise exception 'conflict.conversation_closed' using errcode = 'P0001', hint = app_private.conversation_closed_reason(b.status);
  end if;
  if char_length(v_body) not between 1 and 2000 then
    raise exception 'validation.body' using errcode = 'P0001', hint = 'Write a message of up to 2,000 characters.';
  end if;
  insert into public.messages (conversation_id, sender_id, body) values (c.id, v_me, v_body) returning id into v_id;
  update public.conversation_participants set last_read_at = now() where conversation_id = c.id and user_id = v_me;
  select user_id, last_read_at into v_other, v_other_read
    from public.conversation_participants where conversation_id = c.id and user_id <> v_me limit 1;
  select full_name into v_name from public.profiles where id = v_me;
  -- One notification per unread stretch: the key changes only after the recipient reads the thread.
  if v_other is not null then
    perform app_private.notify(v_other, 'message.new', 'New message from ' || coalesce(split_part(v_name, ' ', 1), 'a student'),
      left(v_body, 140) || case when char_length(v_body) > 140 then '…' else '' end,
      'conversation', c.id, 'message:' || c.id || ':' || v_other || ':' || coalesce(extract(epoch from v_other_read)::bigint, 0));
  end if;
  return v_id;
end
$$;

create function public.mark_conversation_read(p_conversation_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.conversation_participants set last_read_at = now()
   where conversation_id = p_conversation_id and user_id = auth.uid();
  if not found then
    raise exception 'not_found.conversation' using errcode = 'P0001', hint = 'This conversation isn’t available.';
  end if;
  update public.notifications set read_at = now()
   where user_id = auth.uid() and entity_type = 'conversation' and entity_id = p_conversation_id and read_at is null;
end
$$;

create function public.get_conversation(p_conversation_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  c public.conversations;
  b public.bookings;
  v_other uuid;
  v_other_read timestamptz;
begin
  select * into c from public.conversations where id = p_conversation_id;
  if v_me is null or c.id is null
     or not (exists (select 1 from public.conversation_participants where conversation_id = c.id and user_id = v_me) or app_private.is_staff()) then
    raise exception 'not_found.conversation' using errcode = 'P0001', hint = 'This conversation isn’t available.';
  end if;
  select * into b from public.bookings where id = c.booking_id;
  v_other := case when v_me = b.borrower_id then b.lender_id else b.borrower_id end;
  select last_read_at into v_other_read from public.conversation_participants where conversation_id = c.id and user_id = v_other;
  return jsonb_build_object(
    'id', c.id, 'booking_id', b.id, 'booking_status', b.status, 'listing_title', b.snapshot ->> 'listing_title',
    'pickup_date', b.pickup_date, 'return_date', b.return_date,
    'my_role', case when v_me = b.borrower_id then 'borrower' when v_me = b.lender_id then 'lender' else 'staff' end,
    'counterpart', jsonb_build_object('id', v_other, 'full_name', (select full_name from public.profiles where id = v_other)),
    'closed_reason', coalesce(app_private.conversation_closed_reason(b.status), case when c.status <> 'open' then 'This conversation is closed.' end),
    'other_last_read_at', v_other_read,
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'body', m.body, 'sender_is_me', m.sender_id = v_me, 'created_at', m.created_at)
                                           order by m.created_at, m.id)
                            from (select * from public.messages where conversation_id = c.id order by created_at desc, id desc limit 200) m), '[]'::jsonb));
end
$$;

create function public.list_my_conversations(p_role text default null) returns table (
  conversation_id uuid, booking_id uuid, booking_status public.booking_status, listing_title text, cover_path text,
  my_role text, counterpart_name text, last_message text, last_message_at timestamptz, last_sender_is_me boolean, unread_count integer
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated.no_session' using errcode = 'P0001', hint = 'Please sign in.';
  end if;
  return query
    select c.id, b.id, b.status, coalesce(b.snapshot ->> 'listing_title', ''), b.snapshot ->> 'cover_path',
           case when b.borrower_id = auth.uid() then 'borrower' else 'lender' end,
           (select full_name from public.profiles where id = case when b.borrower_id = auth.uid() then b.lender_id else b.borrower_id end),
           lm.body, lm.created_at, lm.sender_id = auth.uid(),
           (select count(*)::int from public.messages m where m.conversation_id = c.id and m.sender_id <> auth.uid()
               and m.created_at > coalesce(cp.last_read_at, '-infinity'::timestamptz))
      from public.conversation_participants cp
      join public.conversations c on c.id = cp.conversation_id
      join public.bookings b on b.id = c.booking_id
      left join lateral (select m.body, m.created_at, m.sender_id from public.messages m where m.conversation_id = c.id
                          order by m.created_at desc, m.id desc limit 1) lm on true
     where cp.user_id = auth.uid()
       and (p_role is null or (p_role = 'borrower' and b.borrower_id = auth.uid()) or (p_role = 'lender' and b.lender_id = auth.uid()))
       -- Threads with messages, plus live bookings so a first message can be started.
       and (lm.created_at is not null or b.status in ('pending_lender_approval', 'awaiting_payment', 'confirmed', 'active', 'overdue', 'return_requested', 'disputed'))
     order by coalesce(lm.created_at, b.created_at) desc
     limit 100;
end
$$;

-- ── Handover (confirmed → active, plan Journey D.2) ────────────────────────
create function public.confirm_handover(p_booking_id uuid, p_notes text default null, p_photo_paths text[] default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  v_side text;
  h public.handover_reports;
  v_notes text := app_private.check_note(p_notes);
  v_photos text[];
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_early integer := greatest(0, coalesce((app_private.setting('handover_opens_days_before'))::int, 1));
  v_title text;
begin
  b := app_private.lock_party_booking(p_booking_id);
  v_side := case when auth.uid() = b.lender_id then 'lender' else 'borrower' end;
  v_title := coalesce(b.snapshot ->> 'listing_title', 'the item');
  select * into h from public.handover_reports where booking_id = b.id;
  -- Repeating your own confirmation returns the current state.
  if (v_side = 'lender' and h.lender_confirmed_at is not null) or (v_side = 'borrower' and h.borrower_confirmed_at is not null) then
    return jsonb_build_object('status', b.status, 'repeated', true);
  end if;
  if b.status <> 'confirmed' then
    raise exception 'conflict.not_confirmed' using errcode = 'P0001', hint = 'Handover is only for confirmed (paid) bookings.';
  end if;
  if v_today < b.pickup_date - v_early then
    raise exception 'conflict.handover_too_early' using errcode = 'P0001',
      hint = 'Handover opens on ' || to_char(b.pickup_date - v_early, 'FMDD Mon YYYY') || '.';
  end if;
  if v_today > b.return_date then
    raise exception 'conflict.handover_too_late' using errcode = 'P0001', hint = 'The rental period has ended. Contact TigRent support.';
  end if;
  if v_side = 'borrower' and h.lender_confirmed_at is null then
    raise exception 'conflict.awaiting_lender_handover' using errcode = 'P0001', hint = 'The lender confirms the handover first; then you confirm what you received.';
  end if;
  v_photos := app_private.check_evidence_paths(b.id, p_photo_paths);

  insert into public.handover_reports (booking_id) values (b.id) on conflict (booking_id) do nothing;
  if v_side = 'lender' then
    update public.handover_reports set lender_confirmed_at = now(), lender_notes = v_notes, photo_paths = photo_paths || v_photos where booking_id = b.id;
    perform app_private.log_booking_note(b, 'handover_lender', auth.uid(), v_notes, jsonb_build_object('photos', cardinality(v_photos)));
    perform app_private.notify(b.borrower_id, 'booking.handover', 'Confirm what you received',
      'The lender handed over ' || v_title || '. Check it and confirm receipt in TigRent to start the rental.',
      'booking', b.id, 'booking:' || b.id || ':handover_lender');
    return jsonb_build_object('status', b.status, 'repeated', false);
  end if;

  update public.handover_reports set borrower_confirmed_at = now(), borrower_notes = v_notes, photo_paths = photo_paths || v_photos where booking_id = b.id;
  perform app_private.log_booking_note(b, 'handover_borrower', auth.uid(), v_notes, jsonb_build_object('photos', cardinality(v_photos)));
  perform app_private.log_transition(b, 'active', auth.uid(), 'Handover confirmed by both');
  update public.bookings set status = 'active', handover_lender_at = (select lender_confirmed_at from public.handover_reports where booking_id = b.id),
    handover_borrower_at = now(), activated_at = now() where id = b.id;
  perform app_private.notify(b.borrower_id, 'booking.active', 'Rental started',
    v_title || ' is yours until ' || to_char(b.due_at at time zone 'Asia/Manila', 'FMDD Mon, FMHH12:MI AM') || '.',
    'booking', b.id, 'booking:' || b.id || ':active:borrower');
  perform app_private.notify(b.lender_id, 'booking.active', 'Rental started',
    'The borrower confirmed receiving ' || v_title || '. It’s due back ' || to_char(b.due_at at time zone 'Asia/Manila', 'FMDD Mon, FMHH12:MI AM') || '.',
    'booking', b.id, 'booking:' || b.id || ':active:lender');
  return jsonb_build_object('status', 'active', 'repeated', false);
end
$$;

-- ── Extensions (plan §2.8) ─────────────────────────────────────────────────
create function public.request_extension(p_booking_id uuid, p_new_return date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  v_side text;
  v_days integer;
  v_amount bigint;
  v_max integer := coalesce((app_private.setting('max_rental_days'))::int, 30);
  v_id uuid;
  v_title text;
begin
  b := app_private.lock_party_booking(p_booking_id);
  v_side := case when auth.uid() = b.lender_id then 'lender' else 'borrower' end;
  if v_side <> 'borrower' then
    raise exception 'forbidden.borrower_only' using errcode = 'P0001', hint = 'Only the borrower can ask for more days.';
  end if;
  if b.status <> 'active' or now() >= b.due_at then
    raise exception 'conflict.extension_window' using errcode = 'P0001', hint = 'Extensions can be requested only during an active rental, before the due time.';
  end if;
  if p_new_return is null or p_new_return <= b.return_date then
    raise exception 'validation.new_return' using errcode = 'P0001', hint = 'Choose a new return date after the current one.';
  end if;
  if app_private.rental_days(b.pickup_date, p_new_return) > v_max then
    raise exception 'validation.too_long' using errcode = 'P0001', hint = 'A rental can be at most ' || v_max || ' days in total.';
  end if;
  if exists (select 1 from public.extension_requests where booking_id = b.id and status in ('pending', 'approved_awaiting_payment')) then
    raise exception 'conflict.extension_open' using errcode = 'P0001', hint = 'You already have an extension request in progress for this rental.';
  end if;
  case app_private.extension_conflict(b, p_new_return)
    when 'dates_taken' then
      raise exception 'conflict.extension_dates_taken' using errcode = 'P0001', hint = 'Someone else has booked some of those extra days. Choose an earlier date.';
    when 'dates_blocked' then
      raise exception 'conflict.extension_dates_blocked' using errcode = 'P0001', hint = 'The lender has blocked some of those extra days. Choose an earlier date.';
    else null;
  end case;
  v_days := p_new_return - b.return_date;
  v_amount := b.daily_rate * v_days; -- agreed daily rate from the booking, not the live listing
  insert into public.extension_requests (booking_id, requester_id, old_return_date, new_return_date, extra_days, extra_amount, extra_commission)
  values (b.id, auth.uid(), b.return_date, p_new_return, v_days, v_amount, app_private.commission_amount(v_amount, b.commission_bps))
  returning id into v_id;
  v_title := coalesce(b.snapshot ->> 'listing_title', 'the item');
  perform app_private.log_booking_note(b, 'extension_requested', auth.uid(), null,
    jsonb_build_object('extension_id', v_id, 'new_return_date', p_new_return, 'extra_amount', v_amount));
  perform app_private.notify(b.lender_id, 'extension.requested', 'Extension request',
    'The borrower wants ' || v_title || ' until ' || to_char(p_new_return, 'FMDD Mon') || ' (+' || v_days || ' day' || case when v_days = 1 then '' else 's' end
      || ', ' || app_private.peso(v_amount) || '). Approve or decline it.',
    'booking', b.id, 'extension:' || v_id || ':requested');
  return v_id;
end
$$;

create function public.decide_extension(p_extension_id uuid, p_decision text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e public.extension_requests;
  b public.bookings;
  v_side text;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_minutes integer := greatest(1, coalesce((app_private.setting('payment_hold_minutes'))::int, 15));
  v_hold timestamptz;
  v_title text;
begin
  if p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception 'validation.decision' using errcode = 'P0001', hint = 'Choose approve or decline.';
  end if;
  select * into e from public.extension_requests where id = p_extension_id;
  if e.id is null then
    raise exception 'not_found.extension' using errcode = 'P0001', hint = 'This extension request no longer exists.';
  end if;
  b := app_private.lock_party_booking(e.booking_id);
  v_side := case when auth.uid() = b.lender_id then 'lender' else 'borrower' end;
  if v_side <> 'lender' then
    raise exception 'not_found.extension' using errcode = 'P0001', hint = 'Only the lender can decide on an extension.';
  end if;
  select * into e from public.extension_requests where id = p_extension_id for update;
  if (p_decision = 'approve' and e.status = 'approved_awaiting_payment') or (p_decision = 'reject' and e.status = 'rejected') then
    return jsonb_build_object('status', e.status, 'hold_expires_at', e.hold_expires_at, 'repeated', true);
  end if;
  if e.status <> 'pending' then
    raise exception 'conflict.extension_decided' using errcode = 'P0001', hint = 'This extension request was already handled (' || replace(e.status::text, '_', ' ') || ').';
  end if;
  v_title := coalesce(b.snapshot ->> 'listing_title', 'the item');

  if p_decision = 'reject' then
    if v_reason is null or char_length(v_reason) not between 3 and 300 then
      raise exception 'validation.reason' using errcode = 'P0001', hint = 'Give the borrower a short reason (3 to 300 characters).';
    end if;
    update public.extension_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_reason = v_reason where id = e.id;
    perform app_private.log_booking_note(b, 'extension_rejected', auth.uid(), v_reason, jsonb_build_object('extension_id', e.id));
    perform app_private.notify(b.borrower_id, 'extension.rejected', 'Extension declined',
      'The lender declined more days for ' || v_title || ': “' || v_reason || '” Your return date stays ' || to_char(b.return_date, 'FMDD Mon') || '.',
      'booking', b.id, 'extension:' || e.id || ':rejected');
    return jsonb_build_object('status', 'rejected', 'hold_expires_at', null, 'repeated', false);
  end if;

  if b.status <> 'active' or now() >= b.due_at then
    raise exception 'conflict.extension_window' using errcode = 'P0001', hint = 'The rental is no longer active before its due time, so it can’t be extended. Decline the request.';
  end if;
  -- Same listing row lock as booking acceptance: extension holds and new holds serialize (plan §2.8).
  perform 1 from public.listings where id = b.listing_id for update;
  perform app_private.expire_stale_holds(b.listing_id);
  case app_private.extension_conflict(b, e.new_return_date)
    when 'dates_taken' then
      raise exception 'conflict.extension_dates_taken' using errcode = 'P0001', hint = 'Another booking now holds some of the extra days, so you can’t approve this. Decline the request.';
    when 'dates_blocked' then
      raise exception 'conflict.extension_dates_blocked' using errcode = 'P0001', hint = 'You blocked some of the extra days in your calendar. Remove the block first, or decline.';
    else null;
  end case;
  v_hold := now() + make_interval(mins => v_minutes);
  update public.extension_requests set status = 'approved_awaiting_payment', hold_expires_at = v_hold, decided_by = auth.uid(), decided_at = now(),
    decision_reason = v_reason where id = e.id;
  perform app_private.log_booking_note(b, 'extension_approved', auth.uid(), v_reason, jsonb_build_object('extension_id', e.id, 'hold_expires_at', v_hold));
  perform app_private.notify(b.borrower_id, 'extension.approved', 'Extension approved: pay to confirm',
    'Pay ' || app_private.peso(e.extra_amount) || ' (demo) within ' || v_minutes || ' minutes to keep ' || v_title || ' until '
      || to_char(e.new_return_date, 'FMDD Mon') || '. Your due date changes only after payment.',
    'booking', b.id, 'extension:' || e.id || ':approved');
  return jsonb_build_object('status', 'approved_awaiting_payment', 'hold_expires_at', v_hold, 'repeated', false);
end
$$;

create function app_private.expire_extension(e public.extension_requests) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  update public.extension_requests set status = 'expired' where id = e.id and status = 'approved_awaiting_payment';
  if not found then return; end if;
  select * into b from public.bookings where id = e.booking_id;
  perform app_private.log_booking_note(b, 'extension_expired', null, 'The extension payment window closed; the original return date stands.',
    jsonb_build_object('extension_id', e.id));
  perform app_private.notify(b.borrower_id, 'extension.expired', 'Extension payment window closed',
    'You didn’t pay for the extra days in time, so the return date stays ' || to_char(b.return_date, 'FMDD Mon') || '.',
    'booking', b.id, 'extension:' || e.id || ':expired:borrower');
  perform app_private.notify(b.lender_id, 'extension.expired', 'Extension not paid',
    'The borrower didn’t pay for the extension in time; the original return date stands.',
    'booking', b.id, 'extension:' || e.id || ':expired:lender');
end
$$;

create function public.pay_extension_demo(p_extension_id uuid, p_idempotency_key text, p_scenario text default 'success') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e public.extension_requests;
  b public.bookings;
  v_side text;
  p public.payments;
  v_mode text := coalesce(app_private.setting('payment_provider_mode') #>> '{}', 'mock_user_choice');
  v_outcome text;
  v_due timestamptz;
  v_title text;
  v_bps_label text;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 128 then
    raise exception 'validation.idempotency_key' using errcode = 'P0001', hint = 'Checkout couldn’t start. Go back and try again.';
  end if;
  select * into e from public.extension_requests where id = p_extension_id;
  if e.id is null then
    raise exception 'not_found.extension' using errcode = 'P0001', hint = 'This extension request no longer exists.';
  end if;
  b := app_private.lock_party_booking(e.booking_id);
  v_side := case when auth.uid() = b.lender_id then 'lender' else 'borrower' end;
  if v_side <> 'borrower' then
    raise exception 'not_found.extension' using errcode = 'P0001', hint = 'Only the borrower pays for an extension.';
  end if;
  select * into e from public.extension_requests where id = p_extension_id for update;
  select * into p from public.payments where idempotency_key = p_idempotency_key;
  if found then
    if p.payer_id <> auth.uid() or p.extension_id is distinct from e.id then
      raise exception 'conflict.idempotency_key' using errcode = 'P0001', hint = 'Checkout couldn’t start. Go back and try again.';
    end if;
    return app_private.payment_result(p, true) || jsonb_build_object('extension_status', e.status);
  end if;
  if e.status = 'paid' then
    select * into p from public.payments where extension_id = e.id and status = 'succeeded' limit 1;
    return app_private.payment_result(p, true) || jsonb_build_object('extension_status', e.status);
  end if;
  if e.status = 'approved_awaiting_payment' and e.hold_expires_at <= now() then
    perform app_private.expire_extension(e);
    return jsonb_build_object('outcome', 'expired', 'amount', e.extra_amount, 'replayed', false, 'booking_status', b.status, 'extension_status', 'expired');
  end if;
  if e.status <> 'approved_awaiting_payment' then
    raise exception 'conflict.not_payable' using errcode = 'P0001', hint = 'This extension isn’t waiting for payment (' || replace(e.status::text, '_', ' ') || ').';
  end if;
  if b.status <> 'active' then
    raise exception 'conflict.extension_window' using errcode = 'P0001', hint = 'The rental is no longer active, so it can’t be extended.';
  end if;
  v_outcome := case v_mode when 'mock_always_succeed' then 'success' when 'mock_always_fail' then 'failure' else p_scenario end;
  if v_outcome is null or v_outcome not in ('success', 'failure') then
    raise exception 'validation.scenario' using errcode = 'P0001', hint = 'Choose a demo payment outcome.';
  end if;
  v_title := coalesce(b.snapshot ->> 'listing_title', 'the item');

  if v_outcome = 'failure' then
    insert into public.payments (purpose, booking_id, extension_id, payer_id, amount, status, idempotency_key, provider_ref, failure_reason, processed_at)
    values ('extension', b.id, e.id, b.borrower_id, e.extra_amount, 'failed', p_idempotency_key,
            'MOCK-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)), 'Demo payment declined (simulated failure). No money moved.', now())
    returning * into p;
    -- The original due date stands (plan §2.8). No ledger lines: nothing was collected.
    update public.extension_requests set status = 'payment_failed' where id = e.id;
    perform app_private.log_booking_note(b, 'extension_payment_failed', null, 'Extension payment failed; the original return date stands.',
      jsonb_build_object('extension_id', e.id, 'payment_id', p.id));
    perform app_private.notify(b.borrower_id, 'extension.payment_failed', 'Extension payment failed',
      'The demo payment was declined, so ' || v_title || ' is still due ' || to_char(b.due_at at time zone 'Asia/Manila', 'FMDD Mon, FMHH12:MI AM') || '.',
      'booking', b.id, 'extension:' || e.id || ':payment_failed:borrower');
    perform app_private.notify(b.lender_id, 'extension.payment_failed', 'Extension payment failed',
      'The borrower’s extension payment failed; the original return date stands.',
      'booking', b.id, 'extension:' || e.id || ':payment_failed:lender');
    return app_private.payment_result(p, false) || jsonb_build_object('extension_status', 'payment_failed');
  end if;

  insert into public.payments (purpose, booking_id, extension_id, payer_id, amount, status, idempotency_key, provider_ref, processed_at)
  values ('extension', b.id, e.id, b.borrower_id, e.extra_amount, 'succeeded', p_idempotency_key,
          'MOCK-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)), now())
  returning * into p;
  v_bps_label := trim(trailing '.' from to_char(b.commission_bps / 100.0, 'FM990.99'));
  insert into public.ledger_entries (booking_id, payment_id, party_id, category, debit, credit, description, idempotency_key) values
    (b.id, p.id, b.borrower_id, 'extension_payment', e.extra_amount, 0, 'Simulated extension payment', 'extension:' || e.id || ':paid:extension_payment'),
    (b.id, p.id, b.lender_id, 'rent_payable', 0, e.extra_amount - e.extra_commission, 'Simulated lender payable for extra days (not paid out)', 'extension:' || e.id || ':paid:rent_payable');
  if e.extra_commission > 0 then
    insert into public.ledger_entries (booking_id, payment_id, party_id, category, debit, credit, description, idempotency_key)
    values (b.id, p.id, null, 'platform_commission', 0, e.extra_commission, 'Platform commission on extension (' || v_bps_label || '%)', 'extension:' || e.id || ':paid:platform_commission');
  end if;
  -- Only now does the agreement change: new return date, due time, and priced columns (plan §2.8).
  v_due := app_private.manila_timestamp(e.new_return_date, app_private.booking_due_time(b));
  begin
    update public.bookings set
      return_date = e.new_return_date,
      rental_days = app_private.rental_days(b.pickup_date, e.new_return_date),
      due_at = v_due,
      subtotal = b.subtotal + e.extra_amount,
      total = b.total + e.extra_amount,
      commission = b.commission + e.extra_commission,
      lender_net = b.lender_net + (e.extra_amount - e.extra_commission)
    where id = b.id;
  exception when exclusion_violation then
    raise exception 'conflict.extension_dates_taken' using errcode = 'P0001', hint = 'Some of the extra days are no longer available. Nothing was charged.';
  end;
  update public.extension_requests set status = 'paid' where id = e.id;
  perform app_private.log_booking_note(b, 'extended', auth.uid(), 'Return date moved to ' || to_char(e.new_return_date, 'FMDD Mon YYYY'),
    jsonb_build_object('extension_id', e.id, 'payment_id', p.id, 'old_return_date', e.old_return_date, 'new_return_date', e.new_return_date));
  perform app_private.notify(b.borrower_id, 'extension.paid', 'Extension confirmed',
    v_title || ' is now due ' || to_char(v_due at time zone 'Asia/Manila', 'FMDD Mon, FMHH12:MI AM') || '. Demo payment of ' || app_private.peso(e.extra_amount) || ' succeeded.',
    'booking', b.id, 'extension:' || e.id || ':paid:borrower');
  perform app_private.notify(b.lender_id, 'extension.paid', 'Extension confirmed',
    v_title || ' is now due back ' || to_char(v_due at time zone 'Asia/Manila', 'FMDD Mon, FMHH12:MI AM') || '. Your estimated extra share is '
      || app_private.peso(e.extra_amount - e.extra_commission) || ' (simulated).',
    'booking', b.id, 'extension:' || e.id || ':paid:lender');
  return app_private.payment_result(p, false) || jsonb_build_object('extension_status', 'paid');
end
$$;

-- ── Return (plan §2.7, Journey D.5–D.6) ────────────────────────────────────
create function public.submit_return(p_booking_id uuid, p_notes text default null, p_photo_paths text[] default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  v_side text;
  v_notes text := app_private.check_note(p_notes);
  v_photos text[];
  v_title text;
begin
  b := app_private.lock_party_booking(p_booking_id);
  v_side := case when auth.uid() = b.lender_id then 'lender' else 'borrower' end;
  if v_side <> 'borrower' then
    raise exception 'forbidden.borrower_only' using errcode = 'P0001', hint = 'Only the borrower submits the return.';
  end if;
  if b.status = 'return_requested' then
    return jsonb_build_object('status', b.status, 'repeated', true);
  end if;
  if b.status not in ('active', 'overdue') then
    raise exception 'conflict.not_returnable' using errcode = 'P0001', hint = 'Only an item out on rent can be returned.';
  end if;
  v_photos := app_private.check_evidence_paths(b.id, p_photo_paths);
  insert into public.return_reports (booking_id, borrower_requested_at, borrower_notes, borrower_photo_paths)
  values (b.id, now(), v_notes, v_photos)
  on conflict (booking_id) do update set borrower_requested_at = now(), borrower_notes = excluded.borrower_notes, borrower_photo_paths = excluded.borrower_photo_paths;
  perform app_private.log_transition(b, 'return_requested', auth.uid(), v_notes, jsonb_build_object('photos', cardinality(v_photos)));
  update public.bookings set status = 'return_requested', returned_at = now() where id = b.id;
  -- An open extension can't apply once the item is back.
  update public.extension_requests set status = 'cancelled', decision_reason = coalesce(decision_reason, 'Item returned')
   where booking_id = b.id and status in ('pending', 'approved_awaiting_payment');
  v_title := coalesce(b.snapshot ->> 'listing_title', 'the item');
  perform app_private.notify(b.lender_id, 'booking.return_submitted', 'Item returned: please inspect',
    'The borrower says ' || v_title || ' is back. Check it and confirm the return in TigRent.',
    'booking', b.id, 'booking:' || b.id || ':return_submitted');
  perform app_private.notify(b.borrower_id, 'booking.return_submitted', 'Return submitted',
    'The lender will inspect ' || v_title || ' and confirm. Your deposit is released after a clean return.',
    'booking', b.id, 'booking:' || b.id || ':return_submitted:borrower');
  return jsonb_build_object('status', 'return_requested', 'repeated', false,
                            'late_days', app_private.late_days(b.due_at, now()));
end
$$;

-- Lender confirms a clean, on-time return: booking completed, deposit released by simulated refund.
-- Late, damaged, incomplete and missing outcomes are Phase 10 (late fees, deposit withholding, disputes).
create function public.confirm_clean_return(p_booking_id uuid, p_notes text default null, p_photo_paths text[] default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  v_side text;
  r public.return_reports;
  v_notes text := app_private.check_note(p_notes);
  v_photos text[];
  v_late integer;
  v_pay uuid;
  v_refund uuid;
  v_title text;
begin
  b := app_private.lock_party_booking(p_booking_id);
  v_side := case when auth.uid() = b.lender_id then 'lender' else 'borrower' end;
  if v_side <> 'lender' then
    raise exception 'forbidden.lender_only' using errcode = 'P0001', hint = 'Only the lender inspects and confirms the return.';
  end if;
  if b.status = 'completed' then
    return jsonb_build_object('status', b.status, 'repeated', true);
  end if;
  if b.status <> 'return_requested' then
    raise exception 'conflict.no_return' using errcode = 'P0001', hint = 'The borrower hasn’t submitted the return yet.';
  end if;
  select * into r from public.return_reports where booking_id = b.id;
  v_late := app_private.late_days(b.due_at, r.borrower_requested_at);
  if v_late > 0 then
    raise exception 'conflict.late_return' using errcode = 'P0001',
      hint = 'This item came back ' || v_late || ' day' || case when v_late = 1 then '' else 's' end
        || ' late. Late-fee settlement is part of the next build step, so this return can’t be completed yet.';
  end if;
  v_photos := app_private.check_evidence_paths(b.id, p_photo_paths);
  update public.return_reports set lender_inspected_at = now(), outcome = 'clean', lender_notes = v_notes,
    lender_photo_paths = v_photos, late_days = 0, late_fee = 0 where booking_id = b.id;
  perform app_private.log_transition(b, 'completed', auth.uid(), coalesce(v_notes, 'Returned in the agreed condition'));
  update public.bookings set status = 'completed', completed_at = now() where id = b.id;

  if b.deposit > 0 then
    select id into v_pay from public.payments where booking_id = b.id and purpose = 'booking' and status = 'succeeded' limit 1;
    if v_pay is not null then
      insert into public.refunds (payment_id, booking_id, amount, reason, status, idempotency_key, processed_at)
      values (v_pay, b.id, b.deposit, 'Deposit released after clean return (simulated refund)', 'succeeded', 'booking:' || b.id || ':deposit_release', now())
      on conflict (idempotency_key) do nothing
      returning id into v_refund;
      if v_refund is not null then
        insert into public.ledger_entries (booking_id, refund_id, party_id, category, debit, credit, description, idempotency_key) values
          (b.id, v_refund, b.borrower_id, 'deposit_released', b.deposit, 0, 'Deposit released to borrower', 'booking:' || b.id || ':deposit_release:released'),
          (b.id, v_refund, b.borrower_id, 'refund', 0, b.deposit, 'Simulated refund of deposit', 'booking:' || b.id || ':deposit_release:refund');
      end if;
    end if;
  end if;
  v_title := coalesce(b.snapshot ->> 'listing_title', 'the item');
  perform app_private.notify(b.borrower_id, 'booking.completed', 'Rental complete',
    'The lender confirmed ' || v_title || ' came back in good condition.'
      || case when b.deposit > 0 then ' Your ' || app_private.peso(b.deposit) || ' deposit was released (simulated refund).' else '' end,
    'booking', b.id, 'booking:' || b.id || ':completed:borrower');
  perform app_private.notify(b.lender_id, 'booking.completed', 'Rental complete',
    v_title || ' is back and available for new bookings.',
    'booking', b.id, 'booking:' || b.id || ':completed:lender');
  return jsonb_build_object('status', 'completed', 'repeated', false, 'deposit_released', b.deposit);
end
$$;

-- ── Reminders and time-based transitions (plan Phase 9) ────────────────────
-- One idempotent, server-timed job. In-app notifications are the delivery channel; every reminder has a
-- deterministic dedupe key, so running it any number of times never duplicates (Phase 9 gate).
-- Push/email would hook in at app_private.notify (channel column); none are configured in the prototype.
create function app_private.process_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer := 0;
  b public.bookings;
  e public.extension_requests;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_soon integer := coalesce((app_private.setting('reminder_due_soon_hours'))::int, 24);
  v_follow integer := coalesce((app_private.setting('reminder_followup_hours'))::int, 6);
  v_title text;
  v_due_key text;
begin
  n := n + app_private.expire_stale_holds(null);

  for e in select * from public.extension_requests where status = 'approved_awaiting_payment' and hold_expires_at <= now() for update skip locked loop
    perform app_private.expire_extension(e);
    n := n + 1;
  end loop;

  -- Overdue: active past the agreed due time (never before it).
  for b in select * from public.bookings where status = 'active' and due_at <= now() for update skip locked loop
    perform app_private.log_transition(b, 'overdue', null, 'The due time passed without a return.');
    update public.bookings set status = 'overdue' where id = b.id;
    update public.extension_requests set status = 'expired', decision_reason = coalesce(decision_reason, 'Due time passed before a decision')
     where booking_id = b.id and status = 'pending';
    v_title := coalesce(b.snapshot ->> 'listing_title', 'the item');
    v_due_key := extract(epoch from b.due_at)::bigint::text;
    perform app_private.notify(b.borrower_id, 'booking.overdue', 'Return overdue',
      v_title || ' was due ' || to_char(b.due_at at time zone 'Asia/Manila', 'FMDD Mon, FMHH12:MI AM') || '. Return it as soon as possible and message the lender.',
      'booking', b.id, 'booking:' || b.id || ':overdue:borrower:' || v_due_key);
    perform app_private.notify(b.lender_id, 'booking.overdue', 'Item overdue',
      v_title || ' hasn’t been returned yet. Message the borrower to arrange it.',
      'booking', b.id, 'booking:' || b.id || ':overdue:lender:' || v_due_key);
    n := n + 1;
  end loop;

  -- Pickup reminders (today or tomorrow, not yet handed over).
  for b in select * from public.bookings where status = 'confirmed' and pickup_date between v_today and v_today + 1 loop
    v_title := coalesce(b.snapshot ->> 'listing_title', 'the item');
    perform app_private.notify(b.borrower_id, 'reminder.pickup', case when b.pickup_date = v_today then 'Pickup today' else 'Pickup tomorrow' end,
      'Pick up ' || v_title || ' at ' || coalesce(b.snapshot ->> 'pickup_point', 'the agreed point') || ', then confirm receipt in TigRent.',
      'booking', b.id, 'reminder:pickup:' || b.id || ':borrower:' || b.pickup_date);
    perform app_private.notify(b.lender_id, 'reminder.pickup', case when b.pickup_date = v_today then 'Handover today' else 'Handover tomorrow' end,
      'Hand over ' || v_title || ' and confirm it in TigRent.',
      'booking', b.id, 'reminder:pickup:' || b.id || ':lender:' || b.pickup_date);
  end loop;

  -- Due soon (re-arms after an extension because the key includes the due time).
  for b in select * from public.bookings where status = 'active' and due_at > now() and due_at <= now() + make_interval(hours => v_soon) loop
    v_title := coalesce(b.snapshot ->> 'listing_title', 'the item');
    v_due_key := extract(epoch from b.due_at)::bigint::text;
    perform app_private.notify(b.borrower_id, 'reminder.due_soon', 'Return due soon',
      v_title || ' is due ' || to_char(b.due_at at time zone 'Asia/Manila', 'FMDD Mon, FMHH12:MI AM') || '. Need longer? Request an extension before then.',
      'booking', b.id, 'reminder:due_soon:' || b.id || ':borrower:' || v_due_key);
    perform app_private.notify(b.lender_id, 'reminder.due_soon', 'Return due soon',
      v_title || ' is due back ' || to_char(b.due_at at time zone 'Asia/Manila', 'FMDD Mon, FMHH12:MI AM') || '.',
      'booking', b.id, 'reminder:due_soon:' || b.id || ':lender:' || v_due_key);
  end loop;

  -- Lender follow-ups: undecided extensions and uninspected returns.
  for e in select x.* from public.extension_requests x where x.status = 'pending' and x.created_at <= now() - make_interval(hours => v_follow) loop
    select * into b from public.bookings where id = e.booking_id;
    perform app_private.notify(b.lender_id, 'reminder.extension_decision', 'Extension waiting for you',
      'Approve or decline the extension request for ' || coalesce(b.snapshot ->> 'listing_title', 'your item') || '.',
      'booking', b.id, 'reminder:extension:' || e.id);
  end loop;
  for b in select x.* from public.bookings x join public.return_reports r on r.booking_id = x.id
            where x.status = 'return_requested' and r.borrower_requested_at <= now() - make_interval(hours => v_follow) loop
    perform app_private.notify(b.lender_id, 'reminder.return_inspection', 'Return waiting for inspection',
      'Inspect ' || coalesce(b.snapshot ->> 'listing_title', 'your item') || ' and confirm the return so the borrower’s deposit can be released.',
      'booking', b.id, 'reminder:return:' || b.id);
  end loop;
  return n;
end
$$;

-- Client trigger for the same job (any signed-in user; idempotent and server-timed).
create function public.process_due_events() returns integer
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated.no_session' using errcode = 'P0001', hint = 'Please sign in.';
  end if;
  return app_private.process_reminders();
end
$$;

-- sweep_expired_holds (migration 015) now runs the whole job.
create or replace function public.sweep_expired_holds() returns integer
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated.no_session' using errcode = 'P0001', hint = 'Please sign in.';
  end if;
  return app_private.process_reminders();
end
$$;

-- ── Reads ──────────────────────────────────────────────────────────────────
-- get_booking_detail (migration 015) + handover, return, extensions, conversation, late/handover windows, event kinds.
create or replace function public.get_booking_detail(p_booking_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  b public.bookings;
  v_role text;
  v_other uuid;
  v_other_rating record;
  h public.handover_reports;
  r public.return_reports;
  v_early integer := greatest(0, coalesce((app_private.setting('handover_opens_days_before'))::int, 1));
begin
  if v_me is null then
    raise exception 'unauthenticated.no_session' using errcode = 'P0001', hint = 'Please sign in.';
  end if;
  select * into b from public.bookings where id = p_booking_id;
  if not found or not (v_me in (b.borrower_id, b.lender_id) or app_private.is_staff()) then
    raise exception 'not_found.booking' using errcode = 'P0001', hint = 'This booking isn’t yours or no longer exists.';
  end if;
  v_role := case when v_me = b.borrower_id then 'borrower' when v_me = b.lender_id then 'lender' else 'staff' end;
  v_other := case when v_role = 'lender' then b.borrower_id else b.lender_id end;
  if v_role = 'lender' then
    select round(avg(rating)::numeric, 2) as avg, count(*)::int as count into v_other_rating
      from public.reviews where target_id = v_other and direction = 'lender_to_borrower' and moderation_status = 'visible';
  else
    select avg, count into v_other_rating from app_private.lender_rating(v_other);
  end if;
  select * into h from public.handover_reports where booking_id = b.id;
  select * into r from public.return_reports where booking_id = b.id;

  return jsonb_build_object(
    'id', b.id, 'my_role', v_role, 'status', b.status, 'listing_id', b.listing_id,
    'listing_status', (select status from public.listings where id = b.listing_id),
    'pickup_date', b.pickup_date, 'return_date', b.return_date, 'rental_days', b.rental_days, 'due_at', b.due_at,
    'pickup_arrangement', b.pickup_arrangement, 'snapshot', b.snapshot,
    'daily_rate', b.daily_rate, 'subtotal', b.subtotal, 'deposit', b.deposit, 'total', b.total, 'late_fee_per_day', b.late_fee_per_day,
    'commission_bps', b.commission_bps, 'commission', b.commission, 'lender_net', b.lender_net,
    'hold_expires_at', b.hold_expires_at, 'server_now', now(),
    'decision_reason', b.decision_reason, 'decided_at', b.decided_at, 'cancel_reason', b.cancel_reason, 'cancelled_at', b.cancelled_at,
    'created_at', b.created_at, 'activated_at', b.activated_at, 'returned_at', b.returned_at, 'completed_at', b.completed_at,
    'handover_opens_on', b.pickup_date - v_early,
    'late_days_now', case when b.status in ('active', 'overdue') then app_private.late_days(b.due_at, now())
                          when b.status = 'return_requested' then app_private.late_days(b.due_at, r.borrower_requested_at) else 0 end,
    'conflict', case when v_role in ('lender', 'staff') then app_private.request_conflict(b) end,
    'conversation_id', (select c.id from public.conversations c where c.booking_id = b.id),
    'counterpart', jsonb_build_object(
      'id', v_other, 'role', case when v_role = 'lender' then 'borrower' else 'lender' end,
      'full_name', (select full_name from public.profiles where id = v_other),
      'is_student_verified', app_private.verification_status(v_other) = 'verified',
      'rating_avg', v_other_rating.avg, 'rating_count', coalesce(v_other_rating.count, 0)),
    'terms', (select jsonb_build_object('title', tv.title, 'version', tv.version, 'is_sample', tv.is_sample, 'accepted_at', t.accepted_at)
                from public.booking_terms_acceptances t join public.terms_versions tv on tv.id = t.terms_version_id
               where t.booking_id = b.id and t.user_id = b.borrower_id),
    'handover', case when h.booking_id is null then null else jsonb_build_object(
      'lender_confirmed_at', h.lender_confirmed_at, 'lender_notes', h.lender_notes,
      'borrower_confirmed_at', h.borrower_confirmed_at, 'borrower_notes', h.borrower_notes, 'photo_paths', to_jsonb(h.photo_paths)) end,
    'return', case when r.booking_id is null then null else jsonb_build_object(
      'requested_at', r.borrower_requested_at, 'borrower_notes', r.borrower_notes, 'borrower_photo_paths', to_jsonb(r.borrower_photo_paths),
      'inspected_at', r.lender_inspected_at, 'outcome', r.outcome, 'lender_notes', r.lender_notes, 'lender_photo_paths', to_jsonb(r.lender_photo_paths),
      'late_days', r.late_days) end,
    'extensions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'status', e.status, 'old_return_date', e.old_return_date, 'new_return_date', e.new_return_date, 'extra_days', e.extra_days,
        'extra_amount', e.extra_amount, 'extra_commission', e.extra_commission, 'hold_expires_at', e.hold_expires_at,
        'decision_reason', e.decision_reason, 'created_at', e.created_at, 'decided_at', e.decided_at,
        'conflict', case when e.status = 'pending' and v_role in ('lender', 'staff') then app_private.extension_conflict(b, e.new_return_date) end)
        order by e.created_at desc)
      from public.extension_requests e where e.booking_id = b.id), '[]'::jsonb),
    'refunds', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'amount', f.amount, 'reason', f.reason, 'status', f.status, 'processed_at', f.processed_at) order by f.created_at)
                           from public.refunds f where f.booking_id = b.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('from_status', e.from_status, 'to_status', e.to_status, 'reason', e.reason,
                                                            'kind', e.metadata ->> 'kind', 'meta', e.metadata,
                                                            'by_me', e.actor_id = v_me, 'at', e.created_at) order by e.created_at, e.id)
                          from public.booking_events e where e.booking_id = b.id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'purpose', p.purpose, 'status', p.status, 'amount', p.amount, 'provider', p.provider,
                                                              'provider_ref', p.provider_ref, 'failure_reason', p.failure_reason,
                                                              'processed_at', p.processed_at, 'created_at', p.created_at) order by p.created_at)
                            from public.payments p where p.booking_id = b.id and p.purpose in ('booking', 'extension')), '[]'::jsonb));
end
$$;

-- Lender inbox for extensions (pending with conflict flags, and approvals awaiting payment).
create function public.list_extension_requests() returns table (
  id uuid, booking_id uuid, listing_title text, borrower_name text, old_return_date date, new_return_date date, extra_days integer,
  extra_amount bigint, status public.extension_status, hold_expires_at timestamptz, created_at timestamptz, conflict text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated.no_session' using errcode = 'P0001', hint = 'Please sign in.';
  end if;
  return query
    select e.id, b.id, coalesce(b.snapshot ->> 'listing_title', ''), p.full_name, e.old_return_date, e.new_return_date, e.extra_days,
           e.extra_amount, e.status, e.hold_expires_at, e.created_at,
           case when e.status = 'pending' then app_private.extension_conflict(b, e.new_return_date) end
      from public.extension_requests e
      join public.bookings b on b.id = e.booking_id
      join public.profiles p on p.id = b.borrower_id
     where b.lender_id = auth.uid() and e.status in ('pending', 'approved_awaiting_payment')
     order by e.created_at;
end
$$;

-- ── Scheduled processing on the hosted project (pg_cron), when available ───
-- PGlite (tests) has no pg_cron; the job also runs whenever a client opens bookings (process_due_events).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.schedule('tigrent-due-events', '*/5 * * * *', 'select app_private.process_reminders()');
    exception when others then
      raise notice 'pg_cron schedule not created: %', sqlerrm;
    end;
  end if;
end
$$;

-- ── Grants ─────────────────────────────────────────────────────────────────
revoke all on function
  public.send_message(uuid, text),
  public.mark_conversation_read(uuid),
  public.get_conversation(uuid),
  public.list_my_conversations(text),
  public.confirm_handover(uuid, text, text[]),
  public.request_extension(uuid, date),
  public.decide_extension(uuid, text, text),
  public.pay_extension_demo(uuid, text, text),
  public.submit_return(uuid, text, text[]),
  public.confirm_clean_return(uuid, text, text[]),
  public.process_due_events(),
  public.list_extension_requests()
from public, anon;
grant execute on function
  public.send_message(uuid, text),
  public.mark_conversation_read(uuid),
  public.get_conversation(uuid),
  public.list_my_conversations(text),
  public.confirm_handover(uuid, text, text[]),
  public.request_extension(uuid, date),
  public.decide_extension(uuid, text, text),
  public.pay_extension_demo(uuid, text, text),
  public.submit_return(uuid, text, text[]),
  public.confirm_clean_return(uuid, text, text[]),
  public.process_due_events(),
  public.list_extension_requests()
to authenticated;
revoke execute on function
  app_private.log_booking_note(public.bookings, text, uuid, text, jsonb),
  app_private.late_days(timestamptz, timestamptz),
  app_private.booking_due_time(public.bookings),
  app_private.check_evidence_paths(uuid, text[]),
  app_private.check_note(text, integer),
  app_private.extension_hold_overlaps(uuid, date, date, uuid),
  app_private.extension_conflict(public.bookings, date),
  app_private.lock_party_booking(uuid),
  app_private.ensure_booking_conversation(uuid),
  app_private.on_booking_created(),
  app_private.conversation_closed_reason(public.booking_status),
  app_private.expire_extension(public.extension_requests),
  app_private.process_reminders()
from public, authenticated;
