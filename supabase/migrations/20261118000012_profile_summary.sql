-- Phase 5: profile summary with ratings, completed rentals and badges (plan §2.9, §4.1, Phase 5).
-- Badges:
--   student_verified       latest verification is current and verified
--   trusted_lender         configurable rule (trusted_lender_rule); a TigRent prototype badge,
--                          never an official UST endorsement (plan §2.9, §10.4)

create function public.get_profile_summary(p_user_id uuid default null) returns jsonb
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
  -- Other members' profiles are visible to verified students and staff (closed community, §1).
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
  select round(avg(rating)::numeric, 2), count(*) into v_lender_avg, v_lender_reviews
    from public.reviews where target_id = v_user and direction = 'borrower_to_lender' and moderation_status = 'visible';
  select round(avg(rating)::numeric, 2), count(*) into v_borrower_avg, v_borrower_reviews
    from public.reviews where target_id = v_user and direction = 'lender_to_borrower' and moderation_status = 'visible';
  select count(*) into v_severe
    from public.disputes d join public.bookings b on b.id = d.booking_id
   where b.lender_id = v_user and d.severity = 'severe'
     and d.status not in ('resolved_refund', 'resolved_compensation', 'closed');

  v_trusted := v_verified
    and v_profile.account_status = 'active'
    and v_lend_count >= coalesce((v_rule ->> 'min_completed_lendings')::int, 5)
    and coalesce(v_lender_avg, 0) >= coalesce((v_rule ->> 'min_avg_rating')::numeric, 4.5)
    and (not coalesce((v_rule ->> 'no_unresolved_severe_disputes')::boolean, true) or v_severe = 0);

  if v_verified then
    v_badges := v_badges || jsonb_build_array(jsonb_build_object('code', 'student_verified', 'label', 'Student verified'));
  end if;
  if v_trusted then
    v_badges := v_badges || jsonb_build_array(jsonb_build_object('code', 'trusted_lender', 'label', 'Verified Trusted Lender'));
  end if;

  return jsonb_build_object(
    'user_id', v_profile.id,
    'full_name', v_profile.full_name,
    'avatar_path', v_profile.avatar_path,
    'member_since', v_profile.created_at,
    'is_student_verified', v_verified,
    'completed_lendings', v_lend_count,
    'completed_borrowings', v_borrow_count,
    'lender_rating', jsonb_build_object('avg', v_lender_avg, 'count', v_lender_reviews),
    'borrower_rating', jsonb_build_object('avg', v_borrower_avg, 'count', v_borrower_reviews),
    'badges', v_badges,
    -- Criteria and progress let the app explain the badge honestly (plan §2.9).
    'trusted_lender', jsonb_build_object(
      'earned', v_trusted,
      'rule', v_rule,
      'rule_is_sample', coalesce((select is_sample from public.platform_settings where key = 'trusted_lender_rule' and is_current), true),
      'progress', jsonb_build_object(
        'student_verified', v_verified,
        'account_in_good_standing', v_profile.account_status = 'active',
        'completed_lendings', v_lend_count,
        'avg_rating', v_lender_avg,
        'unresolved_severe_disputes', v_severe
      )
    )
  );
end
$$;

revoke all on function public.get_profile_summary(uuid) from public, anon;
grant execute on function public.get_profile_summary(uuid) to authenticated;
