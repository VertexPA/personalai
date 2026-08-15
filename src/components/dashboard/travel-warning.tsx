import { ArrowRight, CarFront, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export function TravelWarning({
  message,
  recommendation,
  isDemo,
}: {
  message: string;
  recommendation: string;
  isDemo: boolean;
}) {
  return (
    <Card className="border-amber-200 bg-amber-50/70 shadow-none dark:border-amber-900/60 dark:bg-amber-950/20">
      <CardContent className="flex gap-3 p-4">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300">
          <TriangleAlert className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">Travel warning</p>
            {isDemo ? (
              <Badge
                className="border-amber-200 bg-amber-100 text-amber-800"
                variant="outline"
              >
                Development estimate
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {message}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-medium text-amber-900 dark:text-amber-200">
            <CarFront className="size-3.5" />
            Review schedule
            <ArrowRight className="size-3.5" />
            {recommendation}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
