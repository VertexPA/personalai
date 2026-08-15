"use client";

import { ChevronsUpDown, LoaderCircle } from "lucide-react";
import { useState, useTransition } from "react";

import { switchActiveWorkspace } from "@/app/(app)/workspace-actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface WorkspaceSwitcherOption {
  organizationId: string;
  organizationName: string;
  workspaceSlug: string;
  role: string;
}

interface WorkspaceSwitcherProps {
  activeOrganizationId: string;
  workspaces: WorkspaceSwitcherOption[];
}

export function WorkspaceSwitcher({
  activeOrganizationId,
  workspaces,
}: WorkspaceSwitcherProps) {
  const [selectedOrganizationId, setSelectedOrganizationId] = useState(
    activeOrganizationId,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const activeWorkspace =
    workspaces.find(
      (workspace) => workspace.organizationId === selectedOrganizationId,
    ) ?? workspaces[0];

  if (!activeWorkspace) {
    return null;
  }

  function selectWorkspace(organizationId: string) {
    if (organizationId === selectedOrganizationId || isPending) {
      return;
    }

    startTransition(async () => {
      const result = await switchActiveWorkspace(organizationId);
      setNotice(result.message);
      if (result.status === "switched") {
        setSelectedOrganizationId(organizationId);
      }
    });
  }

  return (
    <div className="min-w-0">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="Switch workspace"
            className="max-w-56 justify-start font-normal"
            size="sm"
            type="button"
            variant="ghost"
          >
            <span className="truncate">{activeWorkspace.organizationName}</span>
            {isPending ? (
              <LoaderCircle className="ml-auto size-3.5 animate-spin" />
            ) : (
              <ChevronsUpDown className="ml-auto size-3.5 text-muted-foreground" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Switch workspace</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            onValueChange={selectWorkspace}
            value={selectedOrganizationId}
          >
            {workspaces.map((workspace) => (
              <DropdownMenuRadioItem
                disabled={isPending}
                key={workspace.organizationId}
                value={workspace.organizationId}
              >
                <span className="min-w-0">
                  <span className="block truncate">{workspace.organizationName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {workspace.role.replaceAll("_", " ")}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <p aria-live="polite" className="sr-only">
        {notice}
      </p>
    </div>
  );
}
