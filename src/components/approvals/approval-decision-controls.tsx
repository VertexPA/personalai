"use client";

import { Check, LoaderCircle, X } from "lucide-react";
import { useState, useTransition } from "react";

import { decideApprovalRequest } from "@/app/(app)/approvals/actions";
import { Button } from "@/components/ui/button";

interface ApprovalDecisionControlsProps {
  approvalRequestId: string;
}

export function ApprovalDecisionControls({
  approvalRequestId,
}: ApprovalDecisionControlsProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function decide(decision: "approve" | "reject") {
    startTransition(async () => {
      const result = await decideApprovalRequest({
        approvalRequestId,
        decision,
      });
      setMessage(result.message);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        disabled={isPending}
        onClick={() => decide("approve")}
        type="button"
      >
        {isPending ? (
          <LoaderCircle className="animate-spin" data-icon="inline-start" />
        ) : (
          <Check data-icon="inline-start" />
        )}
        Approve
      </Button>
      <Button
        disabled={isPending}
        onClick={() => decide("reject")}
        type="button"
        variant="outline"
      >
        <X data-icon="inline-start" />
        Reject
      </Button>
      <p
        aria-live="polite"
        className="basis-full text-xs leading-5 text-muted-foreground"
      >
        {message ??
          "Approval changes the controlled action state. A provider executor performs any external change separately."}
      </p>
    </div>
  );
}
