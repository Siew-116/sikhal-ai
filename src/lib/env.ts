/**
 * env.ts — environment validation.
 *
 * The rule from the master prompt: never hard-code credentials, and the app
 * must connect to Supabase through environment variables without major
 * changes. This module is the single place that reads them.
 *
 * It does NOT throw at import time. Instead it reports precisely what is
 * missing, so the app can run in demo mode (in-memory persistence) without
 * credentials and upgrade to Supabase by configuration alone.
 */

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

export interface EnvStatus {
  supabaseConfigured: boolean;
  missing: string[];
  llmConfigured: boolean;
  appUrl: string;
}

function read(key: string): string | undefined {
  const value = process.env[key];
  return value && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * Resolve Supabase configuration.
 *
 * Returns null when any required variable is absent — callers then fall back to
 * the in-memory adapter rather than crashing. This is what allows the whole
 * application to run and be tested with no credentials.
 */
export function getSupabaseConfig(): SupabaseConfig | null {
  const url = read('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = read('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  const serviceRoleKey = read('SUPABASE_SECRET_KEY');

  if (!url || !anonKey || !serviceRoleKey) return null;
  return { url, anonKey, serviceRoleKey };
}

export function getLlmConfig(): { apiKey: string; model: string } | null {
  const apiKey = read('LLM_API_KEY');
  if (!apiKey) return null;
  return { apiKey, model: read('LLM_MODEL') ?? 'default' };
}

export function getAppUrl(): string {
  return read('NEXT_PUBLIC_APP_URL') ?? 'http://localhost:3000';
}

/** Diagnostics for the UI and for the execution report. */
export function getEnvStatus(): EnvStatus {
  const missing: string[] = [];
  if (!read('NEXT_PUBLIC_SUPABASE_URL')) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!read('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')) missing.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  if (!read('SUPABASE_SECRET_KEY')) missing.push('SUPABASE_SECRET_KEY');

  return {
    supabaseConfigured: missing.length === 0,
    missing,
    llmConfigured: read('LLM_API_KEY') !== undefined,
    appUrl: getAppUrl(),
  };
}
