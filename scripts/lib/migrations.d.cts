import type { PGlite } from '@electric-sql/pglite';

export declare const SUPABASE_DIR: string;
export declare function listMigrations(): { version: string; name: string; file: string; sql: string }[];
export declare function readSupabaseFile(rel: string): string;
export declare function createPgliteDb(opts?: { seed?: boolean }): Promise<PGlite>;
