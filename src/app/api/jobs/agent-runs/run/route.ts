import {
  hasValidCronAuthorization,
  isCronWorkerConfigured,
} from "@/lib/jobs/cron-auth";
import { logWorkerFailure } from "@/lib/jobs/worker-error";
import { runQueuedInboundAgentRuns } from "@/lib/agent/inbound-runner";

export const runtime = "nodejs";

async function execute(request: Request) {
  if (!isCronWorkerConfigured()) {
    return Response.json(
      { error: "Inbound agent worker is not configured." },
      { status: 503 },
    );
  }
  if (!hasValidCronAuthorization(request)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const summary = await runQueuedInboundAgentRuns();
    return Response.json({ status: "completed", summary });
  } catch (error) {
    logWorkerFailure("inbound_agent", error);
    return Response.json(
      { error: "Inbound agent worker failed. Inspect secure server logs." },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return execute(request);
}

export async function POST(request: Request) {
  return execute(request);
}
