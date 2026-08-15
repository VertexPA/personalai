import { Check, Clock3, ShieldCheck, X } from "lucide-react";

import { ApprovalDecisionControls } from "@/components/approvals/approval-decision-controls";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getApprovalRequests } from "@/data/approvals";
import { getActiveTenantWorkspace } from "@/data/tenant";
import { canPerformAction } from "@/lib/permissions";

function labelAction(action: string): string {
  return action.replaceAll(".", " ").replaceAll("_", " ");
}

function formatExpiry(value: string | null): string {
  if (!value) {
    return "No expiry";
  }

  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function ApprovalsPage() {
  const [approvals, workspace] = await Promise.all([
    getApprovalRequests(),
    getActiveTenantWorkspace(),
  ]);
  const canDecideApprovals = Boolean(
    !approvals.isDemoMode &&
      workspace &&
      canPerformAction(workspace.role, "approval_policy.manage"),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          approvals.isDemoMode
            ? "Development approval preview"
            : "Approval required before external change"
        }
        title="Approval requests"
        description="Sensitive actions are persisted with an idempotency key. A decision updates the request and controlled-action queue atomically before any provider executor can run."
      />

      {!approvals.hasWorkspace ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="p-6 text-sm leading-6 text-muted-foreground">
            Complete onboarding to configure approval policies for a workspace.
          </CardContent>
        </Card>
      ) : null}

      {approvals.hasWorkspace && approvals.requests.length === 0 ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="p-6 text-sm leading-6 text-muted-foreground">
            No approval requests are awaiting this signed-in user.
          </CardContent>
        </Card>
      ) : null}

      {approvals.requests.map((request) => (
        <Card
          className={
            request.status === "pending"
              ? "border-amber-200 shadow-none"
              : "border-border/80 shadow-none"
          }
          key={request.id}
        >
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">
                  {labelAction(request.action)}
                </CardTitle>
                <Badge variant={request.status === "pending" ? "outline" : "secondary"}>
                  {request.status}
                </Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Controlled action · {request.action}
              </p>
            </div>
            <ShieldCheck className="size-5 text-amber-600" />
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm leading-6">{request.summary}</p>
            {request.proposedMessage ? (
              <div className="rounded-lg border border-primary/15 bg-primary/[0.025] p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
                  Proposed {request.deliveryChannel} reply
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                  {request.proposedMessage}
                </p>
              </div>
            ) : null}
            <div className="rounded-lg bg-muted/60 p-3 font-mono text-xs text-muted-foreground">
              idempotency: {request.idempotencyKey}
            </div>
          </CardContent>
          <CardFooter className="gap-2">
            {approvals.isDemoMode ? (
              <>
                <Button disabled>
                  <Check data-icon="inline-start" />
                  Demo approval
                </Button>
                <Button disabled variant="outline">
                  <X data-icon="inline-start" />
                  Reject
                </Button>
              </>
            ) : request.status === "pending" && canDecideApprovals ? (
              <ApprovalDecisionControls approvalRequestId={request.id} />
            ) : request.status === "pending" ? (
              <span className="text-xs leading-5 text-muted-foreground">
                A workspace owner or admin must decide this request.
              </span>
            ) : (
              <span className="text-xs leading-5 text-muted-foreground">
                This request is no longer awaiting a decision.
              </span>
            )}
            <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Clock3 className="size-3.5" />
              {formatExpiry(request.expiresAt)}
            </span>
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
