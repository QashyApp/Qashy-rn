/**
 * The one network call this feature makes: a GET to `api.frankfurter.dev` for EUR-pivot rates.
 *
 * `fetch` is injected rather than reached for, the same reasoning as `src/sync/transport/http.ts`:
 * it lets tests exercise a timeout, an offline device, a 5xx, and a malformed body without a
 * real network, and it is what makes "nothing may touch the network until the user enables it
 * on this device" (see the design spec) a property this module cannot violate by accident —
 * whoever constructs `RateClientDeps` decides whether `fetch` is real.
 */

import {
  buildRatesUrl,
  parseRatesResponse,
  type FrankfurterRow,
  type RatesUrlParams,
} from '@/data/exchange-rates/frankfurter';
import { addRecurrence, isLocalDate } from '@/utils/date';

/** How long a single request is allowed to take before it counts as a timeout. */
const DEFAULT_TIMEOUT_MS = 10_000;

/** The longest span Frankfurter accepts in one `from`/`to` request. */
const MAX_RANGE_DAYS = 366;

export interface RateClientDeps {
  readonly fetch: typeof globalThis.fetch;
  /** Overridden in tests; on device it is `DEFAULT_TIMEOUT_MS`. */
  readonly timeoutMs?: number;
}

export type RateFetchErrorCode = 'offline' | 'timeout' | 'http' | 'malformed';

export class RateFetchError extends Error {
  constructor(
    message: string,
    readonly code: RateFetchErrorCode,
    /** The HTTP status, when there was one. */
    readonly status?: number,
  ) {
    super(message);
    this.name = 'RateFetchError';
  }
}

/**
 * True when the platform is sure there is no network.
 *
 * Only ever used to pick a failure's label, never to skip an attempt — `navigator.onLine` is
 * optimistic (it reports `true` behind a captive portal) and RN does not define it at all, so
 * it is trustworthy in one direction only.
 */
const looksOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/**
 * Splits an inclusive `[from, to]` range into chunks no longer than `maxDays`, so a range
 * spanning more than a year still lands as ≤366-day requests. Chunk boundaries are contiguous
 * (`to` of one chunk, `+1 day`, is `from` of the next) so no day inside the range is skipped or
 * requested twice.
 */
export function chunkDateRange(
  from: string,
  to: string,
  maxDays = MAX_RANGE_DAYS,
): { readonly from: string; readonly to: string }[] {
  if (!isLocalDate(from) || !isLocalDate(to)) {
    throw new RangeError('chunkDateRange requires real calendar dates.');
  }
  if (from > to) throw new RangeError('Range start must not be after its end.');
  const chunks: { from: string; to: string }[] = [];
  let chunkStart = from;
  while (true) {
    const naturalEnd = addRecurrence(chunkStart, 'day', maxDays - 1);
    const chunkEnd = naturalEnd < to ? naturalEnd : to;
    chunks.push({ from: chunkStart, to: chunkEnd });
    if (chunkEnd >= to) break;
    chunkStart = addRecurrence(chunkEnd, 'day', 1);
  }
  return chunks;
}

/**
 * One hardened GET, decoded as JSON. Every protection `src/sync/transport/http.ts` applies to
 * the relay applies here for the same reasons: no cookie can be set or read, a redirect is
 * refused rather than followed, and nothing is cached. Never logs the URL or the response body
 * — both go straight into the return value or a generic, fixed error message.
 */
async function requestJson(deps: RateClientDeps, url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let response: Response;
  try {
    // A browser's native `window.fetch` is branded: calling it as `deps.fetch(...)` makes
    // `deps` its receiver and throws "Illegal invocation" before any request leaves the
    // device. Bind it explicitly, as `http.ts` does, so injected browser fetch, Expo's fetch,
    // and test doubles all run with the platform global as their receiver.
    response = await deps.fetch.call(globalThis, url, {
      method: 'GET',
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      headers: { accept: 'application/json' },
    });
  } catch {
    // Every network-layer failure lands here indistinguishably. The only distinction worth
    // making is whether *our own* timeout fired the abort, since nothing else here ever calls
    // `controller.abort()`.
    if (controller.signal.aborted) {
      throw new RateFetchError('Timed out reaching Frankfurter.', 'timeout');
    }
    throw new RateFetchError(
      looksOffline() ? 'This device is offline.' : 'Could not reach Frankfurter.',
      'offline',
    );
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new RateFetchError(`Frankfurter answered ${response.status}.`, 'http', response.status);
  }
  try {
    return await response.json();
  } catch {
    throw new RateFetchError('Frankfurter sent something that was not JSON.', 'malformed');
  }
}

/**
 * Fetches EUR-pivot rows for `params.quotes`, transparently chunking a `from`/`to` range
 * longer than Frankfurter's 366-day limit into several requests and concatenating the rows.
 *
 * Every failure — a bad connection, a timeout, a non-2xx response, or a body that fails
 * `parseRatesResponse` — surfaces as a `RateFetchError` with a code a caller can act on (retry,
 * fall back to a stored rate, or show an offline state) without inspecting a message string.
 */
export async function fetchEurRates(
  deps: RateClientDeps,
  params: RatesUrlParams,
): Promise<FrankfurterRow[]> {
  const requests: RatesUrlParams[] = 'from' in params
    ? chunkDateRange(params.from, params.to).map((chunk) => ({ quotes: params.quotes, ...chunk }))
    : [params];

  const rows: FrankfurterRow[] = [];
  for (const request of requests) {
    const url = buildRatesUrl(request);
    const json = await requestJson(deps, url);
    try {
      rows.push(...parseRatesResponse(json, params.quotes));
    } catch {
      // Never surface `error.message` here: on a malformed body it can echo back whatever the
      // response actually contained, and "never log response bodies" applies to error text
      // just as much as to a console.log.
      throw new RateFetchError('Frankfurter sent a response Qashy does not understand.', 'malformed');
    }
  }
  return rows;
}
