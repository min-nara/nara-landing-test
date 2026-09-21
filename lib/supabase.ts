"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let cached: SupabaseClient | null = null;

/** Supabase 환경변수가 없으면 null. 앱은 그 경우 로컬 저장으로 동작한다. */
export function supabase(): SupabaseClient | null {
  if (!url || !anon) return null;
  if (!cached) cached = createBrowserClient(url, anon);
  return cached;
}

export const supabaseConfigured = Boolean(url && anon);
