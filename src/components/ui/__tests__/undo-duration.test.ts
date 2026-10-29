import {
  RESUME_UNDO_MS,
  SCREEN_READER_UNDO_MS,
  undoDuration,
  undoRemaining,
} from "@/components/ui/undo-duration";

describe("undoDuration", () => {
  it("leaves the call site's duration alone without a screen reader", () => {
    expect(undoDuration(5000, false)).toBe(5000);
    expect(undoDuration(2000, false)).toBe(2000);
  });

  it("gives a screen reader at least ten seconds, and more if asked", () => {
    expect(undoDuration(5000, true)).toBe(SCREEN_READER_UNDO_MS);
    expect(undoDuration(20_000, true)).toBe(20_000);
  });
});

describe("undoRemaining", () => {
  it("counts down what has already run", () => {
    expect(undoRemaining(10_000, 3_000)).toBe(7_000);
  });

  it("never resumes with less than there is time to act in", () => {
    expect(undoRemaining(5_000, 4_900)).toBe(RESUME_UNDO_MS);
    expect(undoRemaining(5_000, 9_000)).toBe(RESUME_UNDO_MS);
  });
});
