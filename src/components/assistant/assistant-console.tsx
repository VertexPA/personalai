"use client";

import { useState } from "react";
import { LoaderCircle, Send, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

interface AssistantResponse {
  reply: string;
  provider: "mock" | "hermes" | "openai" | "anthropic" | "openrouter";
  toolIntents: Array<{ action: string; reason: string }>;
  notice: string;
}

export function AssistantConsole() {
  const [message, setMessage] = useState(
    "Can you review my schedule and tell me if I can get to the supplier meeting?",
  );
  const [response, setResponse] = useState<AssistantResponse | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (!message.trim()) {
      return;
    }

    setIsPending(true);
    setError(null);

    try {
      const result = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const payload: unknown = await result.json();

      if (!result.ok) {
        setError("The assistant could not process that request.");
        return;
      }

      setResponse(payload as AssistantResponse);
    } catch {
      setError("The assistant is temporarily unavailable. Please try again.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="border-border/80 shadow-none">
        <CardContent className="p-4">
          <Textarea
            aria-label="Message Ava"
            className="min-h-28 resize-none border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Ask about your schedule, a meeting, or travel."
            value={message}
          />
          <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5 text-emerald-600" />
              Read-only analysis runs without approval
            </span>
            <Button disabled={isPending} onClick={submit}>
              {isPending ? (
                <LoaderCircle className="animate-spin" data-icon="inline-start" />
              ) : (
                <Send data-icon="inline-start" />
              )}
              Send
            </Button>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Card className="border-destructive/30 shadow-none">
          <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      {response ? (
        <Card className="border-primary/20 bg-primary/[0.025] shadow-none">
          <CardContent className="p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{response.provider} provider</Badge>
              <Badge variant="outline">No external action executed</Badge>
            </div>
            <p className="mt-4 text-sm leading-6">{response.reply}</p>
            {response.toolIntents.length > 0 ? (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Proposed tool intents
                </p>
                {response.toolIntents.map((intent) => (
                  <div
                    className="rounded-lg border bg-background px-3 py-2 text-sm"
                    key={intent.action}
                  >
                    <span className="font-mono text-xs text-primary">
                      {intent.action}
                    </span>
                    <span className="ml-2 text-muted-foreground">{intent.reason}</span>
                  </div>
                ))}
              </div>
            ) : null}
            <p className="mt-4 text-xs leading-5 text-muted-foreground">
              {response.notice}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
