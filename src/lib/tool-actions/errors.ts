import "server-only";

/**
 * A deliberately short, safe failure classification suitable for the durable
 * action record and its audit trail. Provider details remain in server logs.
 */
export class ControlledToolActionError extends Error {
  public constructor(
    public readonly code: string,
    message = "Controlled tool action failed.",
  ) {
    super(message);
    this.name = "ControlledToolActionError";
  }
}
