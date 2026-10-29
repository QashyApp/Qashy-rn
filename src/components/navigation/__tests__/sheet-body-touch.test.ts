import {
  BODY_ACTIVE_OFFSET,
  BODY_FAIL_OFFSET,
  classifyBodyTouch,
} from "@/components/navigation/sheet-body-touch";

describe("classifyBodyTouch", () => {
  it("waits until the finger has moved far enough to tell", () => {
    expect(classifyBodyTouch(0, 0)).toBe("wait");
    expect(classifyBodyTouch(3, BODY_ACTIVE_OFFSET - 1)).toBe("wait");
    expect(classifyBodyTouch(BODY_FAIL_OFFSET - 1, 2)).toBe("wait");
  });

  it("activates on a vertical move, either way", () => {
    expect(classifyBodyTouch(0, BODY_ACTIVE_OFFSET)).toBe("activate");
    expect(classifyBodyTouch(0, -BODY_ACTIVE_OFFSET)).toBe("activate");
    expect(classifyBodyTouch(4, 14)).toBe("activate");
  });

  it("fails on a horizontal move, either way", () => {
    expect(classifyBodyTouch(BODY_FAIL_OFFSET, 0)).toBe("fail");
    expect(classifyBodyTouch(-BODY_FAIL_OFFSET, 3)).toBe("fail");
  });

  it("lets the dominant axis decide a diagonal start", () => {
    expect(classifyBodyTouch(14, 11)).toBe("fail");
    expect(classifyBodyTouch(11, 14)).toBe("activate");
    // Equal travel on both axes goes to the horizontal scroll view.
    expect(classifyBodyTouch(12, 12)).toBe("fail");
    // Vertical past its threshold but not past the horizontal travel: keep waiting.
    expect(classifyBodyTouch(11, 11)).toBe("wait");
  });
});
