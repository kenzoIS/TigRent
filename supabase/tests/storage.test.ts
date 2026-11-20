import { createTestDb, DEMO, type TestDb } from './harness';

/** Phase 2 gate: private storage denies public access and permits only approved paths (plan §6.5). */
let db: TestDb;
beforeAll(async () => {
  db = await createTestDb({ seed: true });
  // Objects that exist "on disk" for read tests (inserted as superuser, like an earlier upload).
  await db.exec(`
    insert into storage.objects (bucket_id, name) values
      ('verification-docs', '${DEMO.bea}/registration-form-SAMPLE.pdf'),
      ('listing-images', '11111111-0000-4000-8000-000000000001/front.jpg'),
      ('evidence', 'bbbbbbbb-0000-4000-8000-000000000006/${DEMO.leo}/hinge.jpg');`);
});
afterAll(async () => {
  await db.close();
});

const insertObject = (actor: string, bucket: string, name: string) =>
  db.errorAs(actor, `insert into storage.objects (bucket_id, name) values ($1, $2) returning id`, [bucket, name]);
const visible = async (actor: string, bucket: string, name: string) =>
  (await db.as(actor, `select id from storage.objects where bucket_id = $1 and name = $2`, [bucket, name])).length === 1;

describe('buckets', () => {
  it('every bucket is private with size and type limits', async () => {
    const rows = await db.sql<{ id: string; public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(
      `select id, public, file_size_limit::text, allowed_mime_types from storage.buckets order by id`);
    expect(rows.map((r) => r.id)).toEqual(['avatars', 'evidence', 'listing-images', 'verification-docs']);
    for (const b of rows) {
      expect(b.public).toBe(false);
      expect(Number(b.file_size_limit)).toBeGreaterThan(0);
      expect(b.allowed_mime_types.length).toBeGreaterThan(0);
    }
  });
  it('anonymous users can read nothing', async () => {
    expect(await db.as('anon', `select * from storage.objects`)).toEqual([]);
  });
});

describe('verification documents', () => {
  const doc = `${DEMO.bea}/registration-form-SAMPLE.pdf`;
  it('owner and staff can read; another student cannot', async () => {
    expect(await visible(DEMO.bea, 'verification-docs', doc)).toBe(true);
    expect(await visible(DEMO.admin, 'verification-docs', doc)).toBe(true);
    expect(await visible(DEMO.dana, 'verification-docs', doc)).toBe(false);
  });
  it('uploads are only allowed into the uploader’s own folder', async () => {
    expect(await insertObject(DEMO.paolo, 'verification-docs', `${DEMO.paolo}/form.pdf`)).toBeNull();
    expect(await insertObject(DEMO.paolo, 'verification-docs', `${DEMO.bea}/form.pdf`)).toMatch(/row-level security/);
  });
  it('a submitted document cannot be deleted (review history is preserved)', async () => {
    await db.as(DEMO.bea, `delete from storage.objects where bucket_id = 'verification-docs' and name = $1`, [doc]);
    expect((await db.sql(`select id from storage.objects where name = $1`, [doc])).length).toBe(1);
  });
});

describe('listing images', () => {
  const img = '11111111-0000-4000-8000-000000000001/front.jpg';
  it('are visible to verified students but not to students pending verification', async () => {
    expect(await visible(DEMO.bea, 'listing-images', img)).toBe(true);
    expect(await visible(DEMO.paolo, 'listing-images', img)).toBe(false);
  });
  it('only the listing’s lender can upload', async () => {
    expect(await insertObject(DEMO.leo, 'listing-images', '11111111-0000-4000-8000-000000000001/side.jpg')).toBeNull();
    expect(await insertObject(DEMO.bea, 'listing-images', '11111111-0000-4000-8000-000000000001/fake.jpg')).toMatch(/row-level security/);
  });
});

describe('dispute evidence', () => {
  const ev = `bbbbbbbb-0000-4000-8000-000000000006/${DEMO.leo}/hinge.jpg`;
  it('is readable by the two booking parties and staff only', async () => {
    expect(await visible(DEMO.leo, 'evidence', ev)).toBe(true);
    expect(await visible(DEMO.bea, 'evidence', ev)).toBe(true);
    expect(await visible(DEMO.admin, 'evidence', ev)).toBe(true);
    expect(await visible(DEMO.dana, 'evidence', ev)).toBe(false);
  });
  it('parties upload only into their own sub-folder of their own booking', async () => {
    expect(await insertObject(DEMO.bea, 'evidence', `bbbbbbbb-0000-4000-8000-000000000006/${DEMO.bea}/reply.jpg`)).toBeNull();
    expect(await insertObject(DEMO.bea, 'evidence', `bbbbbbbb-0000-4000-8000-000000000006/${DEMO.leo}/forged.jpg`)).toMatch(/row-level security/);
    expect(await insertObject(DEMO.dana, 'evidence', `bbbbbbbb-0000-4000-8000-000000000006/${DEMO.dana}/x.jpg`)).toMatch(/row-level security/);
  });
});
