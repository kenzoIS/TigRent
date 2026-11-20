import { createTestDb, DEMO, type TestDb } from './harness';

/** Phase 4 gate: verification lifecycle works end-to-end and can't be bypassed (plan §2.2). */
let db: TestDb;
const AY_CURRENT = 'eeeeeeee-0000-4000-8000-000000000002';
const AY_OLD = 'eeeeeeee-0000-4000-8000-000000000001';

beforeAll(async () => {
  db = await createTestDb({ seed: true });
  // Simulated uploads (the storage server records size + mimetype in metadata).
  const put = (user: string, name: string, size: number, mime: string) =>
    db.sql(`insert into storage.objects (bucket_id, name, metadata) values ('verification-docs', $1, $2)`, [
      `${user}/${name}`, JSON.stringify({ size, mimetype: mime }),
    ]);
  await put(DEMO.rina, 'form-2026.pdf', 48000, 'application/pdf');
  await put(DEMO.rina, 'huge.pdf', 50_000_000, 'application/pdf');
  await put(DEMO.rina, 'script.html', 100, 'text/html');
  await put(DEMO.rina, 'empty.pdf', 0, 'application/pdf');
});
afterAll(async () => {
  await db.close();
});

const submit = (who: string, o: Partial<{ name: string; email: string; sid: string; ay: string; roles: string[]; doc: string }> = {}) =>
  db.errorAs(who, `select public.submit_verification($1, $2, $3, $4, $5::public.marketplace_role[], $6)`, [
    o.name ?? 'Rina Tan', o.email ?? 'rina.tan@ust.edu.ph', o.sid ?? '2026-12345', o.ay ?? AY_CURRENT, `{${(o.roles ?? ['lender']).join(',')}}`,
    o.doc ?? `${DEMO.rina}/form-2026.pdf`,
  ]);

describe('submit_verification validation (field-level server errors)', () => {
  it.each([
    ['invalid email', { email: 'not-an-email' }, /validation.student_email/],
    ['non-university domain', { email: 'rina@gmail.com' }, /validation.student_email_domain/],
    ['bad student ID', { sid: 'x' }, /validation.student_id/],
    ['non-current academic year', { ay: AY_OLD }, /validation.academic_year(_not_current)?/],
    ['no roles', { roles: [] }, /validation.roles/],
    ['missing document', { doc: `${DEMO.rina}/never-uploaded.pdf` }, /validation.document_missing/],
    ['someone else’s folder', { doc: `${DEMO.bea}/registration-form-SAMPLE.pdf` }, /validation.document\b/],
    ['oversized file', { doc: `${DEMO.rina}/huge.pdf` }, /validation.document_size/],
    ['empty file', { doc: `${DEMO.rina}/empty.pdf` }, /validation.document_size/],
    ['disallowed type', { doc: `${DEMO.rina}/script.html` }, /validation.document_type/],
  ])('%s', async (_label, input, expected) => {
    expect(await submit(DEMO.rina, input)).toMatch(expected);
  });

  it('requires accepted terms, and refuses duplicate pending or already-verified submissions', async () => {
    expect(await submit(DEMO.admin)).toMatch(/forbidden.terms_required/);
    expect(await submit(DEMO.paolo)).toMatch(/conflict.already_pending/);
    expect(await submit(DEMO.bea)).toMatch(/conflict.already_verified/);
  });

  it('cannot be called anonymously', async () => {
    expect(await submit('anon')).toMatch(/permission denied/);
  });
});

describe('lifecycle (persisted)', () => {
  it('a rejected student resubmits a new document → pending_review, history kept, staff notified', async () => {
    await db.exec(`set role postgres`);
    await db.pg.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: DEMO.rina, role: 'authenticated' })]);
      await tx.exec('set local role authenticated');
      await tx.query(`select public.submit_verification('Rina Tan', 'Rina.Tan@UST.edu.ph', '2026-12345', $1, array['lender']::public.marketplace_role[], $2)`,
        [AY_CURRENT, `${DEMO.rina}/form-2026.pdf`]);
    });
    const rows = await db.sql<{ status: string; student_email: string; document_size_bytes: number }>(
      `select status::text, student_email, document_size_bytes from student_verifications where user_id = $1 order by submitted_at desc`, [DEMO.rina]);
    expect(rows.map((r) => r.status)).toEqual(['pending_review', 'rejected']); // previous rejection preserved
    expect(rows[0]).toMatchObject({ student_email: 'rina.tan@ust.edu.ph', document_size_bytes: 48000 }); // server metadata, normalized email
    const staffNotes = await db.sql(`select user_id from notifications where type = 'verification.queued'`);
    expect(staffNotes.length).toBe(1); // the one staff account
    expect(await submit(DEMO.rina)).toMatch(/conflict.already_pending/);
    // The same file can never back a second submission.
    const dup = await db.sql(`insert into student_verifications (user_id, academic_year_id, full_name, student_email, student_id, document_path)
      select user_id, academic_year_id, full_name, student_email, student_id, document_path from student_verifications
       where document_path = $1 limit 1`, [`${DEMO.rina}/form-2026.pdf`]).then(() => null, (e: Error) => e.message);
    expect(dup).toMatch(/student_verifications_(document_once|one_pending)/);
  });

  it('ordinary users (even with a pending submission) cannot review', async () => {
    const { id } = (await db.sql<{ id: string }>(`select id from student_verifications where user_id = $1 and status = 'pending_review'`, [DEMO.rina]))[0]!;
    expect(await db.errorAs(DEMO.bea, `select public.review_verification($1, 'approve')`, [id])).toMatch(/forbidden.staff_only/);
    expect(await db.errorAs(DEMO.rina, `select public.review_verification($1, 'approve')`, [id])).toMatch(/forbidden.staff_only/);
  });

  it('reject / request resubmission require a reason', async () => {
    const { id } = (await db.sql<{ id: string }>(`select id from student_verifications where user_id = $1 and status = 'pending_review'`, [DEMO.paolo]))[0]!;
    expect(await db.errorAs(DEMO.admin, `select public.review_verification($1, 'reject', 'no')`, [id])).toMatch(/validation.reason_required/);
    expect(await db.errorAs(DEMO.admin, `select public.review_verification($1, 'maybe')`, [id])).toMatch(/validation.decision/);
  });

  it('admin approval verifies the student, grants requested roles, notifies, audits, and is single-use', async () => {
    const { id } = (await db.sql<{ id: string }>(`select id from student_verifications where user_id = $1 and status = 'pending_review'`, [DEMO.rina]))[0]!;
    await db.pg.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: DEMO.admin, role: 'authenticated' })]);
      await tx.exec('set local role authenticated');
      await tx.query(`select public.review_verification($1, 'approve')`, [id]);
    });
    const [v] = await db.sql<{ status: string; reviewed_by: string; expires: string }>(
      `select status::text, reviewed_by, to_char(expires_at at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI') as expires from student_verifications where id = $1`, [id]);
    expect(v).toEqual({ status: 'verified', reviewed_by: DEMO.admin, expires: '2027-07-31 23:59' });
    expect((await db.sql(`select role from user_roles where user_id = $1`, [DEMO.rina])).length).toBe(1);
    expect((await db.sql(`select 1 from notifications where user_id = $1 and type = 'verification.approved'`, [DEMO.rina])).length).toBe(1);
    expect((await db.sql(`select 1 from audit_logs where action = 'verification.verified' and entity_id = $1`, [id])).length).toBe(1);
    expect(await db.errorAs(DEMO.admin, `select public.review_verification($1, 'reject', 'Changed my mind about this one')`, [id]))
      .toMatch(/conflict.already_reviewed/);
  });

  it('request-resubmission routes the student back with a reason', async () => {
    const { id } = (await db.sql<{ id: string }>(`select id from student_verifications where user_id = $1 and status = 'pending_review'`, [DEMO.paolo]))[0]!;
    const rows = await db.as<{ r: { status: string } }>(DEMO.admin,
      `select public.review_verification($1, 'request_resubmission', 'The photo is blurry; please upload a clearer scan.') as r`, [id]);
    expect(rows[0]!.r.status).toBe('needs_resubmission');
  });
});

describe('pending students are blocked from marketplace actions (plan Phase 4)', () => {
  it('cannot create listings, bookings or messages through table access', async () => {
    for (const q of [
      `insert into listings (lender_id, title, category, condition, daily_rate) values ('${DEMO.paolo}', 'Test', 'other', 'good', 1000)`,
      `insert into bookings (listing_id) values ('11111111-0000-4000-8000-000000000001')`,
      `insert into messages (conversation_id, sender_id, body) values ('88888888-0000-4000-8000-000000000001', '${DEMO.paolo}', 'hi')`,
    ]) {
      expect(await db.errorAs(DEMO.paolo, q)).toMatch(/permission denied/);
    }
  });
});

describe('academic-year change (expiry policy)', () => {
  it('only admins can configure years', async () => {
    expect(await db.errorAs(DEMO.bea, `select public.create_academic_year('AY 2027–2028', '2027-08-01', '2028-07-31')`)).toMatch(/forbidden.admin_only/);
    expect(await db.errorAs(DEMO.admin, `select public.create_academic_year('AY bad', '2028-01-01', '2027-01-01')`)).toMatch(/validation.dates/);
  });

  it('switching the current year expires older verifications and notifies those students', async () => {
    let newYear = '';
    await db.pg.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: DEMO.admin, role: 'authenticated' })]);
      await tx.exec('set local role authenticated');
      newYear = (await tx.query<{ id: string }>(`select public.create_academic_year('AY 2027–2028', '2027-08-01', '2028-07-31') as id`)).rows[0]!.id;
      const res = await tx.query<{ r: { expired_verifications: number } }>(`select public.set_current_academic_year($1) as r`, [newYear]);
      expect(res.rows[0]!.r.expired_verifications).toBe(6); // bea, leo, dana, rico, mika, rina
    });
    const status = async (id: string) => (await db.sql<{ s: string }>(`select app_private.verification_status($1)::text as s`, [id]))[0]!.s;
    expect(await status(DEMO.bea)).toBe('expired');
    expect((await db.sql(`select 1 from notifications where user_id = $1 and type = 'verification.expired'`, [DEMO.bea])).length).toBe(1);
    expect(Number((await db.sql<{ n: string }>(`select count(*) n from academic_years where is_current`))[0]!.n)).toBe(1);
    // An expired student can renew (submission allowed again) but only for the new current year.
    await db.sql(`insert into storage.objects (bucket_id, name, metadata) values ('verification-docs', $1, $2)`,
      [`${DEMO.bea}/renewal.pdf`, JSON.stringify({ size: 1000, mimetype: 'application/pdf' })]);
    expect(await db.errorAs(DEMO.bea, `select public.submit_verification('Bea Santos', 'bea@ust.edu.ph', '2026-00002', $1, array['borrower']::public.marketplace_role[], $2)`,
      [AY_CURRENT, `${DEMO.bea}/renewal.pdf`])).toMatch(/academic_year/);
    expect(await db.errorAs(DEMO.bea, `select public.submit_verification('Bea Santos', 'bea@ust.edu.ph', '2026-00002', $1, array['borrower']::public.marketplace_role[], $2)`,
      [newYear, `${DEMO.bea}/renewal.pdf`])).toBeNull();
  });
});
