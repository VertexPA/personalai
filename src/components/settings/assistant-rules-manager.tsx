"use client";

import { Check, LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  confirmAssistantRule,
  deleteAssistantRule,
  saveAssistantRule,
  type AssistantRuleInput,
} from "@/app/(app)/settings/rule-actions";
import type { AssistantRuleView } from "@/data/assistant-rules";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const ruleKinds = ["scheduling", "travel", "communication", "custom"] as const;

const emptyDraft: AssistantRuleInput = {
  ruleId: null,
  kind: "custom",
  naturalLanguage: "",
  requiresConfirmation: true,
  isActive: true,
};

function draftFromRule(rule: AssistantRuleView): AssistantRuleInput {
  return {
    ruleId: rule.id,
    kind: rule.kind,
    naturalLanguage: rule.naturalLanguage,
    requiresConfirmation: rule.requiresConfirmation,
    isActive: rule.isActive,
  };
}

export function AssistantRulesManager({
  rules,
  hasWorkspace,
  canManage,
}: {
  rules: AssistantRuleView[];
  hasWorkspace: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<AssistantRuleInput>(emptyDraft);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [ruleToDelete, setRuleToDelete] = useState<AssistantRuleView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await saveAssistantRule(draft);
      setNotice(result.message);
      if (result.status === "saved") {
        setDialogOpen(false);
        router.refresh();
      }
    });
  }

  function confirm(rule: AssistantRuleView) {
    startTransition(async () => {
      const result = await confirmAssistantRule({ ruleId: rule.id });
      setNotice(result.message);
      if (result.status === "confirmed") {
        router.refresh();
      }
    });
  }

  function remove() {
    if (!ruleToDelete) {
      return;
    }
    startTransition(async () => {
      const result = await deleteAssistantRule({ ruleId: ruleToDelete.id });
      setNotice(result.message);
      setRuleToDelete(null);
      if (result.status === "deleted") {
        router.refresh();
      }
    });
  }

  return (
    <>
      <Card className="border-border/80 shadow-none">
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Assistant rules</CardTitle>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Rules are tenant-scoped. A confirmation-required rule remains out of
              Ava’s active context until an owner or admin confirms it.
            </p>
          </div>
          <Button
            disabled={!canManage || isPending}
            onClick={() => {
              setDraft(emptyDraft);
              setDialogOpen(true);
            }}
            size="sm"
            type="button"
          >
            <Plus data-icon="inline-start" />
            Add rule
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {!hasWorkspace ? (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Complete onboarding to add assistant rules.
            </div>
          ) : null}
          {hasWorkspace && rules.length === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No assistant rules have been configured for this workspace.
            </div>
          ) : null}
          {rules.map((rule) => {
            const needsConfirmation = rule.requiresConfirmation && !rule.confirmedAt;
            return (
              <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center" key={rule.id}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{rule.kind.replaceAll("_", " ")}</Badge>
                    {!rule.isActive ? <Badge variant="secondary">Paused</Badge> : null}
                    {needsConfirmation ? (
                      <Badge variant="outline">Needs confirmation</Badge>
                    ) : (
                      <Badge variant="secondary">Confirmed</Badge>
                    )}
                  </div>
                  <p className="mt-2 text-sm font-medium leading-6">{rule.naturalLanguage}</p>
                </div>
                {canManage ? (
                  <div className="flex shrink-0 flex-wrap gap-1">
                    {needsConfirmation ? (
                      <Button
                        disabled={isPending}
                        onClick={() => confirm(rule)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <Check data-icon="inline-start" />
                        Confirm
                      </Button>
                    ) : null}
                    <Button
                      disabled={isPending}
                      onClick={() => {
                        setDraft(draftFromRule(rule));
                        setDialogOpen(true);
                      }}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <Pencil />
                      <span className="sr-only">Edit rule</span>
                    </Button>
                    <Button
                      disabled={isPending}
                      onClick={() => setRuleToDelete(rule)}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 />
                      <span className="sr-only">Delete rule</span>
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
          <p aria-live="polite" className="text-xs leading-5 text-muted-foreground">
            {notice}
          </p>
        </CardContent>
      </Card>

      <Dialog
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setDraft(emptyDraft);
          }
        }}
        open={dialogOpen}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft.ruleId ? "Edit assistant rule" : "Add assistant rule"}</DialogTitle>
            <DialogDescription>
              State the behaviour plainly so the customer can review and confirm it.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="rule-kind">Category</Label>
              <select
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                id="rule-kind"
                onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value }))}
                value={ruleKinds.includes(draft.kind as (typeof ruleKinds)[number]) ? draft.kind : "custom"}
              >
                {ruleKinds.map((kind) => (
                  <option key={kind} value={kind}>{kind}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rule-text">Rule</Label>
              <Textarea
                id="rule-text"
                maxLength={2_000}
                onChange={(event) => setDraft((current) => ({ ...current, naturalLanguage: event.target.value }))}
                placeholder="e.g. Do not schedule meetings before 10 AM."
                value={draft.naturalLanguage}
              />
            </div>
            <label className="flex items-start gap-3 rounded-lg border p-3 text-sm leading-6">
              <input
                checked={draft.requiresConfirmation}
                className="mt-1 size-4 accent-primary"
                onChange={(event) => setDraft((current) => ({ ...current, requiresConfirmation: event.target.checked }))}
                type="checkbox"
              />
              <span>
                <span className="font-medium">Require an explicit confirmation</span>
                <span className="block text-muted-foreground">Ava will not apply this rule until it is confirmed.</span>
              </span>
            </label>
            <label className="flex items-center gap-3 text-sm">
              <input
                checked={draft.isActive}
                className="size-4 accent-primary"
                onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))}
                type="checkbox"
              />
              Keep this rule active
            </label>
          </div>
          <DialogFooter>
            <Button disabled={isPending} onClick={() => setDialogOpen(false)} type="button" variant="outline">Cancel</Button>
            <Button disabled={isPending} onClick={save} type="button">
              {isPending ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : null}
              Save rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog onOpenChange={(open) => !open && setRuleToDelete(null)} open={ruleToDelete !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this assistant rule?</AlertDialogTitle>
            <AlertDialogDescription>
              Ava will no longer consider “{ruleToDelete?.naturalLanguage}” in this workspace.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Keep rule</AlertDialogCancel>
            <AlertDialogAction disabled={isPending} onClick={remove} variant="destructive">
              {isPending ? "Deleting…" : "Delete rule"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
