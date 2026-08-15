import { ArrowRight, CalendarDays, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Link className="flex items-center gap-2" href="/">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
            A
          </span>
          <span className="font-semibold">Ava</span>
        </Link>
        <div className="flex gap-2">
          <Button asChild size="sm" variant="ghost">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/sign-up">Get started</Link>
          </Button>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl gap-12 px-5 pb-20 pt-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.8fr)] lg:items-center lg:pt-28">
        <div>
          <Badge variant="outline">Multi-tenant AI executive assistant</Badge>
          <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
            A calmer way to run a demanding schedule.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
            Ava brings calendar intelligence, approval-aware execution, travel
            planning, communications, and structured preferences into one secure
            workspace for every customer.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/dashboard">
                Explore development demo
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/onboarding">View onboarding</Link>
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            The demo is clearly labelled and does not connect to external accounts.
          </p>
        </div>

        <Card className="border-border/80 bg-card shadow-lg shadow-primary/5">
          <CardContent className="space-y-5 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Today
                </p>
                <p className="mt-1 text-lg font-semibold">4 meetings · 1 decision</p>
              </div>
              <span className="grid size-10 place-items-center rounded-xl bg-primary/8 text-primary">
                <Sparkles className="size-5" />
              </span>
            </div>
            <div className="rounded-xl border bg-muted/30 p-4">
              <div className="flex items-center gap-2">
                <CalendarDays className="size-4 text-primary" />
                <p className="text-sm font-medium">Supplier Meeting</p>
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Your lunch ends at 1:15 PM. Current travel time is 38 minutes.
                Ava recommends moving this meeting to 2:30 PM.
              </p>
            </div>
            <div className="flex items-start gap-3 rounded-xl bg-emerald-50 p-4 text-emerald-950">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-700" />
              <p className="text-sm leading-6">
                Ava will never move the meeting or notify attendees until you
                approve the request.
              </p>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
