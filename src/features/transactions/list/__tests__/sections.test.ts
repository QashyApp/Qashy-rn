import { groupTransactionsByDay } from "@/features/transactions/list/sections";

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
