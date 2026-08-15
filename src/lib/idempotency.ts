export interface IdempotencyRecord<T> {
  scope: string;
  key: string;
  expiresAt: Date;
  value: T;
}

export interface IdempotencyStore {
  get<T>(scope: string, key: string): Promise<IdempotencyRecord<T> | null>;
  set<T>(record: IdempotencyRecord<T>): Promise<void>;
}

export class IdempotencyService {
  public constructor(
    private readonly store: IdempotencyStore,
    private readonly ttlMilliseconds = 24 * 60 * 60 * 1000,
  ) {}

  async execute<T>(
    scope: string,
    key: string,
    operation: () => Promise<T>,
  ): Promise<{ value: T; replayed: boolean }> {
    const existing = await this.store.get<T>(scope, key);
    if (existing && existing.expiresAt > new Date()) {
      return { value: existing.value, replayed: true };
    }

    const value = await operation();
    await this.store.set({
      scope,
      key,
      value,
      expiresAt: new Date(Date.now() + this.ttlMilliseconds),
    });

    return { value, replayed: false };
  }
}
