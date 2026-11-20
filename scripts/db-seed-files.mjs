// Uploads the SAMPLE files referenced by seeded rows, each through the Storage API as its owner
// (so the real storage policies are exercised). Idempotent: existing objects are left as they are.
//   • verification-docs/{user}/registration-form-SAMPLE.pdf  (generated "SAMPLE - NOT A REAL DOCUMENT")
//   • listing-images/{listing}/sample-cover.png               (assets/listings/<listing>.png, "SAMPLE PHOTO")
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadEnv, requireEnv, ROOT } from './lib/env.mjs';
import { connect } from './lib/connection.mjs';
import { samplePdf } from './lib/sample-pdf.mjs';

const env = loadEnv();
requireEnv(env, ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY']);
const PASSWORD = 'TigRentDemo#2026';

const { client: db } = await connect();
const { rows: docs } = await db.query(`
  select v.document_path as path, v.full_name, v.student_id, u.email, a.label as academic_year
    from public.student_verifications v
    join auth.users u on u.id = v.user_id
    join public.academic_years a on a.id = v.academic_year_id
   where u.email like '%@tigrent.test' and v.document_path like '%registration-form-SAMPLE.pdf'
     and not exists (select 1 from storage.objects o where o.bucket_id = 'verification-docs' and o.name = v.document_path)`);
const { rows: photos } = await db.query(`
  select i.path, i.listing_id::text as listing_id, u.email
    from public.listing_images i
    join public.listings l on l.id = i.listing_id
    join auth.users u on u.id = l.lender_id
   where u.email like '%@tigrent.test' and i.path like '%/sample-cover.png'
     and not exists (select 1 from storage.objects o where o.bucket_id = 'listing-images' and o.name = i.path)`);
await db.end();

const sessions = new Map();
async function clientFor(email) {
  if (sessions.has(email)) return sessions.get(email);
  const c = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`${email}: sign-in failed (${error.message})`);
  sessions.set(email, c);
  return c;
}

let ok = 0;
let failed = 0;
async function upload(email, bucket, objectPath, body, contentType) {
  try {
    const c = await clientFor(email);
    const { error } = await c.storage.from(bucket).upload(objectPath, body, { contentType, upsert: false });
    if (error && !/exists/i.test(error.message)) throw new Error(error.message);
    ok++;
  } catch (e) {
    console.error(`  ${bucket}/${objectPath}: ${e.message}`);
    failed++;
    process.exitCode = 1;
  }
}

for (const r of docs) {
  const pdf = samplePdf([
    'SAMPLE - NOT A REAL DOCUMENT',
    'TigRent prototype demo registration form',
    '',
    `Fictitious student: ${r.full_name}`,
    `Demo student ID: ${r.student_id}`,
    `Academic year: ${r.academic_year}`,
    '',
    'This file exists only to demonstrate the manual review workflow.',
    'It is not issued by the University of Santo Tomas.',
  ]);
  await upload(r.email, 'verification-docs', r.path, pdf, 'application/pdf');
}
for (const r of photos) {
  const file = path.join(ROOT, 'assets', 'listings', `${r.listing_id}.png`);
  if (!fs.existsSync(file)) {
    console.error(`  missing placeholder ${file} (run scripts/gen-listing-placeholders.ps1)`);
    failed++;
    continue;
  }
  await upload(r.email, 'listing-images', r.path, fs.readFileSync(file), 'image/png');
}
for (const c of sessions.values()) await c.auth.signOut();
console.log(`Sample files: ${ok} uploaded, ${failed} failed (${docs.length} documents, ${photos.length} listing photos were missing).`);
