import { pendingContributionDraft } from "@/features/plan/goal-contribution-draft";

const blank = {
  contribution: "",
  contributionDate: "2026-06-15",
  contributionNote: "Manual contribution",
};
const stored = { id: "c1", localDate: "2026-06-01", note: "Birthday money" };

describe("pendingContributionDraft", () => {
  it("is nothing for an untouched new contribution", () => {
    expect(pendingContributionDraft(blank, null, null)).toBeNull();
  });

  it("ignores a changed date or note until an amount is typed", () => {
    expect(
      pendingContributionDraft(
        { ...blank, contributionDate: "2026-06-20", contributionNote: "x" },
        null,
        null,
      ),
    ).toBeNull();
    expect(
      pendingContributionDraft({ ...blank, contribution: "  " }, null, null),
    ).toBeNull();
  });

  it("is pending once a new contribution has an amount", () => {
    expect(
      pendingContributionDraft({ ...blank, contribution: "25" }, null, null),
    ).toMatchObject({ contribution: "25", editingId: null });
  });

  it("is nothing for a contribution opened for editing and left alone", () => {
    expect(
      pendingContributionDraft(
        {
          contribution: "40.00",
          contributionDate: stored.localDate,
          contributionNote: stored.note,
        },
        stored,
        "40.00",
      ),
    ).toBeNull();
  });

  it("is pending once an edited contribution differs from the stored one", () => {
    const fields = {
      contribution: "40.00",
      contributionDate: stored.localDate,
      contributionNote: stored.note,
    };
    for (const changed of [
      { contribution: "45.00" },
      { contributionDate: "2026-06-02" },
      { contributionNote: "Other" },
    ]) {
      expect(
        pendingContributionDraft({ ...fields, ...changed }, stored, "40.00"),
      ).toMatchObject({ editingId: "c1" });
    }
  });
});
