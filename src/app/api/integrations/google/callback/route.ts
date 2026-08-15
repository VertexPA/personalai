import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { serverEnv } from "@/lib/env";
import {
  exchangeGoogleAuthorizationCode,
  getGoogleIdentity,
  isGoogleOAuthConfigured,
} from "@/lib/integrations/google-oauth";
import { encryptIntegrationSecret } from "@/lib/security/secret-encryption";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

interface OAuthStateRow {
  organization_id: string;
  redirect_to: string | null;
}

function getApplicationUrl(request: NextRequest): string {
  if (serverEnv.APP_URL) {
    return serverEnv.APP_URL;
  }

  if (serverEnv.NODE_ENV === "production") {
    throw new Error("APP_URL is required in production.");
  }

  return new URL(request.url).origin;
}

function toBytea(value: Uint8Array): string {
  return "\\x" + Buffer.from(value).toString("hex");
}

function getSafeDestination(
  request: NextRequest,
  candidate: string | null,
  status: "connected" | "error",
): URL {
  const path =
    candidate && candidate.startsWith("/") && !candidate.startsWith("//")
      ? candidate
      : "/integrations";
  const destination = new URL(path, getApplicationUrl(request));
  destination.searchParams.set("google", status);
  return destination;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");

  if (
    !code ||
    !state ||
    !isSupabaseConfigured() ||
    !isGoogleOAuthConfigured() ||
    !serverEnv.INTEGRATION_ENCRYPTION_KEY
  ) {
    return NextResponse.redirect(getSafeDestination(request, null, "error"));
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.redirect(getSafeDestination(request, null, "error"));
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/sign-in", getApplicationUrl(request)));
  }

  const stateHash = createHash("sha256").update(state).digest("hex");
  const { data: stateData, error: stateError } = await supabase.rpc(
    "consume_oauth_state",
    {
      p_state_hash: stateHash,
      p_provider: "google_calendar",
    },
  );
  const oauthState = (stateData as unknown as OAuthStateRow[] | null)?.[0];

  if (stateError || !oauthState) {
    return NextResponse.redirect(getSafeDestination(request, null, "error"));
  }

  try {
    const redirectUri = new URL(
      "/api/integrations/google/callback",
      getApplicationUrl(request),
    ).toString();
    const tokens = await exchangeGoogleAuthorizationCode({ code, redirectUri });
    if (!tokens.refreshToken) {
      return NextResponse.redirect(
        getSafeDestination(request, oauthState.redirect_to, "error"),
      );
    }

    const identity = await getGoogleIdentity(tokens.accessToken);
    const encrypted = encryptIntegrationSecret(
      JSON.stringify({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt?.toISOString() ?? null,
        scopes: tokens.scopes,
      }),
    );
    const { error } = await supabase.rpc("complete_google_calendar_oauth", {
      p_organization_id: oauthState.organization_id,
      p_external_account_id: identity.subject,
      p_display_name: identity.email ?? identity.name ?? "Google account",
      p_scopes: tokens.scopes,
      p_token_expires_at: tokens.expiresAt?.toISOString() ?? null,
      p_ciphertext: toBytea(encrypted.ciphertext),
      p_initialization_vector: toBytea(encrypted.initializationVector),
      p_authentication_tag: toBytea(encrypted.authenticationTag),
    });

    if (error) {
      return NextResponse.redirect(
        getSafeDestination(request, oauthState.redirect_to, "error"),
      );
    }

    return NextResponse.redirect(
      getSafeDestination(request, oauthState.redirect_to, "connected"),
    );
  } catch {
    return NextResponse.redirect(
      getSafeDestination(request, oauthState.redirect_to, "error"),
    );
  }
}
