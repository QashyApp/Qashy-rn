import {
  opacityFromTransparency,
  snapTransparency,
  transparencyFromOpacity,
} from "@/features/more/widget-transparency";

describe("widget transparency", () => {
  it("snaps to steps of 5 within 0-100", () => {
    expect(snapTransparency(12)).toBe(10);
    expect(snapTransparency(13)).toBe(15);
    expect(snapTransparency(-8)).toBe(0);
    expect(snapTransparency(140)).toBe(100);
    expect(snapTransparency(Number.NaN)).toBe(0);
  });

  it("is the inverse of the stored opacity", () => {
    expect(opacityFromTransparency(0)).toBe(100);
    expect(opacityFromTransparency(35)).toBe(65);
    expect(transparencyFromOpacity(100)).toBe(0);
    expect(transparencyFromOpacity(37)).toBe(65);
  });
});
