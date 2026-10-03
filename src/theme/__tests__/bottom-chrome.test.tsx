import { renderHook } from "@testing-library/react-native";
import type { ReactNode } from "react";

import {
  BottomBarClearanceContext,
  FLOATING_BAR_HEIGHT,
  floatingBarClearance,
  resolveBottomChromeInset,
  useScreenMetrics,
} from "@/theme/layout";
import { classicTheme } from "@/theme/themes/classic";

const { space } = classicTheme;
const docked = { hasBottomNavigation: false, floatingBarClearance: 0 };

describe("resolveBottomChromeInset", () => {
  it("keeps the docked native bar offsets unchanged", () => {
    const inset = resolveBottomChromeInset(docked, 24, space);
    expect(inset.contentPaddingBottom).toBe(space.xxxl + 80);
    expect(inset.batchBarBottom).toBe(space.xxl + 24);
    expect(inset.stackedOverlayBottom).toBe(24 + space.xxl + 64);
  });

  it("keeps the web bottom bar offsets unchanged", () => {
    const inset = resolveBottomChromeInset(
      { hasBottomNavigation: true, floatingBarClearance: 0 },
      10,
      space,
    );
    expect(inset.overlayBottom).toBe(102);
    expect(inset.batchBarBottom).toBe(102);
    expect(inset.contentPaddingBottom).toBe(170);
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
