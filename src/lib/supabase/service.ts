import "server-only";

import { createClient } from "@supabase/supabase-js";

import { serverEnv } from "@/lib/env";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

/**
 * This client is server-only and bypasses RLS. Every call through it must first
 * resolve a tenant and authorize the user in the application's data access layer.
 */
export function createSupabaseServiceClient() {
  const publicConfig = getSupabasePublicConfig();
  if (!publicConfig || !serverEnv.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Supabase server credentials are not configured. Development mode uses mocks.",
    );
  }

  return createClient(publicConfig.url, serverEnv.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Background workers require both a project URL/key pair and a server-only
 * service-role key. Keep this check separate from client construction so job
 * routes can return an accurate 503 instead of failing after authentication.
 */
export function isSupabaseServiceConfigured(): boolean {
  return Boolean(getSupabasePublicConfig() && serverEnv.SUPABASE_SERVICE_ROLE_KEY);
}
