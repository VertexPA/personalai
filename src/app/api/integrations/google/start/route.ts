import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { getActiveTenantWorkspace } from "@/data/tenant";
import { serverEnv } from "@/lib/env";
import {
  buildGoogleCalendarAuthorizationUrl,
  isGoogleOAuthConfigured,
} from "@/lib/integrations/google-oauth";
import { canPerformAction } from "@/lib/permissions";
import { checkInMemoryRateLimit } from "@/lib/rate-limit";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function getApplicationUrl(request: NextRequest): string {
  if (serverEnv.APP_URL) {
    return serverEnv.APP_URL;
  }

  if (serverEnv.NODE_ENV === "production") {
    throw new Error("APP_URL is required in production.");
  }

  return new URL(request.url).origin;
}

export async function GET(request: NextRequest) {
  if (
    !isSupabaseConfigured() ||
    !isGoogleOAuthConfigured() ||
    !serverEnv.INTEGRATION_ENCRYPTION_KEY
  ) {
    return Response.json(
      {
        error:
          "Google Calendar connection requires Supabase, Google OAuth, and integration encryption configuration.",
      },
      { status: 503 },
    );
  }

  const workspace = await getActiveTenantWorkspace();
  if (!workspace) {
    return Response.json(
      { error: "Create or select a workspace before connecting Google." },
      { status: 409 },
    );
  }

  if (!canPerformAction(workspace.role, "integration.manage")) {
    return Response.json(
      { error: "You do not have permission to connect integrations." },
      { status: 403 },
    );
  }

  const rateLimit = checkInMemoryRateLimit({
    identifier: "google-oauth:" + workspace.userId,
    limit: 10,
    windowMilliseconds: 60_000,
  });
  if (!rateLimit.allowed) {
    return Response.json(
      { error: "Please wait before starting another Google connection." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return Response.json({ error: "Database connection is unavailable." }, { status: 503 });
  }

  const state = randomBytes(32).toString("base64url");
  const stateHash = createHash("sha256").update(state).digest("hex");
  const { error } = await supabase.rpc("create_oauth_state", {
    p_state_hash: stateHash,
    p_organization_id: workspace.organizationId,
    p_provider: "google_calendar",
    p_redirect_to: "/integrations",
    p_expires_at: new Date(Date.now() + 10 * 60 * 1_000).toISOString(),
  });

  if (error) {
    return Response.json(
      { error: "Could not start the secure Google connection." },
      { status: 500 },
    );
  }

  try {
    const redirectUri = new URL(
      "/api/integrations/google/callback",
      getApplicationUrl(request),
    ).toString();
    return NextResponse.redirect(
      buildGoogleCalendarAuthorizationUrl({ state, redirectUri }),
    );
  } catch {
    return Response.json(
      { error: "The Google connection callback URL is not configured." },
      { status: 503 },
    );
  }
}
