import "server-only";

import { timingSafeEqual } from "node:crypto";

import { serverEnv } from "@/lib/env";
import { isSupabaseServiceConfigured } from "@/lib/supabase/service";

export function isCronRunnerConfigured(): boolean {
  return Boolean(serverEnv.CRON_SECRET);
}

/** A live worker needs request authentication and privileged queue access. */
export function isCronWorkerConfigured(): boolean {
  return isCronRunnerConfigured() && isSupabaseServiceConfigured();
}

export function hasValidCronAuthorization(request: Request): boolean {
  if (!serverEnv.CRON_SECRET) {
    return false;
  }

  const received = request.headers.get("authorization") ?? "";
  const expected = "Bearer " + serverEnv.CRON_SECRET;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}
