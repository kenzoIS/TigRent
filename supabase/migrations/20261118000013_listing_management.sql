-- Phase 6: lender equipment management, photos, availability blocks, reports/moderation (plan §2.3, Phase 6).
-- Listing tables stay read-only to clients; every write goes through these functions.

-- Sanity bounds (not business policy): stop obviously mistyped amounts.
-- ₱100,000/day rate, ₱1,000,000 deposit, ₱100,000/day late fee.
create function app_private.validate_listing_fields(f jsonb) returns void
language plpgsql stable set search_path = '' as $$
declare
  v_title text := trim(coalesce(f ->> 'title', ''));
  v_desc text := coalesce(f ->> 'description', '');
begin
  if char_length(v_title) not between 3 and 80 then
    raise exception 'validation.title' using errcode = 'P0001', hint = 'Use a title of 3 to 80 characters.';
  end if;
  if char_length(v_desc) > 2000 then
    raise exception 'validation.description' using errcode = 'P0001', hint = 'Keep the description under 2,000 characters.';
  end if;
  if not exists (select 1 from public.listing_categories where slug = f ->> 'category' and is_active) then
    raise exception 'validation.category' using errcode = 'P0001', hint = 'Choose a category.';
  end if;
  if (f ->> 'condition') is null or (f ->> 'condition') not in ('new', 'like_new', 'good', 'fair', 'worn') then
    raise exception 'validation.condition' using errcode = 'P0001', hint = 'Choose the item’s condition.';
  end if;
  if (f ->> 'daily_rate') is null or (f ->> 'daily_rate') !~ '^\d+$' or (f ->> 'daily_rate')::bigint > 10000000 then
    raise exception 'validation.daily_rate' using errcode = 'P0001', hint = 'Enter a daily rate in pesos (up to ₱100,000).';
  end if;
  if coalesce(f ->> 'deposit', '0') !~ '^\d+$' or coalesce(f ->> 'deposit', '0')::bigint > 100000000 then
    raise exception 'validation.deposit' using errcode = 'P0001', hint = 'Enter a deposit of ₱0 or more (up to ₱1,000,000).';
  end if;
  if coalesce(f ->> 'late_fee_per_day', '0') !~ '^\d+$' or coalesce(f ->> 'late_fee_per_day', '0')::bigint > 10000000 then
    raise exception 'validation.late_fee_per_day' using errcode = 'P0001', hint = 'Enter a late fee of ₱0 or more per day.';
  end if;
  if (f ->> 'pickup_point_id') is not null
     and not exists (select 1 from public.campus_pickup_points where id = (f ->> 'pickup_point_id')::uuid and is_active) then
    raise exception 'validation.pickup_point_id' using errcode = 'P0001', hint = 'Choose an approved pickup point.';
  end if;
  if char_length(coalesce(f ->> 'pickup_notes', '')) > 500 or char_length(coalesce(f ->> 'equipment_notes', '')) > 500 then
    raise exception 'validation.notes' using errcode = 'P0001', hint = 'Keep notes under 500 characters.';
  end if;
end
$$;

-- Caller must be a verified, active student with the lender role.
create function app_private.require_active_lender() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated.no_session' using errcode = 'P0001', hint = 'Please sign in.';
  end if;
  if not app_private.has_role('lender') then
    raise exception 'forbidden.not_lender' using errcode = 'P0001', hint = 'Enable lending on your profile first.';
  end if;
  if app_private.verification_status(auth.uid()) <> 'verified' then
    raise exception 'forbidden.not_verified' using errcode = 'P0001', hint = 'Only verified students can list or publish equipment.';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid() and account_status <> 'active') then
    raise exception 'forbidden.account_restricted' using errcode = 'P0001', hint = 'New or republished listings are paused while your account is under review.';
  end if;
end
$$;

-- Owned, not-removed listing, locked for update.
create function app_private.lock_own_listing(p_id uuid) returns public.listings
language plpgsql security definer set search_path = '' as $$
declare v public.listings;
begin
  select * into v from public.listings where id = p_id for update;
  if not found or v.lender_id <> auth.uid() then
    raise exception 'not_found.listing' using errcode = 'P0001', hint = 'This listing isn’t yours or no longer exists.';
  end if;
  if v.status = 'removed' then
    raise exception 'conflict.listing_removed' using errcode = 'P0001', hint = 'This listing was removed and can’t be changed.';
  end if;
  return v;
end
$$;

create function public.create_listing(p_fields jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform app_private.require_active_lender();
  perform app_private.validate_listing_fields(p_fields);
  insert into public.listings (lender_id, title, description, category, condition, equipment_notes, daily_rate, deposit,
                               late_fee_per_day, pickup_point_id, pickup_notes, status)
  values (auth.uid(), trim(p_fields ->> 'title'), coalesce(p_fields ->> 'description', ''), p_fields ->> 'category',
          (p_fields ->> 'condition')::public.item_condition, nullif(trim(coalesce(p_fields ->> 'equipment_notes', '')), ''),
          (p_fields ->> 'daily_rate')::bigint, coalesce((p_fields ->> 'deposit')::bigint, 0), coalesce((p_fields ->> 'late_fee_per_day')::bigint, 0),
          (p_fields ->> 'pickup_point_id')::uuid, nullif(trim(coalesce(p_fields ->> 'pickup_notes', '')), ''), 'draft')
  returning id into v_id;
  perform app_private.audit('listing.created', 'listing', v_id::text, '{}'::jsonb);
  return v_id;
end
$$;

-- Edits never touch existing bookings: each booking keeps its own priced snapshot (plan §2.4, Journey B.6).
create function public.update_listing(p_id uuid, p_fields jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.listings;
begin
  v := app_private.lock_own_listing(p_id);
  perform app_private.validate_listing_fields(p_fields);
  if v.status = 'active' and (p_fields ->> 'daily_rate')::bigint = 0 then
    raise exception 'validation.daily_rate' using errcode = 'P0001', hint = 'An active listing needs a daily rate above ₱0. Pause it first to change this.';
  end if;
  update public.listings set
    title = trim(p_fields ->> 'title'),
    description = coalesce(p_fields ->> 'description', ''),
    category = p_fields ->> 'category',
    condition = (p_fields ->> 'condition')::public.item_condition,
    equipment_notes = nullif(trim(coalesce(p_fields ->> 'equipment_notes', '')), ''),
    daily_rate = (p_fields ->> 'daily_rate')::bigint,
    deposit = coalesce((p_fields ->> 'deposit')::bigint, 0),
    late_fee_per_day = coalesce((p_fields ->> 'late_fee_per_day')::bigint, 0),
    pickup_point_id = (p_fields ->> 'pickup_point_id')::uuid,
    pickup_notes = nullif(trim(coalesce(p_fields ->> 'pickup_notes', '')), '')
  where id = p_id;
  perform app_private.audit('listing.updated', 'listing', p_id::text,
    jsonb_build_object('daily_rate_from', v.daily_rate, 'daily_rate_to', (p_fields ->> 'daily_rate')::bigint));
end
$$;

-- Lifecycle: draft → active ↔ paused/unavailable; any non-removed → removed (plan §2.3).
create function public.set_listing_status(p_id uuid, p_status public.listing_status) returns public.listing_status
language plpgsql security definer set search_path = '' as $$
declare
  v public.listings;
  v_open integer;
begin
  v := app_private.lock_own_listing(p_id);
  if v.status = p_status then return p_status; end if;
  if p_status = 'draft' then
    raise exception 'validation.status' using errcode = 'P0001', hint = 'A published listing can be paused, not returned to draft.';
  end if;

  if p_status = 'active' then
    perform app_private.require_active_lender();
    if v.moderation_status = 'hidden' then
      raise exception 'forbidden.listing_hidden' using errcode = 'P0001', hint = 'A moderator hid this listing. It can’t be published until the review is resolved.';
    end if;
    if v.daily_rate <= 0 then
      raise exception 'validation.daily_rate' using errcode = 'P0001', hint = 'Set a daily rate above ₱0 before publishing.';
    end if;
    if not exists (select 1 from public.listing_images where listing_id = p_id) then
      raise exception 'validation.photos' using errcode = 'P0001', hint = 'Add at least one photo before publishing.';
    end if;
  end if;

  if p_status = 'removed' then
    select count(*) into v_open from public.bookings
     where listing_id = p_id and status in ('pending_lender_approval', 'awaiting_payment', 'confirmed', 'active', 'overdue', 'return_requested', 'disputed');
    if v_open > 0 then
      raise exception 'conflict.open_bookings' using errcode = 'P0001',
        hint = 'This item has ' || v_open || ' open request(s) or rental(s). Decline pending requests and finish active rentals before removing it.';
    end if;
  end if;

  update public.listings set
    status = p_status,
    published_at = case when p_status = 'active' then coalesce(published_at, now()) else published_at end,
    is_featured = case when p_status = 'active' then is_featured else false end
  where id = p_id;
  perform app_private.audit('listing.' || p_status, 'listing', p_id::text, jsonb_build_object('from', v.status));
  return p_status;
end
$$;

-- ── Photos (uploaded to listing-images/{listing_id}/… first) ──────────────
create function public.add_listing_image(p_listing_id uuid, p_path text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v public.listings;
  v_meta jsonb;
  v_mime text;
  v_size bigint;
  v_id uuid;
begin
  v := app_private.lock_own_listing(p_listing_id);
  if split_part(p_path, '/', 1) <> p_listing_id::text then
    raise exception 'validation.photo_path' using errcode = 'P0001', hint = 'Upload the photo for this listing first.';
  end if;
  select metadata into v_meta from storage.objects where bucket_id = 'listing-images' and name = p_path;
  if not found then
    raise exception 'validation.photo_missing' using errcode = 'P0001', hint = 'The photo upload didn’t finish. Please try again.';
  end if;
  v_mime := lower(coalesce(v_meta ->> 'mimetype', ''));
  v_size := nullif(v_meta ->> 'size', '')::bigint;
  if v_mime not in ('image/jpeg', 'image/png', 'image/webp') or v_size is null or v_size <= 0 or v_size > 5242880 then
    raise exception 'validation.photo_file' using errcode = 'P0001', hint = 'Use a JPG, PNG or WebP photo up to 5 MB.';
  end if;
  if (select count(*) from public.listing_images where listing_id = p_listing_id) >= 8 then
    raise exception 'validation.photo_limit' using errcode = 'P0001', hint = 'A listing can have up to 8 photos.';
  end if;
  if exists (select 1 from public.listing_images where listing_id = p_listing_id and path = p_path) then
    raise exception 'conflict.photo_exists' using errcode = 'P0001', hint = 'This photo is already on the listing.';
  end if;
  insert into public.listing_images (listing_id, path, sort_order)
  values (p_listing_id, p_path, coalesce((select max(sort_order) + 1 from public.listing_images where listing_id = p_listing_id), 0))
  returning id into v_id;
  return v_id;
end
$$;

-- Returns the storage path so the client can delete the object afterwards.
create function public.remove_listing_image(p_image_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_img public.listing_images;
  v public.listings;
begin
  select * into v_img from public.listing_images where id = p_image_id;
  if not found then
    raise exception 'not_found.photo' using errcode = 'P0001', hint = 'This photo was already removed.';
  end if;
  v := app_private.lock_own_listing(v_img.listing_id);
  if v.status = 'active' and (select count(*) from public.listing_images where listing_id = v.id) <= 1 then
    raise exception 'validation.photos' using errcode = 'P0001', hint = 'An active listing needs at least one photo. Add another first, or pause the listing.';
  end if;
  delete from public.listing_images where id = p_image_id;
  -- Re-number to keep a gap-free order.
  update public.listing_images i set sort_order = o.rn - 1
    from (select id, row_number() over (order by sort_order, created_at) as rn from public.listing_images where listing_id = v.id) o
   where i.id = o.id;
  return v_img.path;
end
$$;

-- p_image_ids must be exactly the listing's photos, in the new order (first = cover).
create function public.reorder_listing_images(p_listing_id uuid, p_image_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.listings;
begin
  v := app_private.lock_own_listing(p_listing_id);
  if (select coalesce(array_agg(id order by id), '{}') from public.listing_images where listing_id = p_listing_id)
     <> (select coalesce(array_agg(x order by x), '{}') from unnest(p_image_ids) x) then
    raise exception 'conflict.photos_changed' using errcode = 'P0001', hint = 'The photos changed. Refresh and try again.';
  end if;
  update public.listing_images i set sort_order = o.pos - 1
    from unnest(p_image_ids) with ordinality o(id, pos)
   where i.id = o.id;
end
$$;

-- ── Availability blocks ────────────────────────────────────────────────────
create function public.add_availability_block(p_listing_id uuid, p_start date, p_end date, p_reason text default null) returns uuid
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
  insert into public.listing_availability (listing_id, start_date, end_date, reason)
  values (p_listing_id, greatest(p_start, v_today), p_end, nullif(trim(coalesce(p_reason, '')), ''))
  returning id into v_id;
  return v_id;
end
$$;

create function public.remove_availability_block(p_block_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_listing uuid;
begin
  select listing_id into v_listing from public.listing_availability where id = p_block_id;
  if not found then
    raise exception 'not_found.block' using errcode = 'P0001', hint = 'This block was already removed.';
  end if;
  perform app_private.lock_own_listing(v_listing);
  delete from public.listing_availability where id = p_block_id;
end
$$;

-- ── Reports and moderation ─────────────────────────────────────────────────
create function public.report_listing(p_listing_id uuid, p_reason text, p_details text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v public.listings;
  v_id uuid;
begin
  if auth.uid() is null or app_private.verification_status(auth.uid()) <> 'verified' then
    raise exception 'forbidden.not_verified' using errcode = 'P0001', hint = 'Only verified students can report listings.';
  end if;
  select * into v from public.listings where id = p_listing_id;
  if not found or not app_private.can_view_listing(p_listing_id) then
    raise exception 'not_found.listing' using errcode = 'P0001', hint = 'This listing is no longer available.';
  end if;
  if v.lender_id = auth.uid() then
    raise exception 'forbidden.own_listing' using errcode = 'P0001', hint = 'You can’t report your own listing.';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) not between 3 and 200 then
    raise exception 'validation.reason' using errcode = 'P0001', hint = 'Tell us briefly what’s wrong (3–200 characters).';
  end if;
  if exists (select 1 from public.listing_reports where listing_id = p_listing_id and reporter_id = auth.uid() and status in ('open', 'reviewing')) then
    raise exception 'conflict.already_reported' using errcode = 'P0001', hint = 'You already reported this listing. A moderator will review it.';
  end if;
  insert into public.listing_reports (listing_id, reporter_id, reason, details)
  values (p_listing_id, auth.uid(), trim(p_reason), nullif(trim(coalesce(p_details, '')), ''))
  returning id into v_id;
  update public.listings set moderation_status = 'reported' where id = p_listing_id and moderation_status = 'ok';
  perform app_private.notify_staff('listing.reported', 'Listing reported', v.title || ': ' || trim(p_reason), 'listing', p_listing_id, 'report:' || v_id);
  perform app_private.audit('listing.reported', 'listing', p_listing_id::text, jsonb_build_object('report', v_id));
  return v_id;
end
$$;

-- Staff decision: dismiss (listing stays visible) or hide (removed from browsing until restored).
create function public.resolve_listing_report(p_report_id uuid, p_action text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.listing_reports;
  v public.listings;
begin
  if not app_private.is_staff() then
    raise exception 'forbidden.staff_only' using errcode = 'P0001', hint = 'Only TigRent moderators can resolve reports.';
  end if;
  if p_action not in ('dismiss', 'hide') then
    raise exception 'validation.action' using errcode = 'P0001', hint = 'Choose dismiss or hide.';
  end if;
  select * into r from public.listing_reports where id = p_report_id for update;
  if not found then
    raise exception 'not_found.report' using errcode = 'P0001', hint = 'This report no longer exists.';
  end if;
  if r.status not in ('open', 'reviewing') then
    raise exception 'conflict.already_resolved' using errcode = 'P0001', hint = 'Another moderator already resolved this report.';
  end if;
  if p_action = 'hide' and char_length(trim(coalesce(p_note, ''))) < 10 then
    raise exception 'validation.note_required' using errcode = 'P0001', hint = 'Explain why the listing is hidden (at least 10 characters). The lender sees this.';
  end if;
  select * into v from public.listings where id = r.listing_id for update;

  if p_action = 'hide' then
    -- Hiding resolves every open report on the listing.
    update public.listing_reports set status = 'actioned', resolved_by = auth.uid(), resolved_at = now()
     where listing_id = r.listing_id and status in ('open', 'reviewing');
    update public.listings set moderation_status = 'hidden', is_featured = false where id = r.listing_id;
    perform app_private.notify(v.lender_id, 'listing.hidden', 'Listing hidden by a moderator',
      v.title || ': ' || trim(p_note), 'listing', v.id, 'listing:' || v.id || ':hidden:' || p_report_id);
  else
    update public.listing_reports set status = 'dismissed', resolved_by = auth.uid(), resolved_at = now() where id = p_report_id;
    if not exists (select 1 from public.listing_reports where listing_id = r.listing_id and status in ('open', 'reviewing')) then
      update public.listings set moderation_status = 'ok' where id = r.listing_id and moderation_status = 'reported';
    end if;
  end if;
  perform app_private.audit('listing_report.' || p_action, 'listing', r.listing_id::text, jsonb_build_object('report', p_report_id, 'note', p_note));
end
$$;

create function public.restore_listing(p_listing_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.listings;
begin
  if not app_private.is_staff() then
    raise exception 'forbidden.staff_only' using errcode = 'P0001', hint = 'Only TigRent moderators can restore listings.';
  end if;
  select * into v from public.listings where id = p_listing_id for update;
  if not found or v.moderation_status <> 'hidden' then
    raise exception 'conflict.not_hidden' using errcode = 'P0001', hint = 'This listing isn’t hidden.';
  end if;
  update public.listings set moderation_status = 'ok' where id = p_listing_id;
  perform app_private.notify(v.lender_id, 'listing.restored', 'Listing restored', v.title || ' is visible again.', 'listing', v.id,
    'listing:' || v.id || ':restored:' || extract(epoch from now())::bigint);
  perform app_private.audit('listing.restored', 'listing', p_listing_id::text, jsonb_build_object('note', p_note));
end
$$;

revoke all on function
  public.create_listing(jsonb), public.update_listing(uuid, jsonb), public.set_listing_status(uuid, public.listing_status),
  public.add_listing_image(uuid, text), public.remove_listing_image(uuid), public.reorder_listing_images(uuid, uuid[]),
  public.add_availability_block(uuid, date, date, text), public.remove_availability_block(uuid),
  public.report_listing(uuid, text, text), public.resolve_listing_report(uuid, text, text), public.restore_listing(uuid, text)
from public, anon;
grant execute on function
  public.create_listing(jsonb), public.update_listing(uuid, jsonb), public.set_listing_status(uuid, public.listing_status),
  public.add_listing_image(uuid, text), public.remove_listing_image(uuid), public.reorder_listing_images(uuid, uuid[]),
  public.add_availability_block(uuid, date, date, text), public.remove_availability_block(uuid),
  public.report_listing(uuid, text, text), public.resolve_listing_report(uuid, text, text), public.restore_listing(uuid, text)
to authenticated;
-- Internal helpers are only called from the SECURITY DEFINER functions above (owner rights).
revoke execute on function app_private.validate_listing_fields(jsonb), app_private.require_active_lender(), app_private.lock_own_listing(uuid)
from public, authenticated;
