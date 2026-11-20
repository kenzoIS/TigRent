/**
 * Validates the app's public configuration at startup (plan Phase 2: "fail clearly when required
 * configuration is missing"). Only EXPO_PUBLIC_* values exist in the bundle; secrets never do.
 */
import { z } from 'zod';

const looksLikeServerSecret = (key: string): boolean => {
  if (key.startsWith('sb_secret_')) return true;
  // Legacy JWT keys: reject a service_role token if one is ever pasted in by mistake.
  const parts = key.split('.');
  if (parts.length === 3 && parts[1]) {
    try {
      const json = JSON.parse(globalThis.atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      return json?.role === 'service_role';
    } catch {
      return false;
    }
  }
  return false;
};

const schema = z.object({
  supabaseUrl: z
    .string({ error: 'EXPO_PUBLIC_SUPABASE_URL is missing.' })
    .url('EXPO_PUBLIC_SUPABASE_URL must be a URL.')
    .refine((u) => u.startsWith('https://'), 'EXPO_PUBLIC_SUPABASE_URL must use https.'),
  supabasePublishableKey: z
    .string({ error: 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing.' })
    .min(20, 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY looks incomplete.')
    .refine((k) => !looksLikeServerSecret(k), 'A secret/service-role key must never be shipped in the app. Use the publishable key.'),
});

export type AppEnv = z.infer<typeof schema>;
export type EnvResult = { ok: true; env: AppEnv } | { ok: false; issues: string[] };

type RawEnv = { supabaseUrl?: string; supabasePublishableKey?: string };

/** Expo inlines EXPO_PUBLIC_* only for static `process.env.X` references, so read them explicitly. */
export function readRawEnv(): RawEnv {
  return {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || undefined,
    supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || undefined,
  };
}

export function validateEnv(raw: RawEnv = readRawEnv()): EnvResult {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, env: parsed.data };
  return { ok: false, issues: parsed.error.issues.map((i) => i.message) };
}
