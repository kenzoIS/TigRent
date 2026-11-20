-- Phase 4: student verification submission, manual demo review, academic-year rules (plan §2.2).
-- Provider today: 'manual_demo' (labelled "Manual student review" in the app). A future SheerID or
-- other approved provider plugs into provider/provider_ref/provider_status without schema changes.

-- A document can back only one submission: resubmission always means a new file (history preserved).
create unique index student_verifications_document_once on public.student_verifications (document_path) where document_path is not null;

-- Notify every staff member (deduplicated per key).
create function app_private.notify_staff(p_type text, p_title text, p_body text, p_entity_type text, p_entity_id uuid, p_dedupe text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, type, title, body, entity_type, entity_id, dedupe_key)
  select distinct r.user_id, p_type, p_title, p_body, p_entity_type, p_entity_id, p_dedupe || ':' || r.user_id
    from public.user_roles r where r.role in ('admin', 'moderator')
  on conflict (dedupe_key) do nothing
$$;

create function app_private.notify(p_user uuid, p_type text, p_title text, p_body text, p_entity_type text, p_entity_id uuid, p_dedupe text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, type, title, body, entity_type, entity_id, dedupe_key)
  values (p_user, p_type, p_title, p_body, p_entity_type, p_entity_id, p_dedupe)
  on conflict (dedupe_key) do nothing
$$;

-- ── Student submission ─────────────────────────────────────────────────────
create function public.submit_verification(
  p_full_name text,
  p_student_email text,
  p_student_id text,
  p_academic_year_id uuid,
  p_requested_roles public.marketplace_role[],
  p_document_path text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_status public.verification_status;
  v_domains jsonb := coalesce(app_private.setting('email_domain_allowlist'), '[]'::jsonb);
  v_pattern text := coalesce(app_private.setting('student_id_pattern') #>> '{}', '.+');
  v_doc_rules jsonb := coalesce(app_private.setting('verification_document'), '{}'::jsonb);
  v_allow_other_year boolean := coalesce((app_private.setting('allow_non_current_academic_year'))::boolean, false);
  v_provider text := coalesce(app_private.setting('verification_provider_mode') #>> '{}', 'manual_demo');
  v_year public.academic_years;
  v_email text := lower(trim(coalesce(p_student_email, '')));
  v_domain text;
  v_obj record;
  v_size bigint;
  v_mime text;
  v_row public.student_verifications;
begin
  if v_uid is null then
    raise exception 'unauthenticated.no_session' using errcode = 'P0001', hint = 'Please sign in.';
  end if;
  if exists (select 1 from public.terms_versions t where t.is_active and t.doc_type in ('tos', 'privacy')
              and not exists (select 1 from public.terms_acceptances a where a.user_id = v_uid and a.terms_version_id = t.id)) then
    raise exception 'forbidden.terms_required' using errcode = 'P0001', hint = 'Accept the current Terms and Privacy Notice first.';
  end if;

  v_status := app_private.verification_status(v_uid);
  if v_status = 'pending_review' then
    raise exception 'conflict.already_pending' using errcode = 'P0001', hint = 'Your previous submission is still waiting for review.';
  elsif v_status = 'verified' then
    raise exception 'conflict.already_verified' using errcode = 'P0001', hint = 'You are already verified for this academic year.';
  end if;

  if char_length(trim(coalesce(p_full_name, ''))) not between 2 and 120 then
    raise exception 'validation.full_name' using errcode = 'P0001', hint = 'Enter your full name as it appears on your registration form.';
  end if;

  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'validation.student_email' using errcode = 'P0001', hint = 'Enter a valid email address.';
  end if;
  v_domain := split_part(v_email, '@', 2);
  if not exists (select 1 from jsonb_array_elements_text(v_domains) d where lower(d) = v_domain) then
    raise exception 'validation.student_email_domain' using errcode = 'P0001',
      hint = 'Use your university email address (' || (select string_agg(d, ', ') from jsonb_array_elements_text(v_domains) d) || ').';
  end if;

  if trim(coalesce(p_student_id, '')) !~ v_pattern then
    raise exception 'validation.student_id' using errcode = 'P0001', hint = 'Check your student ID format.';
  end if;

  select * into v_year from public.academic_years where id = p_academic_year_id;
  if not found or v_year.is_archived then
    raise exception 'validation.academic_year' using errcode = 'P0001', hint = 'Choose an available academic year.';
  end if;
  if not v_year.is_current and not v_allow_other_year then
    raise exception 'validation.academic_year_not_current' using errcode = 'P0001',
      hint = 'Submit a registration form for the current academic year.';
  end if;

  if coalesce(array_length(p_requested_roles, 1), 0) = 0 then
    raise exception 'validation.roles' using errcode = 'P0001', hint = 'Choose whether you want to borrow, lend, or both.';
  end if;

  -- The document must be an uploaded object in the user's own private folder.
  if p_document_path is null or split_part(p_document_path, '/', 1) <> v_uid::text then
    raise exception 'validation.document' using errcode = 'P0001', hint = 'Upload your registration form.';
  end if;
  select o.metadata into v_obj from storage.objects o where o.bucket_id = 'verification-docs' and o.name = p_document_path;
  if not found then
    raise exception 'validation.document_missing' using errcode = 'P0001', hint = 'The upload didn’t finish. Please upload the file again.';
  end if;
  -- Trust the storage server's metadata, not client-reported values.
  v_size := nullif(v_obj.metadata ->> 'size', '')::bigint;
  v_mime := lower(coalesce(v_obj.metadata ->> 'mimetype', ''));
  if v_size is null or v_size <= 0 or v_size > coalesce((v_doc_rules ->> 'max_bytes')::bigint, 10485760) then
    raise exception 'validation.document_size' using errcode = 'P0001', hint = 'The file is empty or too large.';
  end if;
  if not exists (select 1 from jsonb_array_elements_text(coalesce(v_doc_rules -> 'mime_types', '[]'::jsonb)) m where lower(m) = v_mime) then
    raise exception 'validation.document_type' using errcode = 'P0001', hint = 'Upload a PDF, JPG, PNG or HEIC file.';
  end if;
  if exists (select 1 from public.student_verifications where document_path = p_document_path) then
    raise exception 'validation.document_reused' using errcode = 'P0001', hint = 'Upload a new file for this submission.';
  end if;

  insert into public.student_verifications (user_id, academic_year_id, full_name, student_email, student_id, requested_roles,
    document_path, document_mime, document_size_bytes, status, provider)
  values (v_uid, v_year.id, trim(p_full_name), v_email, trim(p_student_id),
    (select array_agg(distinct r order by r) from unnest(p_requested_roles) r), p_document_path, v_mime, v_size::integer, 'pending_review', v_provider)
  returning * into v_row;

  perform app_private.notify(v_uid, 'verification.submitted', 'Verification submitted',
    'Your details are waiting for manual review. We’ll notify you when a reviewer decides.', 'verification', v_row.id,
    'verification:' || v_row.id || ':submitted');
  perform app_private.notify_staff('verification.queued', 'New student verification',
    trim(p_full_name) || ' submitted documents for review.', 'verification', v_row.id, 'verification:' || v_row.id || ':queued');
  perform app_private.audit('verification.submitted', 'student_verification', v_row.id::text,
    jsonb_build_object('academic_year', v_year.label, 'provider', v_provider));

  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'submitted_at', v_row.submitted_at);
end
$$;

-- ── Staff review ───────────────────────────────────────────────────────────
create function public.review_verification(p_verification_id uuid, p_decision text, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_row public.student_verifications;
  v_year public.academic_years;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_new public.verification_status;
begin
  -- (An audit row written here would be rolled back by the RAISE; denied calls appear in API logs.)
  if not app_private.is_staff() then
    raise exception 'forbidden.staff_only' using errcode = 'P0001', hint = 'Only TigRent reviewers can review verifications.';
  end if;
  if p_decision not in ('approve', 'reject', 'request_resubmission') then
    raise exception 'validation.decision' using errcode = 'P0001', hint = 'Choose approve, reject or request resubmission.';
  end if;

  select * into v_row from public.student_verifications where id = p_verification_id for update;
  if not found then
    raise exception 'not_found.verification' using errcode = 'P0001', hint = 'This submission no longer exists.';
  end if;
  if v_row.user_id = v_uid then
    raise exception 'forbidden.self_review' using errcode = 'P0001', hint = 'Reviewers can’t decide on their own submission.';
  end if;
  if v_row.status <> 'pending_review' then
    raise exception 'conflict.already_reviewed' using errcode = 'P0001', hint = 'Another reviewer already decided on this submission.';
  end if;
  if p_decision <> 'approve' and char_length(coalesce(v_reason, '')) < 10 then
    raise exception 'validation.reason_required' using errcode = 'P0001', hint = 'Explain the decision so the student knows what to fix (at least 10 characters).';
  end if;

  select * into v_year from public.academic_years where id = v_row.academic_year_id;
  v_new := case p_decision when 'approve' then 'verified' when 'reject' then 'rejected' else 'needs_resubmission' end;

  update public.student_verifications set
    status = v_new,
    review_reason = v_reason,
    reviewed_by = v_uid,
    reviewed_at = now(),
    -- Verification lasts until the end of its academic year (expiry policy, §2.2).
    expires_at = case when v_new = 'verified' then app_private.manila_timestamp(v_year.end_date, '23:59') end
  where id = v_row.id
  returning * into v_row;

  if v_new = 'verified' then
    insert into public.user_roles (user_id, role, granted_by)
    select v_row.user_id, r::text::public.app_role, v_uid from unnest(v_row.requested_roles) r
    on conflict do nothing;
    perform app_private.notify(v_row.user_id, 'verification.approved', 'You’re verified',
      'Your student verification was approved. You can now use TigRent.', 'verification', v_row.id, 'verification:' || v_row.id || ':decided');
  elsif v_new = 'rejected' then
    perform app_private.notify(v_row.user_id, 'verification.rejected', 'Verification not approved',
      'Reason: ' || v_reason, 'verification', v_row.id, 'verification:' || v_row.id || ':decided');
  else
    perform app_private.notify(v_row.user_id, 'verification.needs_resubmission', 'Please resubmit your verification',
      'Reason: ' || v_reason, 'verification', v_row.id, 'verification:' || v_row.id || ':decided');
  end if;
  perform app_private.audit('verification.' || v_new, 'student_verification', v_row.id::text,
    jsonb_build_object('decision', p_decision, 'reason', v_reason, 'student', v_row.user_id));

  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'reviewed_at', v_row.reviewed_at);
end
$$;

-- ── Academic-year configuration (admin) ────────────────────────────────────
create function public.create_academic_year(p_label text, p_start date, p_end date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not app_private.has_role('admin') then
    raise exception 'forbidden.admin_only' using errcode = 'P0001', hint = 'Only administrators can configure academic years.';
  end if;
  if char_length(trim(coalesce(p_label, ''))) not between 3 and 40 then
    raise exception 'validation.label' using errcode = 'P0001', hint = 'Enter a label such as “AY 2027–2028”.';
  end if;
  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'validation.dates' using errcode = 'P0001', hint = 'The end date must be after the start date.';
  end if;
  if exists (select 1 from public.academic_years where lower(label) = lower(trim(p_label))) then
    raise exception 'conflict.label_taken' using errcode = 'P0001', hint = 'An academic year with this label already exists.';
  end if;
  insert into public.academic_years (label, start_date, end_date, is_current, is_archived, is_sample)
  values (trim(p_label), p_start, p_end, false, false, false) returning id into v_id;
  perform app_private.audit('academic_year.created', 'academic_year', v_id::text, jsonb_build_object('label', trim(p_label)));
  return v_id;
end
$$;

-- Switch the current academic year. With the expiry policy on, verifications for other years expire
-- now and those students are routed to renewal (lazy expiry via verification_status).
create function public.set_current_academic_year(p_academic_year_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_expire boolean := coalesce((app_private.setting('verification_expiry') ->> 'expire_on_academic_year_change')::boolean, true);
  v_year public.academic_years;
  v_expired integer := 0;
  r record;
begin
  if not app_private.has_role('admin') then
    raise exception 'forbidden.admin_only' using errcode = 'P0001', hint = 'Only administrators can configure academic years.';
  end if;
  select * into v_year from public.academic_years where id = p_academic_year_id for update;
  if not found then
    raise exception 'not_found.academic_year' using errcode = 'P0001', hint = 'That academic year no longer exists.';
  end if;
  if v_year.is_current then
    return jsonb_build_object('academic_year', v_year.label, 'expired_verifications', 0);
  end if;

  update public.academic_years set is_current = false where is_current;
  update public.academic_years set is_current = true, is_archived = false where id = v_year.id;

  if v_expire then
    for r in
      update public.student_verifications v set expires_at = now()
       where v.status = 'verified' and v.academic_year_id <> v_year.id and (v.expires_at is null or v.expires_at > now())
      returning v.id, v.user_id
    loop
      v_expired := v_expired + 1;
      perform app_private.notify(r.user_id, 'verification.expired', 'Renew your student verification',
        'A new academic year (' || v_year.label || ') has started. Submit your current registration form to keep using TigRent.',
        'verification', r.id, 'verification:' || r.id || ':expired');
    end loop;
  end if;

  perform app_private.audit('academic_year.set_current', 'academic_year', v_year.id::text,
    jsonb_build_object('label', v_year.label, 'expired_verifications', v_expired, 'expiry_policy', v_expire));
  return jsonb_build_object('academic_year', v_year.label, 'expired_verifications', v_expired);
end
$$;

revoke all on function
  public.submit_verification(text, text, text, uuid, public.marketplace_role[], text),
  public.review_verification(uuid, text, text),
  public.create_academic_year(text, date, date),
  public.set_current_academic_year(uuid)
from public, anon;
grant execute on function
  public.submit_verification(text, text, text, uuid, public.marketplace_role[], text),
  public.review_verification(uuid, text, text),
  public.create_academic_year(text, date, date),
  public.set_current_academic_year(uuid)
to authenticated;
revoke execute on function
  app_private.notify(uuid, text, text, text, text, uuid, text),
  app_private.notify_staff(text, text, text, text, uuid, text)
from authenticated, public;
