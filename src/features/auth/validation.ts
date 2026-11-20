/**
 * Client-side validation for auth forms. Improves UX only; Supabase Auth and the database remain
 * authoritative (plan §10.2). The server's own minimum is 6 characters; the app asks for more.
 */
import { z } from 'zod';

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Enter your email address.')
  .max(254, 'That email address is too long.')
  .email('Enter a valid email address.');

export const PASSWORD_RULES = 'At least 8 characters, with a letter and a number.';

export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .max(72, 'Use at most 72 characters.')
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Include at least one letter and one number.');

export const fullNameSchema = z
  .string()
  .trim()
  .min(2, 'Enter your full name.')
  .max(120, 'That name is too long.');

export const otpSchema = z
  .string()
  .trim()
  .regex(/^\d{6,10}$/, 'Enter the numeric code from the email.');

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.'),
});

export const signUpSchema = z
  .object({
    fullName: fullNameSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'Passwords don’t match.' });

export const newPasswordSchema = z
  .object({ password: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'Passwords don’t match.' });

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

/** First error message per field, for field-level feedback. */
export function fieldErrors<K extends string>(error: z.ZodError): FieldErrors<K> {
  const out: Partial<Record<string, string>> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    if (!out[key]) out[key] = issue.message;
  }
  return out as FieldErrors<K>;
}
