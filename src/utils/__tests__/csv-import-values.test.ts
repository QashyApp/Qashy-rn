import {
  detectCsvDateFormat,
  localePrefersMonthFirst,
  normalizeCsvDate,
  resolveCsvDateFormat,
  splitCsvAmountSign,
} from "@/utils/csv-import-values";

describe("normalizeCsvDate", () => {
  it("reads YYYY-MM-DD and rejects other shapes under that format", () => {
    expect(normalizeCsvDate("2026-07-15", "ymd")).toBe("2026-07-15");
    expect(normalizeCsvDate("15/07/2026", "ymd")).toBeNull();
  });

  it("reads day-first dates with any of / . - and one or two digits", () => {
    expect(normalizeCsvDate("15/07/2026", "dmy")).toBe("2026-07-15");
    expect(normalizeCsvDate("5.7.2026", "dmy")).toBe("2026-07-05");
    expect(normalizeCsvDate("05-07-2026", "dmy")).toBe("2026-07-05");
  });

  it("reads month-first dates", () => {
    expect(normalizeCsvDate("07/15/2026", "mdy")).toBe("2026-07-15");
    expect(normalizeCsvDate("7-5-2026", "mdy")).toBe("2026-07-05");
  });

  it("rejects dates that are not on the calendar", () => {
    expect(normalizeCsvDate("31/02/2026", "dmy")).toBeNull();
    expect(normalizeCsvDate("13/15/2026", "mdy")).toBeNull();
    expect(normalizeCsvDate("2026-02-31", "ymd")).toBeNull();
    expect(normalizeCsvDate("", "dmy")).toBeNull();
  });

  it("does not accept two-digit years", () => {
    expect(normalizeCsvDate("15/07/26", "dmy")).toBeNull();
  });

  it("still reads an ISO date under a day or month first choice", () => {
    expect(normalizeCsvDate("2026-07-15", "dmy")).toBe("2026-07-15");
  });

  it("reads a four-digit lead with / or . as year-month-day under every choice", () => {
    for (const format of ["ymd", "dmy", "mdy"] as const) {
      expect(normalizeCsvDate("2026/03/04", format)).toBe("2026-03-04");
      expect(normalizeCsvDate("2026.03.04", format)).toBe("2026-03-04");
      expect(normalizeCsvDate("2026.3.4", format)).toBe("2026-03-04");
      expect(normalizeCsvDate("2026-3-4", format)).toBe("2026-03-04");
    }
    expect(normalizeCsvDate("2026/02/31", "ymd")).toBeNull();
    expect(normalizeCsvDate("2026/13/01", "dmy")).toBeNull();
  });
});

describe("detectCsvDateFormat", () => {
  it("picks ymd when every date is ISO", () => {
    expect(detectCsvDateFormat(["2026-07-15", "2026-01-02", ""])).toBe("ymd");
  });

  it("picks day-first when a first part exceeds 12", () => {
    expect(detectCsvDateFormat(["03/04/2026", "25/04/2026"], "en-US")).toBe(
      "dmy",
    );
  });

  it("picks month-first when a second part exceeds 12", () => {
    expect(detectCsvDateFormat(["03/04/2026", "04/25/2026"], "he-IL")).toBe(
      "mdy",
    );
  });

  it("falls back to the locale's order when every value is ambiguous", () => {
    const ambiguous = ["03/04/2026", "01/02/2026"];
    expect(detectCsvDateFormat(ambiguous, "he-IL")).toBe("dmy");
    expect(detectCsvDateFormat(ambiguous, "en-US")).toBe("mdy");
    expect(detectCsvDateFormat(ambiguous)).toBe("dmy");
  });

  it("resolves an explicit choice without looking at the values", () => {
    expect(resolveCsvDateFormat("mdy", ["25/04/2026"])).toBe("mdy");
    expect(resolveCsvDateFormat("auto", ["25/04/2026"])).toBe("dmy");
  });

  it("knows which locales write the month first", () => {
    expect(localePrefersMonthFirst("en-US")).toBe(true);
    expect(localePrefersMonthFirst("he-IL")).toBe(false);
    expect(localePrefersMonthFirst(undefined)).toBe(false);
  });
});

describe("splitCsvAmountSign", () => {
  it.each([
    ["-12.50", true, "12.50"],
    ["−12.50", true, "12.50"],
    ["- 12.50", true, "12.50"],
    ["(12.50)", true, "12.50"],
    ["12.50-", true, "12.50"],
    ["12.50", false, "12.50"],
    ["+12.50", false, "+12.50"],
    ["  7 ", false, "7"],
  ])("splits %s", (raw, negative, amount) => {
    expect(splitCsvAmountSign(raw)).toEqual({ negative, amount });
  });

  it("leaves non-amounts for the amount parser to refuse", () => {
    expect(splitCsvAmountSign("-")).toEqual({ negative: false, amount: "-" });
    expect(splitCsvAmountSign("()")).toEqual({
      negative: false,
      amount: "()",
    });
    expect(splitCsvAmountSign("-abc")).toEqual({
      negative: false,
      amount: "-abc",
    });
  });
});
