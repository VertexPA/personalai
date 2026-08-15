import {
  hasValidCronAuthorization,
  isCronWorkerConfigured,
} from "@/lib/jobs/cron-auth";
import { logWorkerFailure } from "@/lib/jobs/worker-error";
import { runApprovedToolActions } from "@/lib/tool-actions/runner";

export const runtime = "nodejs";

async function execute(request: Request) {
  if (!isCronWorkerConfigured()) {
    return Response.json(
      { error: "Controlled action worker is not configured." },
      { status: 503 },
    );
  }

  if (!hasValidCronAuthorization(request)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const summary = await runApprovedToolActions();
    return Response.json({ status: "completed", summary });
  } catch (error) {
    logWorkerFailure("tool_action", error);
    return Response.json(
      { error: "Controlled action worker failed. Inspect secure server logs." },
      { status: 500 },
    );
  }
}

// Vercel Cron invokes GET. POST permits the same authenticated worker contract
// for a VPS scheduler without making the action queue publicly callable.
export async function GET(request: Request) {
  return execute(request);
}

export async function POST(request: Request) {
  return execute(request);
}
