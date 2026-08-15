"use client";

import { LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { deleteMemory, saveMemory } from "@/app/(app)/memory/actions";
import type { MemoryKind, MemoryView } from "@/data/memory";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const memoryKinds: Array<{ value: MemoryKind; label: string }> = [
  { value: "preference", label: "Preference" },
  { value: "contact", label: "Contact" },
  { value: "location", label: "Location" },
  { value: "instruction", label: "Instruction" },
  { value: "context", label: "Context" },
];

interface MemoryDraft {
  memoryId: string | null;
  kind: MemoryKind;
  key: string;
  statement: string;
}

const emptyDraft: MemoryDraft = {
  memoryId: null,
  kind: "preference",
  key: "",
  statement: "",
};

function draftFromMemory(memory: MemoryView): MemoryDraft {
  return {
    memoryId: memory.id,
    kind: memory.kind,
    key: memory.key,
    statement: memory.statement,
  };
}

export function MemoryManager({
  memories,
  hasWorkspace,
  canCreate,
}: {
  memories: MemoryView[];
  hasWorkspace: boolean;
  canCreate: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<MemoryDraft>(emptyDraft);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [memoryToDelete, setMemoryToDelete] = useState<MemoryView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function beginCreate() {
    setDraft(emptyDraft);
    setDialogOpen(true);
  }

  function beginEdit(memory: MemoryView) {
    setDraft(draftFromMemory(memory));
    setDialogOpen(true);
  }

  function save() {
    startTransition(async () => {
      const result = await saveMemory(draft);
      setNotice(result.message);
      if (result.status === "saved") {
        setDialogOpen(false);
        router.refresh();
      }
    });
  }

  function remove() {
    if (!memoryToDelete) {
      return;
    }

    startTransition(async () => {
      const result = await deleteMemory({ memoryId: memoryToDelete.id });
      setNotice(result.message);
      setMemoryToDelete(null);
      if (result.status === "deleted") {
        router.refresh();
      }
    });
  }

  return (
    <>
      <Card className="border-border/80 shadow-none">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 gap-3">
          <div>
            <CardTitle className="text-base">Confirmed preferences</CardTitle>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Only confirmed entries are stored as durable assistant memory.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="secondary">{memories.length} active</Badge>
            <Button
              disabled={!canCreate || isPending}
              onClick={beginCreate}
              size="sm"
              type="button"
            >
              <Plus data-icon="inline-start" />
              Add memory
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {!hasWorkspace ? (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Complete onboarding to create tenant-scoped preferences.
            </div>
          ) : null}
          {hasWorkspace && memories.length === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No confirmed preferences have been stored for this workspace.
            </div>
          ) : null}
          {memories.map((entry) => (
            <div
              className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center"
              key={entry.id}
            >
              <div className="min-w-0 flex-1">
                <Badge variant="outline">{entry.category}</Badge>
                <p className="mt-2 text-sm font-medium">{entry.statement}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {entry.source}
                </p>
              </div>
              {entry.canModify ? (
                <div className="flex gap-1">
                  <Button
                    disabled={isPending}
                    onClick={() => beginEdit(entry)}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <Pencil />
                    <span className="sr-only">Edit preference</span>
                  </Button>
                  <Button
                    disabled={isPending}
                    onClick={() => setMemoryToDelete(entry)}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 />
                    <span className="sr-only">Delete preference</span>
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Shared memory — ask an owner or admin to change it.
                </p>
              )}
            </div>
          ))}
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {draft.memoryId ? "Edit confirmed memory" : "Add confirmed memory"}
            </DialogTitle>
            <DialogDescription>
              Store a clear, customer-controlled fact that Ava may use when planning.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="memory-kind">Category</Label>
              <select
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                id="memory-kind"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    kind: event.target.value as MemoryKind,
                  }))
                }
                value={draft.kind}
              >
                {memoryKinds.map((kind) => (
                  <option key={kind.value} value={kind.value}>
                    {kind.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="memory-key">Short label</Label>
              <Input
                id="memory-key"
                maxLength={100}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, key: event.target.value }))
                }
                placeholder="e.g. No meetings before 10 AM"
                value={draft.key}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="memory-statement">Confirmed statement</Label>
              <Textarea
                id="memory-statement"
                maxLength={2_000}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    statement: event.target.value,
                  }))
                }
                placeholder="Describe the preference or fact Ava should remember."
                value={draft.statement}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={isPending}
              onClick={() => setDialogOpen(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={isPending} onClick={save} type="button">
              {isPending ? (
                <LoaderCircle className="animate-spin" data-icon="inline-start" />
              ) : null}
              Save memory
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setMemoryToDelete(null);
          }
        }}
        open={memoryToDelete !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this memory?</AlertDialogTitle>
            <AlertDialogDescription>
              Ava will no longer use “{memoryToDelete?.statement}” after this is
              removed. This cannot be undone from the workspace.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Keep memory</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={remove}
              variant="destructive"
            >
              {isPending ? "Deleting…" : "Delete memory"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
