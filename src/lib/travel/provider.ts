export interface TravelTimeRequest {
  origin: string;
  destination: string;
  departureTime: Date;
  trafficAware: boolean;
}

export interface TravelTime {
  durationSeconds: number;
  distanceMeters: number;
  trafficDurationSeconds: number | null;
  source: "mock" | "google_routes";
  expiresAt: Date;
}

export interface TravelProvider {
  getTravelTime(request: TravelTimeRequest): Promise<TravelTime>;
}

function stableHash(value: string): number {
  return Array.from(value).reduce(
    (total, character) => (total * 31 + character.charCodeAt(0)) >>> 0,
    7,
  );
}

export class MockTravelProvider implements TravelProvider {
  async getTravelTime(request: TravelTimeRequest): Promise<TravelTime> {
    const seed = stableHash(
      request.origin +
        ":" +
        request.destination +
        ":" +
        request.departureTime.toISOString().slice(0, 13),
    );
    const durationSeconds = 20 * 60 + (seed % (35 * 60));
    const trafficPenalty = request.trafficAware ? 7 * 60 + (seed % 10) * 60 : 0;

    return {
      durationSeconds,
      distanceMeters: 5_000 + (seed % 22_000),
      trafficDurationSeconds: request.trafficAware
        ? durationSeconds + trafficPenalty
        : null,
      source: "mock",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    };
  }
}

/**
 * Production route calls are intentionally not made until a Google Cloud project
 * and a server-only Maps key have been configured. The application selects this
 * provider only after that configuration and entitlement checks succeed.
 */
export class GoogleRoutesProvider implements TravelProvider {
  async getTravelTime(request: TravelTimeRequest): Promise<TravelTime> {
    void request;
    throw new Error(
      "Google Routes is not configured. Use MockTravelProvider in development.",
    );
  }
}
