import type { LucideIcon } from "lucide-react";
import {
  Bell,
  Bot,
  CalendarDays,
  ChartNoAxesCombined,
  CreditCard,
  Gauge,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Settings2,
  ShieldCheck,
  UsersRound,
  Workflow,
} from "lucide-react";
import Link from "next/link";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import {
  getActiveTenantWorkspace,
  getTenantWorkspaceOptions,
  isCurrentUserPlatformAdmin,
} from "@/data/tenant";
import { isSupabaseConfigured } from "@/lib/supabase/config";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

const navigation: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/assistant", label: "Assistant", icon: Bot },
  { href: "/approvals", label: "Approvals", icon: ListChecks },
  { href: "/automations", label: "Automations", icon: Workflow },
  { href: "/integrations", label: "Integrations", icon: KeyRound },
  { href: "/memory", label: "Memory & preferences", icon: Bell },
  { href: "/team", label: "Team", icon: UsersRound },
  { href: "/usage", label: "Usage", icon: ChartNoAxesCombined },
  { href: "/billing", label: "Billing", icon: CreditCard },
  { href: "/settings", label: "Settings", icon: Settings2 },
  { href: "/admin", label: "Platform admin", icon: ShieldCheck, adminOnly: true },
];

function NavigationLink({ item }: { item: NavItem }) {
  const Icon = item.icon;

  return (
    <Link
      className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      href={item.href}
    >
      <Icon className="size-4" />
      <span>{item.label}</span>
      {item.adminOnly ? (
        <span className="ml-auto text-[10px] uppercase tracking-[0.12em] text-sidebar-foreground/45">
          Admin
        </span>
      ) : null}
    </Link>
  );
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "A";
}

export async function AppShell({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const isDemoMode = !isSupabaseConfigured();
  const [workspace, isPlatformAdmin, workspaceOptions] = await Promise.all([
    getActiveTenantWorkspace(),
    isCurrentUserPlatformAdmin(),
    getTenantWorkspaceOptions(),
  ]);
  const visibleNavigation = navigation.filter(
    (item) => !item.adminOnly || isDemoMode || isPlatformAdmin,
  );
  const workspaceName = isDemoMode
    ? "Tan Executive Office"
    : workspace?.organizationName ?? "Workspace setup";
  const workspacePlan = isDemoMode ? "Executive plan" : "Secure workspace";
  const userInitials = getInitials(
    isDemoMode ? "John Tan" : workspace?.userName ?? "Ava",
  );

  return (
    <div className="min-h-screen bg-muted/40">
      <aside className="fixed inset-y-0 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar px-3 py-5 lg:flex">
        <Link className="flex items-center gap-3 px-3" href="/dashboard">
          <span className="grid size-8 place-items-center rounded-lg bg-sidebar-primary font-mono text-sm font-semibold text-sidebar-primary-foreground">
            A
          </span>
          <span>
            <span className="block text-sm font-semibold tracking-tight text-sidebar-foreground">
              Ava
            </span>
            <span className="block text-xs text-sidebar-foreground/55">
              Executive Assistant
            </span>
          </span>
        </Link>

        <div className="mt-8 space-y-1">
          {visibleNavigation.map((item) => (
            <NavigationLink item={item} key={item.href} />
          ))}
        </div>

        <div className="mt-auto rounded-xl border border-sidebar-border bg-sidebar-accent/60 p-3">
          <div className="flex items-center gap-2">
            <Gauge className="size-4 text-sidebar-primary" />
            <span className="text-xs font-medium text-sidebar-foreground">
              {workspacePlan}
            </span>
          </div>
          <p className="mt-2 text-xs leading-5 text-sidebar-foreground/60">
            {isDemoMode
              ? "Mock integrations are clearly labelled in this development preview."
              : workspace
                ? "Tenant data and sensitive tools are checked before every action."
                : "Complete onboarding to create an isolated customer workspace."}
          </p>
        </div>
      </aside>

      <div className="min-h-screen lg:pl-64">
        <header className="sticky top-0 z-20 border-b bg-background/95 px-4 py-3 backdrop-blur lg:px-8">
          <div className="mx-auto flex max-w-7xl items-center gap-3">
            <Link className="flex items-center gap-2 lg:hidden" href="/dashboard">
              <span className="grid size-7 place-items-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
                A
              </span>
              <span className="text-sm font-semibold">Ava</span>
            </Link>
            <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
              {!isDemoMode && workspace && workspaceOptions.length > 1 ? (
                <WorkspaceSwitcher
                  activeOrganizationId={workspace.organizationId}
                  workspaces={workspaceOptions.map((option) => ({
                    organizationId: option.organizationId,
                    organizationName: option.organizationName,
                    workspaceSlug: option.workspaceSlug,
                    role: option.role,
                  }))}
                />
              ) : (
                <span className="truncate text-sm text-muted-foreground">
                  {workspaceName}
                </span>
              )}
            </nav>
            <div className="ml-auto flex items-center gap-3">
              {isDemoMode ? (
                <Badge className="hidden sm:inline-flex" variant="outline">
                  Development demo
                </Badge>
              ) : (
                <Badge className="hidden sm:inline-flex" variant="secondary">
                  Secure workspace
                </Badge>
              )}
              <Avatar className="size-8 border">
                <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                  {userInitials}
                </AvatarFallback>
              </Avatar>
            </div>
          </div>
          <div className="mt-3 flex gap-1 overflow-x-auto pb-1 lg:hidden">
            {visibleNavigation.slice(0, 6).map((item) => (
              <Link
                className="shrink-0 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                href={item.href}
                key={item.href}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-8 lg:py-8">
          {children}
        </main>
        <Separator />
        <footer className="px-4 py-5 text-xs text-muted-foreground lg:px-8">
          Ava uses controlled tools and approvals before sensitive external actions.
        </footer>
      </div>
    </div>
  );
}
