// LIVE end-to-end Journey A (plan §3) against the hosted project, using only the publishable key
// for app actions. Creates a throwaway @example.com student, then removes everything it created.
//   register → accept terms → upload document → submit → admin reviews (signed URL) → approve → verified
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './lib/env.mjs';
import { connect } from './lib/connection.mjs';
import { samplePdf } from './lib/sample-pdf.mjs';

const env = loadEnv();
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const newClient = () => createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
let failures = 0;
const step = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
  return ok;
};

const email = `journey.a.${Date.now()}@example.com`;
const student = newClient();
let userId = null;
let docPath = null;
try {
  // A.2 Create account (Confirm email is OFF on this project → immediate session)
  const { data: su, error: suErr } = await student.auth.signUp({ email, password: 'JourneyA2026', options: { data: { full_name: 'Journey A Student' } } });
  if (!step('A.2 sign up creates a session', !suErr && Boolean(su.session), suErr?.message)) throw new Error('stop');
  userId = su.user.id;

  let { data: ctx } = await student.rpc('get_my_session_context');
  step('new account starts unverified with terms pending', ctx.verification_status === 'not_submitted' && ctx.pending_terms.length === 2 && ctx.roles.length === 0);
  const { data: market } = await student.from('listings').select('id');
  step('unverified student cannot browse the marketplace', market.length === 0);

  // A.4 Accept current Terms + Privacy versions
  ({ data: ctx } = await student.rpc('accept_current_terms', { p_version_ids: ctx.pending_terms.map((t) => t.id) }));
  step('A.4 terms accepted', ctx.pending_terms.length === 0);

  // A.3 Upload the registration form (private bucket, own folder)
  docPath = `${userId}/${Date.now()}-journeya.pdf`;
  const pdf = samplePdf(['SAMPLE - NOT A REAL DOCUMENT', 'Journey A automated test']);
  const { error: upErr } = await student.storage.from('verification-docs').upload(docPath, pdf, { contentType: 'application/pdf' });
  step('A.3 document uploaded privately', !upErr, upErr?.message);
  const pub = await fetch(`${URL_}/storage/v1/object/public/verification-docs/${docPath}`);
  step('document has no public URL', pub.status >= 400, `HTTP ${pub.status}`);

  const { data: years } = await student.from('academic_years').select('id, label, is_current').eq('is_current', true);
  const ay = years[0];

  // Validation is enforced server-side
  const bad = await student.rpc('submit_verification', { p_full_name: 'Journey A Student', p_student_email: 'someone@gmail.com', p_student_id: '2026-55555', p_academic_year_id: ay.id, p_requested_roles: ['borrower', 'lender'], p_document_path: docPath });
  step('non-university email domain is rejected by the server', bad.error?.message === 'validation.student_email_domain', bad.error?.hint);

  // A.5 Submit → pending review
  const sub = await student.rpc('submit_verification', { p_full_name: 'Journey A Student', p_student_email: 'journey.a@ust.edu.ph', p_student_id: '2026-55555', p_academic_year_id: ay.id, p_requested_roles: ['borrower', 'lender'], p_document_path: docPath });
  step('A.5 submission accepted → pending_review', !sub.error && sub.data?.status === 'pending_review', sub.error?.hint);
  ({ data: ctx } = await student.rpc('get_my_session_context'));
  step('session context reports pending_review', ctx.verification_status === 'pending_review');
  const dup = await student.rpc('submit_verification', { p_full_name: 'x y', p_student_email: 'journey.a@ust.edu.ph', p_student_id: '2026-55555', p_academic_year_id: ay.id, p_requested_roles: ['borrower'], p_document_path: docPath });
  step('a second pending submission is refused', dup.error?.message === 'conflict.already_pending');
  const selfReview = await student.rpc('review_verification', { p_verification_id: sub.data.id, p_decision: 'approve' });
  step('student cannot approve themselves', selfReview.error?.message === 'forbidden.staff_only');
  const { error: delErr, data: delData } = await student.storage.from('verification-docs').remove([docPath]);
  const stillThere = await student.storage.from('verification-docs').createSignedUrl(docPath, 30);
  step('a submitted document cannot be deleted by the student', !delErr && Boolean(stillThere.data?.signedUrl), `removed ${delData?.length ?? 0}`);

  // A.6 Admin reviews with a short-lived signed URL, then approves
  const admin = newClient();
  await admin.auth.signInWithPassword({ email: 'admin.demo@tigrent.test', password: 'TigRentDemo#2026' });
  const { data: queue } = await admin.from('student_verifications').select('id, full_name').eq('status', 'pending_review');
  step('A.6 submission appears in the admin queue', queue.some((q) => q.id === sub.data.id));
  const signed = await admin.storage.from('verification-docs').createSignedUrl(docPath, 300);
  const docRes = signed.data ? await fetch(signed.data.signedUrl) : null;
  const bytes = docRes ? new Uint8Array(await docRes.arrayBuffer()) : new Uint8Array();
  step('reviewer opens the document through a signed URL', docRes?.status === 200 && String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-');
  const rev = await admin.rpc('review_verification', { p_verification_id: sub.data.id, p_decision: 'approve' });
  step('admin approves', !rev.error && rev.data?.status === 'verified', rev.error?.hint);
  const again = await admin.rpc('review_verification', { p_verification_id: sub.data.id, p_decision: 'reject', p_reason: 'Trying to decide twice on purpose' });
  step('a decision cannot be made twice', again.error?.message === 'conflict.already_reviewed');
  await admin.auth.signOut();

  // A.7/A.8 Student sees the outcome and lands with roles
  ({ data: ctx } = await student.rpc('get_my_session_context'));
  step('A.8 student is verified with both requested roles', ctx.verification_status === 'verified' && JSON.stringify(ctx.roles) === '["borrower","lender"]');
  const { data: notes } = await student.from('notifications').select('type').order('created_at');
  step('A.7 student received submitted + approved notifications', notes.map((n) => n.type).join(',') === 'verification.submitted,verification.approved');
  const { data: marketNow } = await student.from('listings').select('id');
  step('verified student can now browse listings', marketNow.length > 0, `${marketNow.length} listings`);
} catch (e) {
  if (e.message !== 'stop') step('unexpected error', false, e.message);
} finally {
  // Cleanup: verification row first (so the owner may delete the file), then the file, then the user.
  if (userId) {
    const { client: db } = await connect();
    await db.query('delete from public.student_verifications where user_id = $1', [userId]);
    // Staff notifications that pointed at the removed submission.
    await db.query(`delete from public.notifications where entity_type = 'verification' and entity_id not in (select id from public.student_verifications)`);
    await db.end();
    if (docPath) await student.storage.from('verification-docs').remove([docPath]);
    await student.auth.signOut();
    const { client: db2 } = await connect();
    // Audit rows stay (append-only); deleting the account clears their actor (migration 011).
    const del = await db2.query('delete from auth.users where id = $1', [userId]);
    await db2.end();
    console.log(`cleanup: removed test student (${del.rowCount}) and their document`);
  }
}
console.log(failures === 0 ? '\nJourney A passed end-to-end.' : `\n${failures} Journey A step(s) FAILED.`);
process.exitCode = failures === 0 ? 0 : 1;
