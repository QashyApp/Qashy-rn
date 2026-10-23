import { expect, test, type Page } from "@playwright/test";
import { completeOnboarding } from "./helpers";

test("gives keyboard focus a visible ring and themes browser chrome", async ({
  page,
}) => {
  await completeOnboarding(page);

  // react-native-web resets `outline` to none on every pressable it renders, so
  // without the rule in `+html.tsx` this focus is completely invisible.
  await page.keyboard.press("Tab");
  const focused = page.locator(":focus-visible");
  await expect(focused).toHaveCount(1);
  await expect(focused).toHaveCSS("outline-style", "solid");
  await expect(focused).toHaveCSS("outline-width", "2px");

  const chrome = await page.evaluate(() => ({
    ring: getComputedStyle(document.activeElement as Element).outlineColor,
    // Drives whether scrollbars and form widgets paint light or dark.
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    focusVar: getComputedStyle(document.documentElement)
      .getPropertyValue("--qashy-focus")
      .trim(),
    selection: getComputedStyle(document.documentElement)
      .getPropertyValue("--qashy-selection")
      .trim(),
    themeColor: document
      .getElementById("qashy-theme-color-light")
      ?.getAttribute("content"),
  }));
  expect(chrome.colorScheme).toBe("light");
  expect(chrome.focusVar).toMatch(/^#[0-9a-f]{6}$/i);
  expect(chrome.selection).toMatch(/^#[0-9a-f]{6}$/i);
  expect(chrome.ring).not.toBe("rgba(0, 0, 0, 0)");
  // The accent is not a surface the app ever paints, so it must not tint the
  // address bar behind a near-white page.
  expect(chrome.themeColor).toBe("#E8E7F8");
});

test("lays content out against the space the rail leaves, not the window", async ({
  page,
}) => {
  await completeOnboarding(page);
  // The Overview grid packs the default layout's "Budget pulse" and "Accounts" cards (both
  // `regular` size, 3 of the grid's 6 columns each) side by side once the content area clears
  // the 900px breakpoint, and stacks them into a single column below it. ("Spending insight" is
  // `wide` and always spans the full row on its own, so it no longer distinguishes the two
  // layouts the way it did before cards became independently sized.)
  const budgetPulse = page.getByRole("heading", { name: "Budget pulse" });
  const accounts = page.getByRole("heading", { name: "Accounts" });
  const stacked = async () => {
    const [first, second] = await Promise.all([
      budgetPulse.boundingBox(),
      accounts.boundingBox(),
    ]);
    return (second?.y ?? 0) - (first?.y ?? 0) > 100;
  };

  // A 950px window leaves 866px beside the 84px collapsed rail, under the 900px
  // two-column threshold. Measuring the window put these cards side by side in a
  // box 84px narrower than the layout that chose the row assumed it had.
  await page.setViewportSize({ width: 950, height: 1000 });
  await expect.poll(stacked).toBe(true);

  // 1100 leaves 1016px, which genuinely clears the threshold.
  await page.setViewportSize({ width: 1100, height: 1000 });
  await expect.poll(stacked).toBe(false);
});

// `setElementPosition`'s fingerprint: an inline absolute box with no margin.
const detachedCount = (page: Page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll("div")].filter((element) => {
        const style = (element as HTMLElement).style;
        return (
          style.position === "absolute" &&
          style.margin === "0px" &&
          Boolean(style.top && style.left && style.width && style.height)
        );
      }).length,
  );

test("keeps animated content in flow and fully visible once its entrance ends", async ({
  page,
}) => {
  // Onboarding's second step, deliberately. Softening an entrance with
  // `withInitialValues` made Reanimated generate a keyframe outside its
  // built-in registry, and its web cleanup for that case permanently gave the
  // element `position: absolute` plus a snapshot box about 200ms after mount.
  // Labels left their buttons and the buttons collapsed to their own padding.
  // It takes content mounting *after* a screen's first paint to trigger, since
  // `useEntranceAllowed` suppresses entrances during that first paint. Every
  // wait below clears 1000ms deliberately: Reanimated scales its cleanup timer
  // to 5x the animation duration, and before it fires nothing is wrong yet, so
  // a shorter wait passes against the broken build too.
  await page.goto("/");
  await page.getByRole("button", { name: "Get started" }).click();
  const advance = page.getByRole("button", { name: "Continue" });
  await expect(advance).toBeVisible();
  await advance.click();

  await page.waitForTimeout(1500);
  await expect(advance).toContainText("Continue");
  expect((await advance.boundingBox())!.width).toBeGreaterThan(80);
  expect(await detachedCount(page)).toBe(0);

  await page.goto("/");

  await completeOnboarding(page);
  await page.goto("/appearance");
  const save = page.getByRole("button", { name: "Save appearance" });
  await expect(save).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(save).toContainText("Save appearance");
  expect((await save.boundingBox())!.width).toBeGreaterThan(200);
  expect(await detachedCount(page)).toBe(0);

  // The entrance now runs off a shared value, so it also has to actually finish:
  // a stalled one would leave content mounted at opacity 0 instead of misplaced.
  await page.goto("/overview");
  await page.getByLabel("Next month").click();
  await page.waitForTimeout(1500);
  const fadedAncestors = await page.evaluate(() => {
    const label = [...document.querySelectorAll("div")].find(
      (el) => el.textContent === "Net worth",
    );
    const faded: number[] = [];
    for (let el = label as HTMLElement | null; el; el = el.parentElement) {
      const opacity = parseFloat(el.style.opacity);
      if (!isNaN(opacity) && opacity < 0.99) faded.push(opacity);
    }
    return faded;
  });
  expect(fadedAncestors).toEqual([]);
});

test("fades the sidebar hover highlight without ever stacking it over the icon", async ({
  page,
}) => {
  await completeOnboarding(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const link = page.getByRole("link", { name: "Transactions" });
  await expect(link).toBeVisible();

  const highlightOpacity = () =>
    page.evaluate(() => {
      const item = [
        ...document.querySelectorAll('a[href="/transactions"]'),
      ].find((el) => el.getBoundingClientRect().width > 0)!;
      return parseFloat(getComputedStyle(item.children[0]).opacity);
    });

  // Reanimated's web exit moves a leaving element into a clone appended as the
  // pressable's last child. The hover background paints behind the icon as a
  // real child, but its clone painted on top of it — so the icon blinked for
  // the length of the fade on every hover-out and on the click that made the
  // item active. Nothing may be added to or removed from the item at all.
  await page.evaluate(() => {
    const item = [...document.querySelectorAll('a[href="/transactions"]')].find(
      (el) => el.getBoundingClientRect().width > 0,
    )!;
    (window as unknown as { __churn: number }).__churn = 0;
    new MutationObserver((records) => {
      for (const record of records) {
        (window as unknown as { __churn: number }).__churn +=
          record.addedNodes.length + record.removedNodes.length;
      }
    }).observe(item, { childList: true, subtree: true });
  });

  await link.hover();
  await expect.poll(highlightOpacity).toBeGreaterThan(0.9);
  await page.mouse.move(0, 0);
  await expect.poll(highlightOpacity).toBeLessThan(0.05);
  await link.click();
  await expect(page).toHaveURL(/\/transactions$/);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);

  expect(
    await page.evaluate(
      () => (window as unknown as { __churn: number }).__churn,
    ),
  ).toBe(0);
});
