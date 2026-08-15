import "server-only";

import { getActiveTenantWorkspace } from "@/data/tenant";
import { canPerformAction } from "@/lib/permissions";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const memoryKinds = [
  "preference",
  "contact",
  "location",
  "instruction",
  "context",
] as const;

export type MemoryKind = (typeof memoryKinds)[number];

export interface MemoryView {
  id: string;
  kind: MemoryKind;
  key: string;
  category: string;
  statement: string;
  source: string;
  canModify: boolean;
}

interface MemoryRow {
  id: string;
  kind: string;
  key: string;
  value: unknown;
  source: string;
  owner_user_id: string | null;
}

const demoMemories: MemoryView[] = [
  {
    id: "demo-scheduling",
    kind: "preference",
    key: "scheduling",
    category: "Scheduling preference",
    statement: "Don’t schedule meetings before 10 AM.",
    source: "Confirmed by John",
    canModify: true,
  },
  {
    id: "demo-buffer",
    kind: "preference",
    key: "meeting buffer",
    category: "Meeting buffer",
    statement: "Keep at least 30 minutes between external meetings.",
    source: "Confirmed by John",
    canModify: true,
  },
  {
    id: "demo-vip",
    kind: "contact",
    key: "Jason",
    category: "VIP contact",
    statement: "Jason is a high-priority contact.",
    source: "Confirmed by John",
    canModify: true,
  },
  {
    id: "demo-focus",
    kind: "preference",
    key: "Friday focus time",
    category: "Focus time",
    statement: "Keep Friday afternoon mostly free.",
    source: "Confirmed by John",
    canModify: true,
  },
];

function isMemoryKind(value: string): value is MemoryKind {
  return memoryKinds.includes(value as MemoryKind);
}

function describeValue(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of ["statement", "text", "value", "description"]) {
      if (typeof record[key] === "string") {
        return record[key];
      }
    }
  }

  return fallback.replaceAll("_", " ");
}

export async function getMemories(): Promise<{
  isDemoMode: boolean;
  hasWorkspace: boolean;
  canCreate: boolean;
  memories: MemoryView[];
}> {
  if (!isSupabaseConfigured()) {
    return {
      isDemoMode: true,
      hasWorkspace: true,
      canCreate: true,
      memories: demoMemories,
    };
  }

  const workspace = await getActiveTenantWorkspace();
  if (!workspace) {
    return { isDemoMode: false, hasWorkspace: false, canCreate: false, memories: [] };
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { isDemoMode: false, hasWorkspace: true, canCreate: false, memories: [] };
  }

  const { data, error } = await supabase
    .from("assistant_memories")
    .select("id, kind, key, value, source, owner_user_id")
    .eq("organization_id", workspace.organizationId)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (error || !data) {
    return { isDemoMode: false, hasWorkspace: true, canCreate: false, memories: [] };
  }

  const isWorkspaceAdmin = canPerformAction(
    workspace.role,
    "organization.manage",
  );

  return {
    isDemoMode: false,
    hasWorkspace: true,
    canCreate: canPerformAction(workspace.role, "memory.read"),
    memories: (data as unknown as MemoryRow[]).flatMap((memory) =>
      isMemoryKind(memory.kind)
        ? [
            {
              id: memory.id,
              kind: memory.kind,
              key: memory.key,
              category: memory.kind.replaceAll("_", " "),
              statement: describeValue(memory.value, memory.key),
              source: memory.source.replaceAll("_", " "),
              canModify:
                isWorkspaceAdmin || memory.owner_user_id === workspace.userId,
            },
          ]
        : [],
    ),
  };
}
