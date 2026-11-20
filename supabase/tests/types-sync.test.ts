import fs from 'node:fs';
import path from 'node:path';
import { generateDatabaseTypes } from '../../scripts/lib/gen-types.cjs';
import { createTestDb, type TestDb } from './harness';

/** Plan Phase 2: "keep database-generated types in sync". */
let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.close();
});

it('src/types/database.ts matches the migrations (run `npm run db:types` if this fails)', async () => {
  const expected = await generateDatabaseTypes((sql) => db.sql(sql));
  const actual = fs.readFileSync(path.resolve(__dirname, '../../src/types/database.ts'), 'utf8');
  expect(actual).toBe(expected);
});
