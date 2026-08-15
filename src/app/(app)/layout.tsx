import { AppShell } from "@/components/app-shell";

// Tenant context and Supabase sessions are resolved per request. Rendering this
// route group dynamically avoids a build-time demo snapshot being served after
// production environment variables are configured.
export const dynamic = "force-dynamic";

export default function ApplicationLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <AppShell>{children}</AppShell>;
}
