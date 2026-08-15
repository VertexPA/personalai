"use client";

import { useActionState } from "react";

import {
  createTelegramLinkToken,
  type TelegramLinkActionResult,
} from "@/app/(app)/integrations/telegram-actions";
import { Button } from "@/components/ui/button";

const initialState: TelegramLinkActionResult = {
  status: "idle",
  message: "",
};

export function TelegramLinkForm() {
  const [state, action, isPending] = useActionState(
    createTelegramLinkToken,
    initialState,
  );

  return (
    <form action={action} className="w-full space-y-2">
      <Button disabled={isPending} size="sm" type="submit" variant="outline">
        {isPending ? "Generating link code…" : "Link Telegram"}
      </Button>
      {state.message ? (
        <p aria-live="polite" className="text-xs leading-5 text-muted-foreground">
          {state.message}
        </p>
      ) : null}
      {state.status === "ready" ? (
        <div className="space-y-2 rounded-md border border-border/80 bg-muted/40 p-3 text-xs leading-5">
          <p className="font-medium text-foreground">
            Send this exact command in a private chat with the configured bot:
          </p>
          <code className="block break-all rounded bg-background px-2 py-1.5 text-foreground">
            /start {state.token}
          </code>
          <p>
            The code expires at {new Date(state.expiresAt).toLocaleTimeString()} and
            can only be used once.
          </p>
        </div>
      ) : null}
    </form>
  );
}
