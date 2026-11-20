// Checks database connectivity and reports server facts. Prints no secrets.
import { connect } from './lib/connection.mjs';

const { client, host, user } = await connect({ verbose: true });
const { rows } = await client.query(`
  select current_setting('server_version') as server_version,
         (select count(*) from pg_extension where extname = 'btree_gist') as btree_gist_installed,
         (select count(*) from pg_available_extensions where name = 'btree_gist') as btree_gist_available,
         (select count(*) from pg_namespace where nspname = 'storage') as has_storage_schema,
         (select count(*) from information_schema.tables where table_schema = 'public') as public_tables`);
console.log({ host, user, ...rows[0] });
await client.end();
