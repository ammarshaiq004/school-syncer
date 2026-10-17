import { Inject, Injectable } from '@nestjs/common';
import { COUNTER_STORE, type CounterStore } from '../jobs/counter-store.js';

const HOUR_MS = 3_600_000;
/** Each hour's counter lives a little over a day, then the hourly cleanup drops it. */
const KEEP_MS = 25 * HOUR_MS;

const hourKey = (ms: number) => `api-errors:5xx:${new Date(ms).toISOString().slice(0, 13)}`;

/**
 * Counts server errors (5xx answers) per UTC hour in the shared counter
 * table, so every API instance adds to the same numbers and the console can
 * show the last day's errors without a metrics service.
 */
@Injectable()
export class ApiErrorCounter {
  constructor(@Inject(COUNTER_STORE) private readonly counters: CounterStore) {}

  async record(status: number, now = Date.now()) {
    if (status < 500) return;
    await this.counters.increment(hourKey(now), KEEP_MS, now);
  }

  /** The last `hours` UTC hours, oldest first, with the 5xx count of each. */
  async recent(now = Date.now(), hours = 24): Promise<{ hour: string; count: number }[]> {
    const start = Math.floor(now / HOUR_MS) * HOUR_MS - (hours - 1) * HOUR_MS;
    return Promise.all(
      Array.from({ length: hours }, async (_, i) => {
        const at = start + i * HOUR_MS;
        const counter = await this.counters.get(hourKey(at), now);
        return { hour: new Date(at).toISOString(), count: counter?.count ?? 0 };
      }),
    );
  }
}
