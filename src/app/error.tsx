"use client";

import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function ErrorBoundary({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-muted/40 p-6">
      <section className="max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
        <AlertTriangle className="mx-auto mb-4 size-8 text-amber-600" />
        <h1 className="text-xl font-semibold">We hit an unexpected problem</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          No data or external action was completed. You can safely try again.
        </p>
        <Button className="mt-6" onClick={reset}>
          Try again
        </Button>
      </section>
    </main>
  );
}
