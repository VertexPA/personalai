"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getActiveTenantWorkspace } from "@/data/tenant";
import { canPerformAction } from "@/lib/permissions";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const memoryKindSchema = z.enum([
  "preference",
  "contact",
  "location",
  "instruction",
  "context",
]);

const memorySchema = z.object({
  memoryId: z.string().uuid().nullable().optional(),
  kind: memoryKindSchema,
  key: z.string().trim().min(1).max(100),
  statement: z.string().trim().min(1).max(2_000),
});

const deleteMemorySchema = z.object({
  memoryId: z.string().uuid(),
});

export type MemoryInput = z.infer<typeof memorySchema>;

export type MemoryActionResult =
  | { status: "saved" | "deleted" | "demo"; message: string }
  | { status: "error"; message: string };

function messageForDatabaseError(error: { code?: string }): string {
  if (error.code === "42501") {
    return "You can only change memory you own in this workspace.";
  }

  if (error.code === "22023") {
    return "The memory details are invalid.";
  }

  if (error.code === "23505") {
    return "A memory with that category and label already exists. Edit it instead.";
  }

  if (error.code === "P0002") {
    return "That memory is no longer available. Refresh to see the latest list.";
  }

  return "We could not update memory. Please try again.";
}

async function getAuthorizedMemoryWorkspace() {
  if (!isSupabaseConfigured()) {
    return {
      workspace: null,
      message:
        "Development preview: memory changes are not persisted until Supabase is configured.",
      isDemo: true,
    };
  }

  const workspace = await getActiveTenantWorkspace();
  if (!workspace || !canPerformAction(workspace.role, "memory.read")) {
    return {
      workspace: null,
      message: "You cannot manage memory in this workspace.",
      isDemo: false,
    };
  }

  return { workspace, message: null, isDemo: false };
}

export async function saveMemory(input: unknown): Promise<MemoryActionResult> {
  const parsed = memorySchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Memory details are invalid.",
    };
  }

  const authorization = await getAuthorizedMemoryWorkspace();
  if (!authorization.workspace) {
    return {
      status: authorization.isDemo ? "demo" : "error",
      message: authorization.message ?? "You cannot manage memory in this workspace.",
    };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      status: "error",
      message: "The secure database connection is unavailable.",
    };
  }

  const { error } = await supabase.rpc("upsert_assistant_memory", {
    p_organization_id: authorization.workspace.organizationId,
    p_memory_id: parsed.data.memoryId ?? null,
    p_kind: parsed.data.kind,
    p_key: parsed.data.key,
    p_statement: parsed.data.statement,
  });
  if (error) {
    return { status: "error", message: messageForDatabaseError(error) };
  }

  revalidatePath("/memory");
  return {
    status: "saved",
    message: "Memory was saved with your confirmation and recorded in the audit trail.",
  };
}

export async function deleteMemory(
  input: unknown,
): Promise<MemoryActionResult> {
  const parsed = deleteMemorySchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: "The memory reference is invalid." };
  }

  const authorization = await getAuthorizedMemoryWorkspace();
  if (!authorization.workspace) {
    return {
      status: authorization.isDemo ? "demo" : "error",
      message: authorization.message ?? "You cannot manage memory in this workspace.",
    };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      status: "error",
      message: "The secure database connection is unavailable.",
    };
  }

  const { error } = await supabase.rpc("delete_assistant_memory", {
    p_organization_id: authorization.workspace.organizationId,
    p_memory_id: parsed.data.memoryId,
  });
  if (error) {
    return { status: "error", message: messageForDatabaseError(error) };
  }

  revalidatePath("/memory");
  return {
    status: "deleted",
    message: "Memory was deleted and the audit trail was updated.",
  };
}
