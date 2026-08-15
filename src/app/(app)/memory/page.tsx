import { LockKeyhole } from "lucide-react";

import { MemoryManager } from "@/components/memory/memory-manager";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getMemories } from "@/data/memory";

export default async function MemoryPage() {
  const memory = await getMemories();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          memory.isDemoMode
            ? "Development memory preview"
            : "Customer-owned assistant memory"
        }
        title="Memory & preferences"
        description="Durable preferences are stored as structured, tenant-isolated records. Customers can review, edit, or delete important memories."
      />

      <MemoryManager
        canCreate={memory.canCreate}
        hasWorkspace={memory.hasWorkspace}
        memories={memory.memories}
      />

      <Card className="border-border/80 shadow-none">
        <CardContent className="flex gap-3 p-5">
          <LockKeyhole className="mt-0.5 size-5 text-primary" />
          <p className="text-sm leading-6 text-muted-foreground">
            Natural-language rules are shown to the user and require confirmation
            before they materially change assistant behaviour.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
