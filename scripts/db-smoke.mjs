// Live smoke test against the hosted project using ONLY the publishable key (what the app ships).
// Verifies: seeded accounts can sign in, RLS boundaries hold over the real API, storage is private.
import { createClient } from '@supabase/supabase-js';
import { loadEnv, requireEnv } from './lib/env.mjs';

const env = loadEnv();
requireEnv(env, ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY']);
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const PASSWORD = 'TigRentDemo#2026';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};
const client = () => createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function signedIn(email) {
  const c = client();
  const { data, error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`${email}: ${error.message}`);
  return { c, id: data.user.id };
}

// 1. Anonymous access
{
  const anon = client();
  const { data: listings, error } = await anon.from('listings').select('id');
  check('anon cannot read listings', Boolean(error) || (listings ?? []).length === 0, error?.code ?? `${listings?.length} rows`);
  const { data: terms } = await anon.from('terms_versions').select('doc_type');
  check('anon can read active Terms/Privacy', (terms ?? []).length === 3, `${terms?.length} docs`);
}

// 2. Sign-in for seeded accounts (auth rows are valid for GoTrue)
const bea = await signedIn('bea.borrower@tigrent.test');
const leo = await signedIn('leo.lender@tigrent.test');
const dana = await signedIn('dana.dual@tigrent.test');
const paolo = await signedIn('paolo.pending@tigrent.test');
const admin = await signedIn('admin.demo@tigrent.test');
check('seeded demo accounts can sign in', true, '5 accounts');

// 3. Booking privacy
{
  const { data } = await bea.c.from('bookings').select('id, borrower_id, lender_id');
  check('borrower sees only own bookings', data.length > 0 && data.every((b) => [b.borrower_id, b.lender_id].includes(bea.id)), `${data.length} rows`);
  const { data: other } = await bea.c.from('bookings').select('id').eq('id', 'bbbbbbbb-0000-4000-8000-000000000002');
  check("borrower A cannot read borrower B's booking", other.length === 0);
  const { data: leoReq } = await leo.c.from('bookings').select('id').eq('status', 'pending_lender_approval');
  check('lender sees requests for own listings', leoReq.length === 2, `${leoReq.length} requests`);
}

// 4. Verification privacy and self-verification
{
  const { data } = await dana.c.from('student_verifications').select('id').eq('user_id', bea.id);
  check("student cannot read another student's verification", data.length === 0);
  const { error } = await paolo.c.from('student_verifications').update({ status: 'verified' }).eq('user_id', paolo.id);
  check('student cannot self-verify', Boolean(error), error?.code);
  const { data: market } = await paolo.c.from('listings').select('id');
  check('pending student cannot browse listings', market.length === 0);
  const { data: all } = await admin.c.from('student_verifications').select('id');
  check('admin can read the verification queue', all.length === 7, `${all.length} rows`);
}

// 5. Protected writes and admin data
{
  const { error: roleErr } = await bea.c.from('user_roles').insert({ user_id: bea.id, role: 'admin' });
  check('student cannot grant themselves admin', Boolean(roleErr), roleErr?.code);
  const { error: payErr } = await bea.c.from('payments').insert({ purpose: 'booking', booking_id: 'bbbbbbbb-0000-4000-8000-000000000001', payer_id: bea.id, amount: 1, idempotency_key: 'smoke-test-hack' });
  check('student cannot create payments directly', Boolean(payErr), payErr?.code);
  const { data: audit } = await bea.c.from('audit_logs').select('id');
  check('non-admin cannot read audit log', audit.length === 0);
  const { data: auditAdmin } = await admin.c.from('audit_logs').select('id');
  check('admin can read audit log', auditAdmin.length > 0, `${auditAdmin.length} rows`);
  const { data: pub } = await dana.c.from('public_profiles').select('*').eq('id', bea.id).single();
  check('public profile hides student ID/email/status', pub && !('student_id' in pub) && !('student_email' in pub) && !('account_status' in pub));
}

// 6. Storage is private
{
  const { connect } = await import('./lib/connection.mjs');
  const { client: db } = await connect();
  const { rows: buckets } = await db.query(`select id, public from storage.buckets where id in ('verification-docs', 'avatars', 'listing-images', 'evidence')`);
  await db.end();
  check('all four buckets exist and none is public', buckets.length === 4 && buckets.every((b) => !b.public), buckets.map((b) => `${b.id}:${b.public ? 'PUBLIC' : 'private'}`).join(', '));
  const upOwn = await paolo.c.storage.from('verification-docs').upload(`${paolo.id}/smoke-test.pdf`, new Blob(['%PDF-1.4 smoke'], { type: 'application/pdf' }), { upsert: true });
  check('student can upload into own verification folder', !upOwn.error, upOwn.error?.message);
  // The file now exists: its public URL must still be refused, while a signed URL works.
  const pubRes = await fetch(`${URL_}/storage/v1/object/public/verification-docs/${paolo.id}/smoke-test.pdf`);
  check('public URL of an existing verification document is refused', pubRes.status >= 400, `HTTP ${pubRes.status}`);
  const ownSigned = await paolo.c.storage.from('verification-docs').createSignedUrl(`${paolo.id}/smoke-test.pdf`, 60);
  const ownRes = ownSigned.data ? await fetch(ownSigned.data.signedUrl) : null;
  check('owner can fetch it through a short-lived signed URL', ownRes?.status === 200, `HTTP ${ownRes?.status}`);
  const upOther = await paolo.c.storage.from('verification-docs').upload(`${bea.id}/forged.pdf`, new Blob(['%PDF-1.4 x'], { type: 'application/pdf' }));
  check("student cannot upload into another student's folder", Boolean(upOther.error), upOther.error?.message);
  const signedOther = await dana.c.storage.from('verification-docs').createSignedUrl(`${paolo.id}/smoke-test.pdf`, 60);
  check("another student cannot get a signed URL for it", Boolean(signedOther.error), signedOther.error?.message);
  const signedAdmin = await admin.c.storage.from('verification-docs').createSignedUrl(`${paolo.id}/smoke-test.pdf`, 60);
  check('reviewer (admin) can get a short-lived signed URL', !signedAdmin.error && Boolean(signedAdmin.data?.signedUrl));
  const badType = await paolo.c.storage.from('verification-docs').upload(`${paolo.id}/script.html`, new Blob(['<script>'], { type: 'text/html' }), { upsert: true });
  check('disallowed file type is rejected', Boolean(badType.error), badType.error?.message);
  await paolo.c.storage.from('verification-docs').remove([`${paolo.id}/smoke-test.pdf`]);
}

// 7. Phase 3: server-held session context, role enablement, session restore
{
  const ctx = async (s) => (await s.c.rpc('get_my_session_context')).data;
  // Demo roles can change during manual testing (e.g. enabling lending), so compare with the database itself.
  const b = await ctx(bea);
  const { data: beaRoles } = await bea.c.from('user_roles').select('role').eq('user_id', bea.id).order('role');
  check('session context: verified, and roles match the server records', b?.verification_status === 'verified' && JSON.stringify(b?.roles) === JSON.stringify(beaRoles.map((r) => r.role)) && b.roles.includes('borrower'), b?.roles.join(','));
  const p = await ctx(paolo);
  check('session context: pending student reported as pending_review', p?.verification_status === 'pending_review');
  const rico = await signedIn('rico.restricted@tigrent.test');
  const r = await ctx(rico);
  check('session context: restricted account reported as paused', r?.account_status === 'paused_pending_review');

  const { error: pendErr } = await paolo.c.rpc('enable_marketplace_role', { p_role: 'lender' });
  check('pending student cannot enable a role', pendErr?.message === 'forbidden.not_verified', pendErr?.hint);
  const { error: rErr } = await rico.c.rpc('enable_marketplace_role', { p_role: 'lender' });
  check('restricted account cannot enable a new role', rErr?.message === 'forbidden.account_restricted');
  const { data: dd, error: dErr } = await dana.c.rpc('enable_marketplace_role', { p_role: 'lender' });
  check('enabling an existing role is idempotent', !dErr && JSON.stringify(dd?.roles) === '["borrower","lender"]');

  // Tampering with the UI preference never grants a role (Paolo holds no roles until approved).
  await paolo.c.from('profiles').update({ active_role_pref: 'lender' }).eq('id', paolo.id);
  const tampered = await ctx(paolo);
  check('active-role preference cannot grant the lender role', JSON.stringify(tampered?.roles) === '[]', JSON.stringify(tampered?.roles));
  await paolo.c.from('profiles').update({ active_role_pref: null }).eq('id', paolo.id);

  const { error: anonErr } = await client().rpc('get_my_session_context');
  check('anonymous callers cannot read a session context', Boolean(anonErr), anonErr?.code);

  // Session restore: a fresh client reading the same storage resumes the session (as the app does after restart).
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) };
  const first = createClient(URL_, KEY, { auth: { storage, persistSession: true, autoRefreshToken: false } });
  await first.auth.signInWithPassword({ email: 'leo.lender@tigrent.test', password: PASSWORD });
  const second = createClient(URL_, KEY, { auth: { storage, persistSession: true, autoRefreshToken: false } });
  const { data: restored } = await second.auth.getSession();
  const { data: restoredCtx } = await second.rpc('get_my_session_context');
  check('persisted session is restored by a new client', Boolean(restored.session) && JSON.stringify(restoredCtx?.roles) === '["lender"]');
  await second.auth.signOut();
  const { data: afterOut } = await second.auth.getSession();
  check('sign-out clears the stored session', !afterOut.session);
  await rico.c.auth.signOut();
}

// 8. Phase 4: verification rules (read-only / refused calls; no demo data changes)
{
  const sub = (s) => s.c.rpc('submit_verification', {
    p_full_name: 'Smoke Test', p_student_email: 'smoke@ust.edu.ph', p_student_id: '2026-00000',
    p_academic_year_id: 'eeeeeeee-0000-4000-8000-000000000002', p_requested_roles: ['borrower'], p_document_path: `${s.id}/none.pdf`,
  });
  check('pending student cannot submit twice', (await sub(paolo)).error?.message === 'conflict.already_pending');
  check('verified student cannot resubmit while valid', (await sub(bea)).error?.message === 'conflict.already_verified');
  const { data: q } = await paolo.c.from('student_verifications').select('id').eq('user_id', paolo.id);
  const rev = await bea.c.rpc('review_verification', { p_verification_id: q[0].id, p_decision: 'approve' });
  check('non-staff cannot review verifications', rev.error?.message === 'forbidden.staff_only');
  const ay = await bea.c.rpc('create_academic_year', { p_label: 'AY hack', p_start: '2030-01-01', p_end: '2030-12-31' });
  check('non-admin cannot configure academic years', ay.error?.message === 'forbidden.admin_only');
  const doc = await admin.c.storage.from('verification-docs').createSignedUrl(`${paolo.id}/registration-form-SAMPLE.pdf`, 60);
  const res = doc.data ? await fetch(doc.data.signedUrl) : null;
  const head = res ? new TextDecoder().decode((await res.arrayBuffer()).slice(0, 5)) : '';
  check('reviewer can open the sample registration form (signed URL)', res?.status === 200 && head === '%PDF-', `HTTP ${res?.status}`);
  const other = await bea.c.storage.from('verification-docs').createSignedUrl(`${paolo.id}/registration-form-SAMPLE.pdf`, 60);
  check("another student cannot open someone else's registration form", Boolean(other.error));
}

// 9. Phase 5: profile summary, badges, dashboard data (read-only)
{
  const mika = await signedIn('mika.lender@tigrent.test');
  const { data: ms } = await mika.c.rpc('get_profile_summary', {});
  check('Mika holds Student verified + Verified Trusted Lender (sample rule)', JSON.stringify(ms?.badges.map((b) => b.code)) === '["student_verified","trusted_lender"]');
  const { data: ls } = await bea.c.rpc('get_profile_summary', { p_user_id: leo.id });
  check('Leo is verified but not yet a Trusted Lender; progress is explained', ls?.trusted_lender.earned === false && ls?.trusted_lender.progress.student_verified === true);
  const rico = await signedIn('rico.restricted@tigrent.test');
  const { data: rs } = await rico.c.rpc('get_profile_summary', {});
  check('ratings are split by role (Rico: 3 borrower reviews, 0 as lender)', rs?.borrower_rating.count === 3 && rs?.lender_rating.count === 0);
  const { error: pErr } = await paolo.c.rpc('get_profile_summary', { p_user_id: leo.id });
  check("pending student cannot view other members' profiles", pErr?.message === 'forbidden.not_verified');
  const { data: payables } = await leo.c.from('ledger_entries').select('category, credit');
  check('lender dashboard sees only own payable lines (no commission lines)', payables.length > 0 && payables.every((p) => p.category === 'rent_payable'));
  const { count } = await leo.c.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
  check('unread notification count is available to the owner', typeof count === 'number', `${count} unread`);
  await mika.c.auth.signOut();
  await rico.c.auth.signOut();
}

// 10. Phase 6: seeded listings have sample cover photos that verified borrowers can load
{
  const { data: imgs } = await dana.c.from('listing_images').select('path, listings!inner(status)').eq('listings.status', 'active');
  const signed = await dana.c.storage.from('listing-images').createSignedUrls(imgs.map((i) => i.path), 60);
  const first = signed.data?.find((s) => s.signedUrl);
  const res = first ? await fetch(first.signedUrl) : null;
  check('active listings have sample photos borrowers can load', imgs.length >= 10 && (signed.data ?? []).every((s) => s.signedUrl) && res?.status === 200, `${imgs.length} photos`);
  const draft = await dana.c.from('listings').select('id').eq('id', '11111111-0000-4000-8000-000000000006');
  check("borrowers can't see another lender's draft", draft.data.length === 0);
}

// 11. Phase 7: discovery (read-only)
{
  const manilaToday = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const plus = (n) => new Date(Date.parse(manilaToday) + n * 86400e3).toISOString().slice(0, 10);
  const { data: calc } = await dana.c.rpc('search_listings', { p_query: 'calculator' });
  check('keyword search finds seeded calculators', calc?.length >= 2 && calc.every((r) => /calculator/i.test(r.title)), `${calc?.length} results`);
  const { data: cheap } = await dana.c.rpc('search_listings', { p_max_rate: 5000, p_sort: 'price_asc' });
  check('price filter and sort work', cheap.length > 0 && cheap.every((r, i, a) => r.daily_rate <= 5000 && (i === 0 || a[i - 1].daily_rate <= r.daily_rate)));
  const { data: trusted } = await dana.c.rpc('search_listings', { p_trusted_only: true });
  check('Trusted Lender filter returns only trusted lenders', trusted.length > 0 && trusted.every((r) => r.lender_trusted));
  const { data: own } = await leo.c.rpc('search_listings', {});
  check("a lender's own listings are excluded from their search", own.every((r) => r.lender_id !== leo.id));
  const dslr = '11111111-0000-4000-8000-000000000002';
  // Use the seeded booking's real dates (the seed is relative to the day it ran, so fixed offsets drift).
  const { data: held } = await bea.c.from('bookings').select('pickup_date, status').eq('listing_id', dslr).in('status', ['confirmed', 'active']).limit(1);
  if (held?.[0]) {
    const { data: datesBooked } = await dana.c.rpc('search_listings', { p_start: held[0].pickup_date, p_end: held[0].pickup_date });
    check('date filter excludes items booked on those dates', !datesBooked.some((r) => r.id === dslr), held[0].pickup_date);
  } else {
    console.log('SKIP  date filter check (the seeded DSLR booking was changed during manual testing)');
  }
  const { data: ranges } = await dana.c.rpc('get_listing_unavailable_dates', { p_listing_id: dslr, p_from: manilaToday, p_to: plus(60) });
  check('calendar ranges reveal no booking identities', ranges.length > 0 && ranges.every((r) => Object.keys(r).sort().join() === 'end_date,reason,start_date'));
  const { data: q } = await dana.c.rpc('quote_booking', { p_listing_id: '11111111-0000-4000-8000-000000000001', p_pickup: plus(30), p_return: plus(32) });
  check('server quote: 3 inclusive days, deposit separate', q?.rental_days === 3 && q.subtotal === 12000 && q.total === 42000, q ? `₱${q.total / 100}` : 'no quote');
  const ownQ = await leo.c.rpc('quote_booking', { p_listing_id: '11111111-0000-4000-8000-000000000001', p_pickup: plus(30), p_return: plus(30) });
  check('lenders cannot quote their own listing', ownQ.error?.message === 'forbidden.own_listing');
  const pend = await paolo.c.rpc('search_listings', {});
  check('pending students cannot search', pend.error?.message === 'forbidden.not_verified');
}

// 12. Phase 8: booking flow guards (refused calls and reads only; no demo data changes)
{
  const manilaToday = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const plus = (n) => new Date(Date.parse(manilaToday) + n * 86400e3).toISOString().slice(0, 10);
  const { data: terms } = await bea.c.from('terms_versions').select('id').eq('doc_type', 'rental_terms').eq('is_active', true).single();
  const reqArgs = { p_listing_id: '11111111-0000-4000-8000-000000000004', p_pickup: plus(60), p_return: plus(61), p_terms_version_id: terms?.id };
  const pend = await paolo.c.rpc('request_booking', reqArgs);
  check('pending students cannot request bookings', /^forbidden\./.test(pend.error?.message ?? ''), pend.error?.message);
  const stale = await dana.c.rpc('request_booking', { ...reqArgs, p_terms_version_id: '00000000-0000-4000-8000-000000000000' });
  check('requests against outdated rental terms are refused', stale.error?.message === 'conflict.terms_changed', stale.error?.message);
  const own = await leo.c.rpc('request_booking', reqArgs);
  check('a lender cannot request their own listing', /^forbidden\./.test(own.error?.message ?? ''), own.error?.message);
  const seededPending = 'bbbbbbbb-0000-4000-8000-000000000004'; // Dana → Leo's calculator
  const notLender = await bea.c.rpc('decide_booking_request', { p_booking_id: seededPending, p_decision: 'accept' });
  check("only the listing's lender can decide a request", notLender.error?.message === 'not_found.booking', notLender.error?.message);
  const seededConfirmed = 'bbbbbbbb-0000-4000-8000-000000000001'; // Bea's confirmed DSLR rental
  const notPayer = await dana.c.rpc('pay_booking_demo', { p_booking_id: seededConfirmed, p_idempotency_key: 'smoke-not-payer-1', p_scenario: 'success' });
  check("only the borrower can pay for a booking", notPayer.error?.message === 'not_found.booking', notPayer.error?.message);
  const strangerDetail = await paolo.c.rpc('get_booking_detail', { p_booking_id: seededConfirmed });
  check('booking details are hidden from non-parties', strangerDetail.error?.message === 'not_found.booking');
  const { data: mine, error: mineErr } = await bea.c.rpc('get_booking_detail', { p_booking_id: seededConfirmed });
  check('a borrower sees their booking with its receipt and no lender-only data', !mineErr && mine?.my_role === 'borrower' && mine.conflict === null && mine.payments.some((p) => p.status === 'succeeded'), mineErr?.message ?? mine?.status);
  const { data: inbox, error: inboxErr } = await leo.c.rpc('list_booking_requests');
  check('the lender inbox loads', !inboxErr && Array.isArray(inbox), inboxErr?.message ?? `${inbox?.length} rows`);
  const anonSweep = await client().rpc('sweep_expired_holds');
  check('anonymous callers cannot run the expiry sweep', Boolean(anonSweep.error));
  const direct = await bea.c.from('bookings').update({ status: 'confirmed' }).eq('id', seededPending).select('id');
  check('bookings cannot be changed directly through the API', Boolean(direct.error) || (direct.data ?? []).length === 0, direct.error?.code);
}

// 13. Phase 9: rental lifecycle guards and messaging (refused calls and reads only; no demo data changes)
{
  const seededConfirmed = 'bbbbbbbb-0000-4000-8000-000000000001'; // Bea's confirmed DSLR rental (Leo lends)
  const { data: det } = await bea.c.rpc('get_booking_detail', { p_booking_id: seededConfirmed });
  const conv = det?.conversation_id;
  check('every booking has a conversation', Boolean(conv));
  const { data: thread, error: threadErr } = await bea.c.rpc('get_conversation', { p_conversation_id: conv });
  check('a participant reads the booking conversation', !threadErr && thread?.messages.length >= 2, threadErr?.message ?? `${thread?.messages.length} messages`);
  const stranger = await dana.c.rpc('get_conversation', { p_conversation_id: conv });
  check('non-participants cannot read a conversation', stranger.error?.message === 'not_found.conversation');
  const strangerSend = await paolo.c.rpc('send_message', { p_conversation_id: conv, p_body: 'smoke test' });
  check('non-participants cannot send messages', strangerSend.error?.message === 'not_found.conversation');
  const strangerRows = await dana.c.from('messages').select('id').eq('conversation_id', conv);
  check('messages are hidden from non-participants', (strangerRows.data ?? []).length === 0);
  const { data: inbox, error: inboxErr } = await bea.c.rpc('list_my_conversations', { p_role: 'borrower' });
  check('the Messages tab lists the borrower’s conversations', !inboxErr && inbox.some((c) => c.conversation_id === conv));
  const lenderReturns = await leo.c.rpc('submit_return', { p_booking_id: seededConfirmed });
  check('a lender cannot submit the borrower’s return', lenderReturns.error?.message === 'forbidden.borrower_only', lenderReturns.error?.message);
  const borrowerInspects = await bea.c.rpc('confirm_clean_return', { p_booking_id: seededConfirmed });
  check('a borrower cannot confirm the inspection', borrowerInspects.error?.message === 'forbidden.lender_only', borrowerInspects.error?.message);
  const lenderExtends = await leo.c.rpc('request_extension', { p_booking_id: seededConfirmed, p_new_return: '2099-01-01' });
  check('a lender cannot request an extension', lenderExtends.error?.message === 'forbidden.borrower_only', lenderExtends.error?.message);
  const notLenderDecides = await bea.c.rpc('decide_extension', { p_extension_id: '00000000-0000-4000-8000-000000000000', p_decision: 'approve' });
  check('unknown extension requests are refused', notLenderDecides.error?.message === 'not_found.extension');
  const strangerHandover = await paolo.c.rpc('confirm_handover', { p_booking_id: seededConfirmed });
  check('non-parties cannot confirm a handover', strangerHandover.error?.message === 'not_found.booking');
  const anonJob = await client().rpc('process_due_events');
  check('anonymous callers cannot run the due-events job', Boolean(anonJob.error));
  const { error: extInboxErr } = await leo.c.rpc('list_extension_requests');
  check('the lender extension inbox loads', !extInboxErr, extInboxErr?.message);
}

// 14. Phase 10: cancellations, disputes and money guards (previews, refused calls and reads only)
{
  const seededConfirmed = 'bbbbbbbb-0000-4000-8000-000000000001'; // Bea's DSLR rental from Leo
  const seededPending = 'bbbbbbbb-0000-4000-8000-000000000004'; // Dana → Leo's calculator
  const seededDispute = '77777777-0000-4000-8000-000000000001'; // Leo vs Bea, drafting set
  const pv = await bea.c.rpc('preview_cancellation', { p_booking_id: seededConfirmed });
  check('a cancellation refund preview comes from the server policy', !pv.error && typeof pv.data?.allowed === 'boolean', pv.error?.message ?? `${pv.data?.rule}: ₱${(pv.data?.refund_total ?? 0) / 100}`);
  const strangerPv = await paolo.c.rpc('preview_cancellation', { p_booking_id: seededConfirmed });
  check('non-parties cannot preview a cancellation', strangerPv.error?.message === 'not_found.booking');
  const lenderPending = await leo.c.rpc('preview_cancellation', { p_booking_id: seededPending });
  check('lenders decline (not cancel) pending requests', lenderPending.data?.allowed === false || Boolean(lenderPending.error), lenderPending.data?.reason ?? lenderPending.error?.message);
  const notOverdue = await leo.c.rpc('report_not_returned', { p_booking_id: seededConfirmed, p_description: 'smoke test, should be refused', p_requested_amount: 0 });
  check('“not returned” can’t be reported before the due time', /^conflict\./.test(notOverdue.error?.message ?? ''), notOverdue.error?.message);
  const earlyDispute = await bea.c.rpc('open_dispute', { p_booking_id: seededConfirmed, p_category: 'other', p_description: 'smoke test, should be refused', p_requested_amount: 0 });
  check('disputes can’t be opened before pickup', /^conflict\./.test(earlyDispute.error?.message ?? ''), earlyDispute.error?.message);
  const { data: theCase, error: caseErr } = await bea.c.rpc('get_dispute', { p_dispute_id: seededDispute });
  check('a party reads their dispute case', !caseErr && theCase?.my_role === 'borrower', caseErr?.message ?? theCase?.status);
  const strangerCase = await dana.c.rpc('get_dispute', { p_dispute_id: seededDispute });
  check('dispute cases are private to the parties and staff', strangerCase.error?.message === 'not_found.dispute');
  const strangerReply = await paolo.c.rpc('respond_to_dispute', { p_dispute_id: seededDispute, p_body: 'smoke' });
  check('non-parties cannot reply to a case', strangerReply.error?.message === 'not_found.dispute');
  const partyDecides = await bea.c.rpc('resolve_dispute', { p_dispute_id: seededDispute, p_deposit_to_lender: 0, p_rent_refund: 0, p_booking_outcome: 'completed', p_decision: 'Deciding my own case.' });
  check('only moderators can decide a dispute', partyDecides.error?.message === 'forbidden.staff_only');
  const { data: queue, error: queueErr } = await admin.c.rpc('list_disputes', { p_open_only: false });
  check('the moderator queue includes the seeded case', !queueErr && queue.some((d) => d.id === seededDispute), queueErr?.message);
  const { data: earnings, error: earnErr } = await leo.c.rpc('my_lender_earnings');
  check('lender earnings are computed server-side, net of refunds', !earnErr && Number.isFinite(Number(earnings)), earnErr?.message ?? `₱${Number(earnings) / 100}`);
  const anonCase = await client().rpc('get_dispute', { p_dispute_id: seededDispute });
  check('anonymous callers cannot read cases', Boolean(anonCase.error));
}

// 15. Phase 11: reviews, account health and moderation guards (reads and refused calls only)
{
  const rico = await signedIn('rico.restricted@tigrent.test');
  const seededConfirmed = 'bbbbbbbb-0000-4000-8000-000000000001';
  const early = await bea.c.rpc('submit_review', { p_booking_id: seededConfirmed, p_rating: 5 });
  check('only completed rentals can be reviewed', /^conflict\.not_completed$|^not_found\./.test(early.error?.message ?? ''), early.error?.message);
  const { data: ownReview } = await bea.c.from('reviews').select('id').eq('reviewer_id', bea.id).limit(1);
  if (ownReview?.[0]) {
    const selfReport = await bea.c.rpc('report_review', { p_review_id: ownReview[0].id, p_reason: 'smoke test' });
    check('members cannot report their own review', selfReport.error?.message === 'forbidden.own_review');
  }
  const { data: health, error: healthErr } = await rico.c.rpc('get_my_account_health');
  check('a restricted member sees the reason, the sample rule and history', !healthErr && health?.account_status !== 'active' && health?.metrics?.rule_is_sample === true && health?.history?.length >= 1,
    healthErr?.message ?? `${health?.account_status}, ${health?.metrics?.review_count} ratings`);
  if (health?.account_status !== 'active') {
    const blocked = await rico.c.rpc('request_booking', { p_listing_id: '11111111-0000-4000-8000-000000000004', p_pickup: '2099-01-01', p_return: '2099-01-02', p_terms_version_id: '00000000-0000-4000-8000-000000000000' });
    check('a restricted member cannot request new rentals', /^forbidden\./.test(blocked.error?.message ?? ''), blocked.error?.message);
    const { data: found } = await bea.c.rpc('search_listings', {});
    check('a restricted lender’s listings are hidden from search', !found?.some((r) => r.lender_id === rico.id));
    const { data: ricoRentals, error: rentalsErr } = await rico.c.from('bookings').select('id');
    check('a restricted member still sees their rentals', !rentalsErr && (ricoRentals ?? []).length > 0);
  }
  const notStaff = await bea.c.rpc('moderate_account', { p_user_id: rico.id, p_decision: 'lift', p_note: 'Lifting from a student account.' });
  check('only moderators change account status', notStaff.error?.message === 'forbidden.staff_only');
  const hideAsStudent = await leo.c.rpc('moderate_review', { p_review_id: ownReview?.[0]?.id ?? '00000000-0000-4000-8000-000000000000', p_action: 'hide', p_note: 'not allowed' });
  check('only moderators moderate reviews', hideAsStudent.error?.message === 'forbidden.staff_only');
  const { data: queue, error: queueErr } = await admin.c.rpc('list_account_reviews');
  check('the account-health queue lists the restricted member', !queueErr && queue.some((r) => r.user_id === rico.id), queueErr?.message);
  const queueAsStudent = await leo.c.rpc('list_account_reviews');
  check('students cannot open the account-health queue', queueAsStudent.error?.message === 'forbidden.staff_only');
  const { data: leoReviews, error: lrErr } = await bea.c.rpc('list_reviews', { p_user_id: leo.id, p_direction: 'borrower_to_lender' });
  check('public reviews list for a lender loads', !lrErr && Array.isArray(leoReviews), lrErr?.message ?? `${leoReviews?.length} reviews`);
  const anonReviews = await client().rpc('list_reviews', { p_user_id: leo.id });
  check('anonymous callers cannot read reviews', Boolean(anonReviews.error));
  await rico.c.auth.signOut();
}

for (const s of [bea, leo, dana, paolo, admin]) await s.c.auth.signOut();
console.log(failures === 0 ? '\nAll live checks passed.' : `\n${failures} live check(s) FAILED.`);
process.exitCode = failures === 0 ? 0 : 1;
