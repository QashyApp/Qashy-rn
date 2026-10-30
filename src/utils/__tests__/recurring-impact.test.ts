import type { TransactionRecord } from "@/domain/models";
import {
  overdueOccurrences,
  overduePostedBySave,
  pendingOccurrences,
} from "@/utils/recurring-impact";

const row = (
  overrides: Partial<TransactionRecord> & { id: string },
): TransactionRecord =>
  ({
    status: "upcoming",
    recurringRuleId: "rule-1",
    localDate: "2026-06-01",
    deletedAt: null,
    ...overrides,
  }) as TransactionRecord;

const transactions = [
  row({ id: "a", localDate: "2026-06-01" }),
  row({ id: "b", localDate: "2026-06-15" }),
  row({ id: "c", localDate: "2026-07-01" }),
  row({ id: "posted", status: "posted", localDate: "2026-05-01" }),
  row({ id: "deleted", deletedAt: "2026-06-02T00:00:00.000Z" }),
  row({ id: "other", recurringRuleId: "rule-2", localDate: "2026-06-01" }),
  row({ id: "manual", recurringRuleId: null }),
];

describe("recurring impact", () => {
  it("counts a rule's unposted, undeleted occurrences", () => {
    expect(
      pendingOccurrences(transactions, "rule-1").map((item) => item.id),
    ).toEqual(["a", "b", "c"]);
  });

  it("counts only the occurrences already due, today included", () => {
    expect(
      overdueOccurrences(transactions, "rule-1", "2026-06-15").map(
        (item) => item.id,
      ),
    ).toEqual(["a", "b"]);
    expect(overdueOccurrences(transactions, "rule-1", "2026-05-31")).toEqual(
      [],
    );
  });

  describe("overduePostedBySave", () => {
    const today = "2026-06-15";
    const off = { id: "rule-1", autoPost: false, active: true };

    it("counts the overdue items when auto-post is switched on", () => {
      expect(
        overduePostedBySave(
          off,
          { autoPost: true, active: true },
          transactions,
          today,
        ),
      ).toBe(2);
    });

    it("counts them when a paused auto-post rule is switched back on", () => {
      expect(
        overduePostedBySave(
          { id: "rule-1", autoPost: true, active: false },
          { autoPost: true, active: true },
          transactions,
          today,
        ),
      ).toBe(2);
    });

    it("is zero when nothing newly starts posting", () => {
      // Already auto-posting and active: nothing was waiting.
      expect(
        overduePostedBySave(
          { id: "rule-1", autoPost: true, active: true },
          { autoPost: true, active: true },
          transactions,
          today,
        ),
      ).toBe(0);
      // Auto-post stays off, or the rule stays paused.
      expect(
        overduePostedBySave(
          off,
          { autoPost: false, active: true },
          transactions,
          today,
        ),
      ).toBe(0);
      expect(
        overduePostedBySave(
          off,
          { autoPost: true, active: false },
          transactions,
          today,
        ),
      ).toBe(0);
      // A new rule has no occurrences yet.
      expect(
        overduePostedBySave(
          undefined,
          { autoPost: true, active: true },
          transactions,
          today,
        ),
      ).toBe(0);
    });
  });
});
