import "server-only";

import { serverEnv } from "@/lib/env";

const authorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
const tokenEndpoint = "https://oauth2.googleapis.com/token";
const userInfoEndpoint = "https://openidconnect.googleapis.com/v1/userinfo";

export const googleCalendarScopes = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];

interface GoogleOAuthConfiguration {
  clientId: string;
  clientSecret: string;
}

export interface GoogleOAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
}

export interface RefreshedGoogleAccessToken {
  accessToken: string;
  expiresAt: Date | null;
  scopes: string[];
}

export interface GoogleIdentity {
  subject: string;
  email: string | null;
  name: string | null;
}

function getConfiguration(): GoogleOAuthConfiguration {
  if (
    !serverEnv.GOOGLE_OAUTH_CLIENT_ID ||
    !serverEnv.GOOGLE_OAUTH_CLIENT_SECRET
  ) {
    throw new Error("Google OAuth is not configured.");
  }

  return {
    clientId: serverEnv.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: serverEnv.GOOGLE_OAUTH_CLIENT_SECRET,
  };
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(
    serverEnv.GOOGLE_OAUTH_CLIENT_ID && serverEnv.GOOGLE_OAUTH_CLIENT_SECRET,
  );
}

export function buildGoogleCalendarAuthorizationUrl({
  state,
  redirectUri,
}: {
  state: string;
  redirectUri: string;
}): string {
  const configuration = getConfiguration();
  const url = new URL(authorizationEndpoint);
  url.searchParams.set("client_id", configuration.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("scope", googleCalendarScopes.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeGoogleAuthorizationCode({
  code,
  redirectUri,
}: {
  code: string;
  redirectUri: string;
}): Promise<GoogleOAuthTokens> {
  const configuration = getConfiguration();
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: configuration.clientId,
      client_secret: configuration.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = readRecord(await response.json().catch(() => null));

  if (!response.ok) {
    throw new Error("Google token exchange failed.");
  }

  const accessToken = readString(payload.access_token);
  if (!accessToken) {
    throw new Error("Google token response did not include an access token.");
  }

  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : null;
  const scope = readString(payload.scope);

  return {
    accessToken,
    refreshToken: readString(payload.refresh_token),
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1_000) : null,
    scopes: scope ? scope.split(" ").filter(Boolean) : googleCalendarScopes,
  };
}

export async function refreshGoogleAccessToken(
  refreshToken: string,
): Promise<RefreshedGoogleAccessToken> {
  const configuration = getConfiguration();
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: configuration.clientId,
      client_secret: configuration.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = readRecord(await response.json().catch(() => null));

  if (!response.ok) {
    throw new Error("Google access-token refresh failed.");
  }

  const accessToken = readString(payload.access_token);
  if (!accessToken) {
    throw new Error("Google refresh response did not include an access token.");
  }

  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : null;
  const scope = readString(payload.scope);
  return {
    accessToken,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1_000) : null,
    scopes: scope ? scope.split(" ").filter(Boolean) : [],
  };
}

export async function getGoogleIdentity(
  accessToken: string,
): Promise<GoogleIdentity> {
  const response = await fetch(userInfoEndpoint, {
    headers: {
      Authorization: "Bearer " + accessToken,
    },
    signal: AbortSignal.timeout(10_000),
  });
  const payload = readRecord(await response.json().catch(() => null));

  if (!response.ok) {
    throw new Error("Google identity lookup failed.");
  }

  const subject = readString(payload.sub);
  if (!subject) {
    throw new Error("Google identity response did not include a subject.");
  }

  return {
    subject,
    email: readString(payload.email),
    name: readString(payload.name),
  };
}
