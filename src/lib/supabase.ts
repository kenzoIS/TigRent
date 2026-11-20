import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import type { Database } from '@/types/database';
import { validateEnv } from './env';
import { AppError } from './errors';

export type TigRentClient = SupabaseClient<Database>;

let client: TigRentClient | null = null;

/**
 * The one Supabase client. Uses ONLY the publishable key; every protected rule is enforced by
 * RLS and server-side functions (plan §6.5). Throws a config AppError if env is invalid.
 */
export function getSupabase(): TigRentClient {
  if (client) return client;
  const result = validateEnv();
  if (!result.ok) throw new AppError('config', result.issues.join(' '));
  client = createClient<Database>(result.env.supabaseUrl, result.env.supabasePublishableKey, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === 'web',
    },
  });
  return client;
}

/** Test seam: inject a fake client. */
export function __setSupabaseForTests(fake: TigRentClient | null) {
  client = fake;
}
