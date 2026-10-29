import {
  actionLeavesList,
  rowSwipeActionLabel,
  rowSwipeActionVisual,
  rowSwipeActions,
  sideOfAction,
} from "@/features/transactions/list/row-swipe/row-swipe-actions";

const theme = {
  accent: "#a",
  onAccent: "#b",
  negative: "#c",
  onNegative: "#d",
  positive: "#e",
  onPositive: "#f",
  warning: "#g",
  onWarning: "#h",
};

describe("rowSwipeActions", () => {
  it("changes category toward the start and deletes toward the end", () => {
    expect(rowSwipeActions({ kind: "expense", status: "posted" })).toEqual({
      start: "changeCategory",
      end: "delete",
    });
    expect(rowSwipeActions({ kind: "income", status: "posted" })).toEqual({
      start: "changeCategory",
      end: "delete",
    });
  });

  it("leaves the start side of a transfer empty, since it has no category", () => {
    expect(rowSwipeActions({ kind: "transfer", status: "posted" })).toEqual({
      start: null,
      end: "delete",
    });
  });

  it("marks an upcoming row paid toward the start and skips it toward the end", () => {
    for (const kind of ["expense", "income", "transfer"] as const)
      expect(rowSwipeActions({ kind, status: "upcoming" })).toEqual({
        start: "markPaid",
        end: "skip",
      });
  });
});

describe("actionLeavesList", () => {
  it("is true only for delete and skip; the same transaction stays for the rest", () => {
    expect(actionLeavesList("changeCategory")).toBe(false);
    expect(actionLeavesList("delete")).toBe(true);
    expect(actionLeavesList("skip")).toBe(true);
    expect(actionLeavesList("markPaid")).toBe(false);
  });
});

describe("sideOfAction", () => {
  it("finds the side an action sits on", () => {
    const actions = rowSwipeActions({ kind: "expense", status: "posted" });
    expect(sideOfAction(actions, "delete")).toBe("end");
    expect(sideOfAction(actions, "changeCategory")).toBe("start");
    expect(sideOfAction(actions, "skip")).toBeNull();
  });
});

describe("rowSwipeActionVisual", () => {
  it("uses the existing labels and semantic role colors", () => {
    expect(rowSwipeActionLabel("delete")).toBe("Delete");
    expect(rowSwipeActionLabel("changeCategory")).toBe("Change category");
    expect(rowSwipeActionLabel("markPaid")).toBe("Mark paid");
    expect(rowSwipeActionLabel("skip")).toBe("Skip");
    const del = rowSwipeActionVisual("delete", theme);
    expect(del.background).toBe(theme.negative);
    expect(del.foreground).toBe(theme.onNegative);
    expect(rowSwipeActionVisual("changeCategory", theme).background).toBe(
      theme.accent,
    );
    expect(rowSwipeActionVisual("markPaid", theme).background).toBe(
      theme.positive,
    );
    expect(rowSwipeActionVisual("skip", theme).foreground).toBe(
      theme.onWarning,
    );
  });
});
