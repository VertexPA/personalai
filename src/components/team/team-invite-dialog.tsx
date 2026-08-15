"use client";

import { LoaderCircle, UserPlus } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { inviteTeamMember } from "@/app/(app)/team/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface TeamInviteDialogProps {
  canManage: boolean;
  canAssignAdmin: boolean;
  hasTeamFeature: boolean;
  isDemoMode: boolean;
}

export function TeamInviteDialog({
  canManage,
  canAssignAdmin,
  hasTeamFeature,
  isDemoMode,
}: TeamInviteDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("customer_member");
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const unavailableMessage = isDemoMode
    ? "Invitations are disabled in the development preview."
    : !canManage
      ? "Only a workspace owner or admin can invite members."
      : !hasTeamFeature
        ? "Team members are not enabled for this workspace plan."
        : null;

  function submit() {
    startTransition(async () => {
      const result = await inviteTeamMember({ email, fullName: fullName || undefined, role });
      setNotice(result.message);
      if (result.status === "invited" || result.status === "added") {
        setOpen(false);
        setEmail("");
        setFullName("");
        setRole("customer_member");
        router.refresh();
      }
    });
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button disabled={Boolean(unavailableMessage)} title={unavailableMessage ?? undefined}>
          <UserPlus data-icon="inline-start" />
          Invite member
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite a workspace member</DialogTitle>
          <DialogDescription>
            New users receive a secure Supabase invitation email. Existing accounts
            are added directly to this tenant without receiving credentials.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="team-invite-name">Name</Label>
            <Input
              id="team-invite-name"
              maxLength={120}
              onChange={(event) => setFullName(event.target.value)}
              value={fullName}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="team-invite-email">Email</Label>
            <Input
              id="team-invite-email"
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              value={email}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="team-invite-role">Role</Label>
            <select
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              id="team-invite-role"
              onChange={(event) => setRole(event.target.value)}
              value={role}
            >
              {canAssignAdmin ? <option value="customer_admin">Admin</option> : null}
              <option value="customer_member">Member</option>
              <option value="assistant_user">Assistant user</option>
            </select>
          </div>
          {notice ? <p aria-live="polite" className="text-sm text-muted-foreground">{notice}</p> : null}
        </div>
        <DialogFooter>
          <Button disabled={isPending} onClick={() => setOpen(false)} type="button" variant="outline">Cancel</Button>
          <Button disabled={isPending || !email} onClick={submit} type="button">
            {isPending ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <UserPlus data-icon="inline-start" />}
            Send invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
