import { runDueAutomations } from "@/lib/automation/runner";
import {
  hasValidCronAuthorization,
  isCronWorkerConfigured,
} from "@/lib/jobs/cron-auth";
import { logWorkerFailure } from "@/lib/jobs/worker-error";

export const runtime = "nodejs";

async function execute(request: Request) {
  if (!isCronWorkerConfigured()) {
    return Response.json(
      { error: "Automation runner is not configured." },
      { status: 503 },
    );
  }

  if (!hasValidCronAuthorization(request)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const summary = await runDueAutomations();
    return Response.json({ status: "completed", summary });
  } catch (error) {
    logWorkerFailure("automation", error);
    return Response.json(
      { error: "Automation runner failed. Inspect secure server logs." },
      { status: 500 },
    );
  }
}

// Vercel Cron invokes GET requests. POST is kept for a separately authenticated
// durable worker or an operator-run health check.
export async function GET(request: Request) {
  return execute(request);
}

export async function POST(request: Request) {
  return execute(request);
}
