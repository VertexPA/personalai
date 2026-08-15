import "server-only";

export class NotificationDeliveryError extends Error {
  public constructor(
    public readonly code: string,
    message = "Notification delivery failed.",
  ) {
    super(message);
    this.name = "NotificationDeliveryError";
  }
}
