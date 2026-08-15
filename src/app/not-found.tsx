import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-muted/40 p-6">
      <section className="max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
        <p className="text-sm font-medium text-muted-foreground">404</p>
        <h1 className="mt-2 text-xl font-semibold">This page is not available</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Return to your assistant workspace to continue.
        </p>
        <Button asChild className="mt-6">
          <Link href="/dashboard">Open dashboard</Link>
        </Button>
      </section>
    </main>
  );
}
