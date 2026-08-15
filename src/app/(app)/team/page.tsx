import { Mail, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { TeamInviteDialog } from "@/components/team/team-invite-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getTeamMembers } from "@/data/team";

function getInitials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

function labelRole(role: string): string {
  return role.replaceAll("_", " ");
}

export default async function TeamPage() {
  const team = await getTeamMembers();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={team.isDemoMode ? "Development team preview" : "Tenant team"}
        title="Team"
        description="Roles are scoped per organization. Customer owners and admins manage memberships; platform administrators remain separate."
        actions={
          <TeamInviteDialog
            canAssignAdmin={team.canAssignAdmin}
            canManage={team.canManage}
            hasTeamFeature={team.hasTeamFeature}
            isDemoMode={team.isDemoMode}
          />
        }
      />

      <Card className="border-border/80 shadow-none">
        <CardContent className="divide-y p-0">
          {!team.hasWorkspace ? (
            <div className="p-5 text-sm text-muted-foreground">
              Complete onboarding to create a tenant team.
            </div>
          ) : null}
          {team.hasWorkspace && team.members.length === 0 ? (
            <div className="p-5 text-sm text-muted-foreground">
              No active members are available to this session.
            </div>
          ) : null}
          {team.members.map((member) => (
            <div className="flex items-center gap-3 px-5 py-4" key={member.id}>
              <Avatar className="size-9">
                <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                  {getInitials(member.name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{member.name}</p>
                {member.email ? (
                  <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Mail className="size-3" />
                    {member.email}
                  </p>
                ) : null}
              </div>
              <Badge
                variant={
                  member.role === "customer_owner" ? "secondary" : "outline"
                }
              >
                {labelRole(member.role)}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-none">
        <CardContent className="flex gap-3 p-5">
          <ShieldCheck className="size-5 text-emerald-600" />
          <p className="text-sm leading-6 text-muted-foreground">
            Role changes are server-authorized and audited. No client UI control
            alone grants a permission.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
