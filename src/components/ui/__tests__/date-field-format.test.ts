import { dateRangeHint } from "@/components/ui/date-field-format";

describe("dateRangeHint", () => {
  it("accepts anything when there are no bounds, and an unset value", () => {
    expect(dateRangeHint("2026-03-10", "en")).toBeNull();
    expect(dateRangeHint("", "en", "2026-01-01", "2026-12-31")).toBeNull();
  });

  it("accepts the bounds themselves", () => {
    expect(
      dateRangeHint("2026-01-01", "en", "2026-01-01", "2026-12-31"),
    ).toBeNull();
    expect(
      dateRangeHint("2026-12-31", "en", "2026-01-01", "2026-12-31"),
    ).toBeNull();
  });

  it("names the earliest date for a typed date that is too early", () => {
    const hint = dateRangeHint("2025-12-31", "en", "2026-01-01");
    expect(hint).toMatch(/^Choose a date on or after /);
    expect(hint).toContain("2026");
  });

  it("names the latest date for a typed date that is too late", () => {
    expect(dateRangeHint("2027-01-01", "en", undefined, "2026-12-31")).toMatch(
      /^Choose a date on or before /,
    );
  });

  it("names the whole range when both bounds exist", () => {
    expect(
      dateRangeHint("2030-01-01", "en", "2026-01-01", "2026-12-31"),
    ).toMatch(/^Choose a date between .+ and .+$/);
  });
});
