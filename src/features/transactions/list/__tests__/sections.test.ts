import {
  groupLedgerSections,
  groupTransactionsByDay,
  UPCOMING_SECTION,
} from "@/features/transactions/list/sections";

describe("groupTransactionsByDay", () => {
  it("returns no sections for no transactions", () => {
    expect(groupTransactionsByDay([])).toEqual([]);
  });

  it("groups by day in first-seen order and keeps row order", () => {
    const rows = [
      { id: "a", localDate: "2026-03-09" },
      { id: "b", localDate: "2026-03-09" },
      { id: "c", localDate: "2026-03-07" },
      { id: "d", localDate: "2026-03-09" },
    ];
    const sections = groupTransactionsByDay(rows);
    expect(sections.map((section) => section.title)).toEqual([
      "2026-03-09",
      "2026-03-07",
    ]);
    expect(sections[0].data.map((row) => row.id)).toEqual(["a", "b", "d"]);
    expect(sections[1].data.map((row) => row.id)).toEqual(["c"]);
  });

  it("does not mutate its input", () => {
    const rows = [{ localDate: "2026-01-01" }];
    groupTransactionsByDay(rows);
    expect(rows).toEqual([{ localDate: "2026-01-01" }]);
  });
});

describe("groupLedgerSections", () => {
  const rows = [
    { id: "a", localDate: "2026-03-09", status: "posted" },
    { id: "b", localDate: "2026-03-20", status: "upcoming" },
    { id: "c", localDate: "2026-03-07", status: "posted" },
    { id: "d", localDate: "2026-03-12", status: "upcoming" },
  ];

  it("is the plain day grouping when upcoming rows are not grouped", () => {
    expect(
      groupLedgerSections(rows, {
        groupUpcoming: false,
        upcomingCollapsed: false,
      }).map((section) => section.title),
    ).toEqual(["2026-03-09", "2026-03-20", "2026-03-07", "2026-03-12"]);
  });

  it("gathers upcoming rows into one leading group", () => {
    const sections = groupLedgerSections(rows, {
      groupUpcoming: true,
      upcomingCollapsed: false,
    });
    expect(sections.map((section) => section.title)).toEqual([
      UPCOMING_SECTION,
      "2026-03-09",
      "2026-03-07",
    ]);
    expect(sections[0].kind).toBe("upcoming");
    expect(sections[0].data.map((row) => row.id)).toEqual(["b", "d"]);
  });

  it("keeps a collapsed group's header and count but drops its rows", () => {
    const [group] = groupLedgerSections(rows, {
      groupUpcoming: true,
      upcomingCollapsed: true,
    });
    expect(group.data).toEqual([]);
    expect(group.count).toBe(2);
  });

  it("adds no group when nothing is upcoming", () => {
    const posted = rows.filter((row) => row.status === "posted");
    expect(
      groupLedgerSections(posted, {
        groupUpcoming: true,
        upcomingCollapsed: false,
      }).map((section) => section.title),
    ).toEqual(["2026-03-09", "2026-03-07"]);
  });
});
