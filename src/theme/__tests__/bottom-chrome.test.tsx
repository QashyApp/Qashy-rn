import { renderHook } from "@testing-library/react-native";
import type { ReactNode } from "react";

import {
  BottomBarClearanceContext,
  FAB_SIZE,
  FLOATING_BAR_HEIGHT,
  WEB_BOTTOM_BAR_HEIGHT,
  floatingBarClearance,
  resolveBottomChromeInset,
  useScreenMetrics,
} from "@/theme/layout";
import { classicTheme } from "@/theme/themes/classic";

const { space } = classicTheme;
const docked = { hasBottomNavigation: false, floatingBarClearance: 0 };

describe("resolveBottomChromeInset", () => {
  it("keeps the docked native bar offsets", () => {
    const inset = resolveBottomChromeInset(docked, 24, space);
    expect(inset.contentPaddingBottom).toBe(space.xxxl + 80);
    expect(inset.batchBarBottom).toBe(space.xxl + 24);
  });

  it("keeps the web bottom bar FAB and batch bar offsets", () => {
    const inset = resolveBottomChromeInset(
      { hasBottomNavigation: true, floatingBarClearance: 0 },
      10,
      space,
    );
    expect(inset.overlayBottom).toBe(10 + WEB_BOTTOM_BAR_HEIGHT + space.md);
    expect(inset.overlayBottom).toBe(102);
    expect(inset.batchBarBottom).toBe(102);
    expect(inset.contentPaddingBottom).toBeGreaterThanOrEqual(170);
  });

  it("lifts the FAB, batch bar, undo bar and scroll padding above the floating bar", () => {
    const clearance = floatingBarClearance(24, space.md);
    expect(clearance).toBe(24 + space.md + FLOATING_BAR_HEIGHT);
    const inset = resolveBottomChromeInset(
      { hasBottomNavigation: false, floatingBarClearance: clearance },
      24,
      space,
    );
    expect(inset.overlayBottom).toBeGreaterThan(clearance);
    expect(inset.batchBarBottom).toBe(inset.overlayBottom);
    expect(inset.stackedOverlayBottom).toBeGreaterThan(inset.overlayBottom);
    expect(inset.contentPaddingBottom).toBeGreaterThan(
      inset.overlayBottom + 58,
    );
  });

  it.each([
    [
      "the phone floating bar",
      { hasBottomNavigation: false, floatingBarClearance: 100 },
      24,
    ],
    [
      "the web bottom bar",
      { hasBottomNavigation: true, floatingBarClearance: 0 },
      0,
    ],
    [
      "the web bottom bar with a home indicator",
      { hasBottomNavigation: true, floatingBarClearance: 0 },
      34,
    ],
    ["the docked native bar", docked, 24],
    ["the web rail and sidebar", docked, 0],
  ])(
    "stacks the undo bar clear of the FAB above %s",
    (_name, metrics, safe) => {
      const inset = resolveBottomChromeInset(metrics, safe, space);
      // The FAB's top edge is overlayBottom + its diameter; the undo bar must start above it.
      expect(inset.stackedOverlayBottom).toBeGreaterThanOrEqual(
        inset.overlayBottom + FAB_SIZE,
      );
    },
  );
});

describe("useScreenMetrics floating clearance", () => {
  it("is 0 without a floating bar and follows the provider with one", async () => {
    const plain = await renderHook(() => useScreenMetrics());
    expect(plain.result.current.floatingBarClearance).toBe(0);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <BottomBarClearanceContext value={96}>
        {children}
      </BottomBarClearanceContext>
    );
    const floating = await renderHook(() => useScreenMetrics(), { wrapper });
    expect(floating.result.current.floatingBarClearance).toBe(96);
  });
});
