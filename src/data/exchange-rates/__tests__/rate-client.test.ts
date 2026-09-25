import {
  chunkDateRange,
  fetchEurRates,
  RateFetchError,
  type RateClientDeps,
} from '@/data/exchange-rates/rate-client';

/** Wraps a synchronous or async handler as a `typeof fetch`, so tests never touch the network. */
function fakeFetch(
  handler: (url: string, init: RequestInit) => Promise<Response> | Response,
): typeof globalThis.fetch {
  return function (this: unknown, url: string, init?: RequestInit) {
    return Promise.resolve(handler(url as string, init as RequestInit));
  } as unknown as typeof globalThis.fetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const row = (quote: string, rate: number, date = '2026-09-20') => ({ date, base: 'EUR', quote, rate });

describe('chunkDateRange', () => {
  it('keeps a short range as one chunk', () => {
    expect(chunkDateRange('2026-01-01', '2026-01-10')).toEqual([{ from: '2026-01-01', to: '2026-01-10' }]);
  });

  it('keeps a single-day range as one chunk', () => {
    expect(chunkDateRange('2026-01-01', '2026-01-01')).toEqual([{ from: '2026-01-01', to: '2026-01-01' }]);
  });

  it('splits a range longer than 366 days into contiguous ≤366-day chunks', () => {
    const chunks = chunkDateRange('2024-01-01', '2026-01-10');
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].from).toBe('2024-01-01');
    expect(chunks.at(-1)?.to).toBe('2026-01-10');
    for (const chunk of chunks) {
      const days = Math.round((Date.parse(chunk.to) - Date.parse(chunk.from)) / 86_400_000) + 1;
      expect(days).toBeLessThanOrEqual(366);
    }
    // Contiguous: the next chunk starts the day after the previous one ends, so nothing in
    // the range is skipped or requested twice.
    for (let index = 1; index < chunks.length; index += 1) {
      const previousEnd = Date.parse(chunks[index - 1].to);
      const nextStart = Date.parse(chunks[index].from);
      expect(nextStart - previousEnd).toBe(86_400_000);
    }
  });

  it('honors a custom maxDays', () => {
    expect(chunkDateRange('2026-01-01', '2026-01-10', 3)).toEqual([
      { from: '2026-01-01', to: '2026-01-03' },
      { from: '2026-01-04', to: '2026-01-06' },
      { from: '2026-01-07', to: '2026-01-09' },
      { from: '2026-01-10', to: '2026-01-10' },
    ]);
  });

  it('rejects a range whose start is after its end', () => {
    expect(() => chunkDateRange('2026-01-10', '2026-01-01')).toThrow();
  });

  it('rejects a date that is not a real calendar date', () => {
    expect(() => chunkDateRange('2026-02-30', '2026-03-01')).toThrow();
  });
});

describe('fetchEurRates', () => {
  it('issues exactly one request for a single date or "latest"', async () => {
    const fetch = jest.fn(fakeFetch(() => jsonResponse(200, [row('USD', 1.1483)])));
    await fetchEurRates({ fetch }, { quotes: ['USD'] });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('carries the requested quotes and date onto the URL', async () => {
    let capturedUrl = '';
    const fetch = fakeFetch((url) => {
      capturedUrl = url;
      return jsonResponse(200, [row('USD', 1.1483), row('GBP', 0.86)]);
    });
    await fetchEurRates({ fetch }, { quotes: ['GBP', 'USD'], date: '2026-09-20' });
    expect(capturedUrl).toBe('https://api.frankfurter.dev/v2/rates?base=EUR&quotes=GBP,USD&date=2026-09-20');
  });

  it('chunks a long range into several requests and concatenates the rows', async () => {
    const fetch = jest.fn(fakeFetch((url) => {
      const from = /from=([\d-]+)/.exec(url)?.[1] ?? '';
      return jsonResponse(200, [row('USD', 1.1, from)]);
    }));
    const rows = await fetchEurRates({ fetch }, { quotes: ['USD'], from: '2024-01-01', to: '2026-01-10' });
    expect(fetch.mock.calls.length).toBeGreaterThan(1);
    expect(rows).toHaveLength(fetch.mock.calls.length);
  });

  it('maps a timeout to a RateFetchError with code "timeout"', async () => {
    const deps: RateClientDeps = {
      fetch: (function (this: unknown, _url: string, init?: RequestInit) {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('The operation was aborted.');
            error.name = 'AbortError';
            reject(error);
          });
        });
      }) as unknown as typeof globalThis.fetch,
      timeoutMs: 5,
    };
    await expect(fetchEurRates(deps, { quotes: ['USD'] }))
      .rejects.toMatchObject<Partial<RateFetchError>>({ code: 'timeout' });
  });

  it('maps a connection failure to a RateFetchError with code "offline"', async () => {
    const fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof globalThis.fetch;
    await expect(fetchEurRates({ fetch }, { quotes: ['USD'] }))
      .rejects.toMatchObject<Partial<RateFetchError>>({ code: 'offline' });
  });

  it('maps a non-2xx response to a RateFetchError with code "http" and the status', async () => {
    const fetch = fakeFetch(() => jsonResponse(502, {}));
    await expect(fetchEurRates({ fetch }, { quotes: ['USD'] }))
      .rejects.toMatchObject<Partial<RateFetchError>>({ code: 'http', status: 502 });
  });

  it('maps an unparseable body to a RateFetchError with code "malformed"', async () => {
    const fetch = fakeFetch(() => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } } as unknown as Response));
    await expect(fetchEurRates({ fetch }, { quotes: ['USD'] }))
      .rejects.toMatchObject<Partial<RateFetchError>>({ code: 'malformed' });
  });

  it('maps a response that fails schema validation to a RateFetchError with code "malformed"', async () => {
    const fetch = fakeFetch(() => jsonResponse(200, [row('GBP', 0.86)])); // GBP was not requested
    await expect(fetchEurRates({ fetch }, { quotes: ['USD'] }))
      .rejects.toMatchObject<Partial<RateFetchError>>({ code: 'malformed' });
  });

  it('never leaks response contents into a malformed-body error message', async () => {
    const secretMarker = 'super-secret-response-body-marker';
    const fetch = fakeFetch(() => jsonResponse(200, { note: secretMarker }));
    const error: unknown = await fetchEurRates({ fetch }, { quotes: ['USD'] }).catch((caught) => caught);
    expect(error).toBeInstanceOf(RateFetchError);
    expect((error as Error).message).not.toContain(secretMarker);
  });
});
