import { describe, expect, it } from "vitest";

import { InMemoryIdempotencyStore } from "@/lib/demo/repositories";
import { IdempotencyService } from "@/lib/idempotency";

describe("idempotency service", () => {
  it("keeps the same idempotency key isolated by tenant scope", async () => {
    const service = new IdempotencyService(new InMemoryIdempotencyStore());
    let executions = 0;

    const first = await service.execute(
      "tenant-a:notification.send",
      "same-client-key",
      async () => {
        executions += 1;
        return { tenant: "a" };
      },
    );
    const second = await service.execute(
      "tenant-b:notification.send",
      "same-client-key",
      async () => {
        executions += 1;
        return { tenant: "b" };
      },
    );

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(false);
    expect(executions).toBe(2);
  });

  it("replays an existing result within the same tenant scope", async () => {
    const service = new IdempotencyService(new InMemoryIdempotencyStore());
    let executions = 0;

    const operation = async () => {
      executions += 1;
      return { accepted: true };
    };
    await service.execute("tenant-a:calendar.read", "request-1", operation);
    const replay = await service.execute(
      "tenant-a:calendar.read",
      "request-1",
      operation,
    );

    expect(replay).toMatchObject({
      replayed: true,
      value: { accepted: true },
    });
    expect(executions).toBe(1);
  });
});
