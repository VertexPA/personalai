import "server-only";

import { ControlledToolActionError } from "@/lib/tool-actions/errors";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

interface NotificationIdRow {
  notification_id: string;
}

/**
 * Materializes an already-authorized durable reply as a notification. The
 * database validates the executing action and target conversation in one
 * transaction before the separate delivery worker can reach a provider.
 */
export async function enqueueApprovedNotificationToolAction(
  toolActionId: string,
): Promise<{ notificationId: string }> {
  const database = createSupabaseServiceClient();
  const { data, error } = await database.rpc(
    "enqueue_approved_notification_action",
    { p_tool_action_id: toolActionId },
  );
  if (error) {
    throw new ControlledToolActionError("controlled_notification_queue_failed");
  }
  const row = (data as unknown as NotificationIdRow[] | null)?.[0];
  if (!row?.notification_id) {
    throw new ControlledToolActionError("controlled_notification_queue_failed");
  }

  return { notificationId: row.notification_id };
}
