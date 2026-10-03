import { Decimal } from "decimal.js";

import {
  buildRatesUrl,
  deriveBaseRates,
  FRANKFURTER_UNSUPPORTED,
  parseRatesResponse,
  type FrankfurterRow,
} from "@/data/exchange-rates/frankfurter";

describe("buildRatesUrl", () => {
  it("sorts and de-duplicates quotes, and excludes EUR from the list", () => {
    expect(buildRatesUrl({ quotes: ["usd", "GBP", "usd", "EUR"] })).toBe(
      "https://api.frankfurter.dev/v2/rates?base=EUR&quotes=GBP,USD",
    );
  });

  it("omits the quotes param entirely once EUR is the only thing asked for", () => {
    expect(buildRatesUrl({ quotes: ["EUR"] })).toBe(
      "https://api.frankfurter.dev/v2/rates?base=EUR",
    );
  });

  it('omits the date for "latest"', () => {
    expect(buildRatesUrl({ quotes: ["USD"] })).toBe(
      "https://api.frankfurter.dev/v2/rates?base=EUR&quotes=USD",
    );
  });

  it("adds a single date", () => {
    expect(buildRatesUrl({ quotes: ["USD"], date: "2026-09-20" })).toBe(
      "https://api.frankfurter.dev/v2/rates?base=EUR&quotes=USD&date=2026-09-20",
    );
  });

  it("adds a from/to range instead of a date", () => {
    expect(
      buildRatesUrl({ quotes: ["USD"], from: "2026-09-01", to: "2026-09-20" }),
    ).toBe(
      "https://api.frankfurter.dev/v2/rates?base=EUR&quotes=USD&from=2026-09-01&to=2026-09-20",
    );
  });

  it("produces the same URL regardless of the caller-supplied quote order", () => {
    expect(buildRatesUrl({ quotes: ["GBP", "USD"] })).toBe(
      buildRatesUrl({ quotes: ["USD", "GBP"] }),
    );
  });
});

describe("parseRatesResponse", () => {
  it("accepts a well-formed response", () => {
    const rows = [
      { date: "2026-09-20", base: "EUR", quote: "USD", rate: 1.1483 },
    ];
    expect(parseRatesResponse(rows, ["USD"])).toEqual(rows);
  });

  it("accepts a rate given in exponent form", () => {
    const rows = [
      { date: "2026-09-20", base: "EUR", quote: "VND", rate: 2.9793e4 },
    ];
    expect(parseRatesResponse(rows, ["VND"])).toEqual(rows);
  });

  it("rejects the entire response when a row has the wrong base", () => {
    const rows = [
      { date: "2026-09-20", base: "USD", quote: "GBP", rate: 0.85 },
    ];
    expect(() => parseRatesResponse(rows, ["GBP"])).toThrow();
  });

  it("rejects the entire response for a non-ISO or impossible date", () => {
    expect(() =>
      parseRatesResponse(
        [{ date: "not-a-date", base: "EUR", quote: "USD", rate: 1.1 }],
        ["USD"],
      ),
    ).toThrow();
    expect(() =>
      parseRatesResponse(
        [{ date: "2026-02-30", base: "EUR", quote: "USD", rate: 1.1 }],
        ["USD"],
      ),
    ).toThrow();
  });

  it("rejects a non-positive or non-finite rate", () => {
    expect(() =>
      parseRatesResponse(
        [{ date: "2026-09-20", base: "EUR", quote: "USD", rate: 0 }],
        ["USD"],
      ),
    ).toThrow();
    expect(() =>
      parseRatesResponse(
        [{ date: "2026-09-20", base: "EUR", quote: "USD", rate: -1.1 }],
        ["USD"],
      ),
    ).toThrow();
    expect(() =>
      parseRatesResponse(
        [
          {
            date: "2026-09-20",
            base: "EUR",
            quote: "USD",
            rate: Number.POSITIVE_INFINITY,
          },
        ],
        ["USD"],
      ),
    ).toThrow();
  });

  it("rejects a quote currency this call never asked for", () => {
    const rows = [
      { date: "2026-09-20", base: "EUR", quote: "USD", rate: 1.1 },
      { date: "2026-09-20", base: "EUR", quote: "GBP", rate: 0.85 },
    ];
    expect(() => parseRatesResponse(rows, ["USD"])).toThrow("GBP");
  });

  it("rejects a response that is not an array", () => {
    expect(() => parseRatesResponse({ error: "nope" }, ["USD"])).toThrow();
    expect(() => parseRatesResponse(null, ["USD"])).toThrow();
  });
});

describe("FRANKFURTER_UNSUPPORTED", () => {
  it("lists the Qashy-supported currencies Frankfurter does not carry", () => {
    for (const code of ["CUC", "HRK", "SLL", "XSU", "ZWL"]) {
      expect(FRANKFURTER_UNSUPPORTED.has(code)).toBe(true);
    }
    expect(FRANKFURTER_UNSUPPORTED.has("USD")).toBe(false);
  });
});

describe("deriveBaseRates", () => {
  const row = (
    quote: string,
    rate: number,
    date = "2026-09-20",
  ): FrankfurterRow => ({
    date,
    base: "EUR",
    quote,
    rate,
  });

  it("derives 1/eur[F] when the base currency is EUR", () => {
    const [result] = deriveBaseRates([row("USD", 1.1483)], "EUR", ["USD"]);
    expect(result).toMatchObject({
      fromCurrency: "USD",
      toCurrency: "EUR",
      effectiveDate: "2026-09-20",
    });
    expect(result.rate).toBe(
      new Decimal(1).div("1.1483").toSignificantDigits(10).toFixed(),
    );
  });

  it("derives eur[B] directly when the foreign currency is EUR", () => {
    const [result] = deriveBaseRates([row("USD", 1.1483)], "USD", ["EUR"]);
    expect(result).toMatchObject({
      fromCurrency: "EUR",
      toCurrency: "USD",
      effectiveDate: "2026-09-20",
    });
    expect(result.rate).toBe(
      new Decimal("1.1483").toSignificantDigits(10).toFixed(),
    );
  });

  it("derives eur[B]/eur[F] for a cross rate through neither leg being EUR", () => {
    // Both legs on the same day: EUR->USD 1.1483, EUR->VND 29793.
    const rows = [row("USD", 1.1483), row("VND", 29793)];
    const [result] = deriveBaseRates(rows, "USD", ["VND"]);
    expect(result).toMatchObject({
      fromCurrency: "VND",
      toCurrency: "USD",
      effectiveDate: "2026-09-20",
    });
    expect(result.rate).toBe(
      new Decimal("1.1483").div("29793").toSignificantDigits(10).toFixed(),
    );
  });

  it("skips a currency Frankfurter omitted for that date rather than guessing", () => {
    // JPY has no row at all: Frankfurter silently omits currencies it does not carry.
    const results = deriveBaseRates([row("USD", 1.1483)], "EUR", [
      "USD",
      "JPY",
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].fromCurrency).toBe("USD");
  });

  it("skips a pair whose two legs come from different dates", () => {
    // The base leg only exists on day 1, the foreign leg only on day 2 — never derive from a
    // pair of legs that describe two different days.
    const rows = [
      row("USD", 1.1483, "2026-09-19"),
      row("VND", 29793, "2026-09-20"),
    ];
    expect(deriveBaseRates(rows, "USD", ["VND"])).toEqual([]);
  });

  it("returns nothing when there are no foreign currencies to derive", () => {
    expect(deriveBaseRates([row("USD", 1.1483)], "USD", [])).toEqual([]);
    expect(deriveBaseRates([row("USD", 1.1483)], "USD", ["USD"])).toEqual([]);
  });

  it("never produces exponential notation, even for a rate below 1e-7", () => {
    // A hyperinflated currency's EUR rate is large enough that base/foreign drops well under
    // the point where `Decimal#toString()` would switch to exponential notation.
    const rows = [row("BHD", 0.35331), row("VES", 50_000_000)];
    const [result] = deriveBaseRates(rows, "BHD", ["VES"]);
    expect(result.rate).not.toMatch(/e/i);
  });
});
