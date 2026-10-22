import { expect, test, type Page } from "@playwright/test";
import {
  confirmDialog,
  fillAmount,
  dismissKeypad,
  completeOnboarding,
  addExpense,
  todayKey,
} from "./helpers";

const TRANSACTIONS_URL = /\/transactions(\?month=\d{4}-\d{2})?$/;

test("completes onboarding and records an expense", async ({ page }) => {
  await completeOnboarding(page);
  await expect(page.getByText("Net worth", { exact: true })).toBeVisible();

  await page.getByLabel("Add transaction").first().click();
  await fillAmount(page.getByLabel("Amount (USD)"), "12.50");
  await page.getByLabel("Title").fill("Coffee");
  await page.getByRole("radio", { name: "Dining" }).click();
  await page.getByRole("button", { name: "Add transaction" }).click();
  await expect(page).toHaveURL(/\/overview$/, { timeout: 15_000 });
  await expect(page.getByText("Coffee")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Coffee")).toBeVisible();
  await page.getByRole("link", { name: /Transactions/ }).click();
  await page.getByRole("button", { name: "Select" }).click();
  await page.getByRole("checkbox", { name: /Coffee/ }).click();
  await expect(page.getByText("1 selected")).toBeVisible();
  // Category changes live behind the batch bar's Edit button.
  await page.getByRole("button", { name: "Edit (1)" }).click();
  await page.getByRole("button", { name: "Change category" }).click();
  await page.getByRole("button", { name: "Groceries" }).click();
  await expect(
    page.getByText(/Groceries · Everyday/).filter({ visible: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText(/Groceries · Everyday/).filter({ visible: true }),
  ).toBeVisible();
});

test("reconciles finance changes across open browser tabs", async ({
  page,
  context,
}) => {
  await completeOnboarding(page);
  const secondPage = await context.newPage();
  await secondPage.goto("/transactions");
  await expect(secondPage.getByText("No transactions yet")).toBeVisible();

  // Opening the second tab backgrounds this one, and a hidden tab never finishes the keypad's
  // close animation on touch devices.
  await page.bringToFront();
  await page.getByLabel("Add transaction").first().click();
  await fillAmount(page.getByLabel("Amount (USD)"), "8");
  await page.getByLabel("Title").fill("Cross-tab update");
  await page.getByRole("button", { name: "Add transaction" }).click();

  await secondPage.bringToFront();
  await expect(secondPage.getByText("Cross-tab update")).toBeVisible();
  await secondPage.close();
});

test("preserves a selected transaction type and lets an edit clear its category", async ({
  page,
}) => {
  await completeOnboarding(page);
  await page.getByLabel("Add transaction").first().click();
  await fillAmount(page.getByLabel("Amount (USD)"), "12.50");
  await page.getByLabel("Title").fill("Category edit");
  await page.getByRole("radio", { name: "Dining" }).click();
  await page.getByRole("radio", { name: "Expense" }).click();
  await expect(page.getByRole("radio", { name: "Dining" })).toBeChecked();
  await page.getByRole("button", { name: "Add transaction" }).click();

  await page.getByRole("link", { name: /Transactions/ }).click();
  await page.getByRole("button", { name: /Category edit/ }).click();
  // The form sheet mounts a parked placeholder copy of itself in the screen stack before the
  // presented sheet paints. That copy's kind pills are momentarily the first role match, and a
  // click captured there waits forever on an element that is never shown again. It freezes
  // before the transaction loads, so its pills stay unchecked; requiring the checked pill can
  // only ever resolve to the presented sheet, which loads the transaction's own kind.
  await page.getByRole("radio", { name: "Expense", checked: true }).click();
  await expect(page.getByRole("radio", { name: "Dining" })).toBeChecked();
  const uncategorized = page.getByRole("radio", { name: "Uncategorized" });
  await uncategorized.click();
  await expect(uncategorized).toBeChecked();
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page).toHaveURL(TRANSACTIONS_URL);
  await expect(
    page.getByText(/Uncategorized · Everyday/).filter({ visible: true }),
  ).toBeVisible();
});

test("edits tags carried by an imported transaction", async ({ page }) => {
  await completeOnboarding(page);
  await page.goto("/csv");
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose CSV" }).click();
  const chooser = await chooserPromise;
  // Dated today rather than read from a fixture: the ledger opens on the current month, so a
  // hard-coded date stops appearing in it the moment the calendar moves on.
  const csv = `date,type,status,title,amount,currency,account,category,tags,note
${todayKey()},expense,posted,Tagged import,10.00,USD,Everyday,,Work,Imported
`;
  await chooser.setFiles({
    name: "tagged.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByRole("button", { name: "Preview import" }).click();
  await expect(
    page.getByText("Ready").locator("..").getByText("1"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Import 1 transaction" }).click();
  await confirmDialog(page);
  // Pressable does not await an async onPress handler. Wait for the preview to move out of its
  // pre-commit state before navigating, or WebKit can reload the ledger while the Dexie write is
  // still in flight.
  await expect(
    page.getByRole("button", { name: "Import 1 transaction" }),
  ).toHaveCount(0);
  // Stay in the same app instance after the async commit. A full WebKit reload can race the
  // browser's IndexedDB restore even after the repository write has completed; returning through
  // the stack and selecting the section exercises the edit flow without that unrelated race.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("link", { name: "Transactions" }).click();
  await page.getByRole("button", { name: /Tagged import/ }).click();
  const workTag = page.getByRole("checkbox", { name: "Work" });
  await expect(workTag).toBeChecked();
  await workTag.click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("button", { name: /Tagged import/ }).click();
  await expect(page.getByRole("checkbox", { name: "Work" })).not.toBeChecked();
});

test("opens the external import wizard and keeps its source copy behind a disclosure", async ({
  page,
}) => {
  await completeOnboarding(page);
  await page.goto("/csv");

  await page.getByRole("button", { name: "Start import" }).click();
  await expect(page).toHaveURL(/\/import-app$/);
  await expect(page.getByText("Step 1 of 4")).toBeVisible();
  await expect(page.getByText("Choose an app", { exact: true })).toBeVisible();
  // The long reference copy is collapsed so the source step stays one decision.
  await expect(page.getByText("Will be imported", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "What this includes" }).click();
  await expect(
    page.getByText("Will be imported", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Step 2 of 4")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Choose Cashew backup file" }),
  ).toBeVisible();

  // Back moves one stage within the wizard rather than leaving it.
  await page.getByRole("button", { name: "Back", exact: true }).last().click();
  await expect(page.getByText("Step 1 of 4")).toBeVisible();
});

test("labels compact navigation and recovers a one-account transfer draft", async ({
  page,
}) => {
  await completeOnboarding(page);
  await page.setViewportSize({ width: 900, height: 820 });
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  const overviewLink = page.getByRole("link", { name: "Overview" });
  await expect(overviewLink).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Transactions" })).toBeVisible();

  await page.getByLabel("Add transaction").first().click();
  await dismissKeypad(page);
  await page.getByRole("radio", { name: "Transfer" }).click();
  await expect(page.getByText("Transfers need two accounts")).toBeVisible();
  await page.getByRole("button", { name: "Add another account" }).click();
  await page.getByLabel("Account name").fill("Savings");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/transaction/);
  const destination = page
    .getByRole("radiogroup", { name: "To account" })
    .getByRole("radio", { name: /Savings · USD/ });
  await expect(destination).toBeVisible();
  await fillAmount(page.getByLabel("Amount (USD)"), "10");
  await destination.click();
  await page.getByRole("button", { name: "Add transaction" }).click();
  await page.getByRole("link", { name: /Transactions/ }).click();
  await page.getByRole("button", { name: "Select" }).click();
  await page.getByRole("checkbox", { name: /Transfer/ }).click();
  await page.getByRole("button", { name: "Edit (1)" }).click();
  // The sheet explains why, and the category step cannot be opened.
  await expect(
    page.getByText("Transfers do not have categories."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Change category/ }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Uncategorized" })).toHaveCount(
    0,
  );
});

test("clears batch selection when the transaction search changes", async ({
  page,
}) => {
  await completeOnboarding(page);
  await page.getByLabel("Add transaction").first().click();
  await fillAmount(page.getByLabel("Amount (USD)"), "12.50");
  await page.getByLabel("Title").fill("Coffee");
  await page.getByRole("button", { name: "Add transaction" }).click();
  await page.getByRole("link", { name: /Transactions/ }).click();
  await page.getByRole("button", { name: "Select" }).click();
  await page.getByRole("checkbox", { name: /Coffee/ }).click();
  await expect(page.getByText("1 selected")).toBeVisible();

  await page.getByLabel("Search transactions").fill("no match");
  await expect(page.getByText("0 selected")).toBeVisible();
  await page.getByLabel("Search transactions").fill("");
  await expect(
    page.getByRole("checkbox", { name: /Coffee/ }),
  ).not.toBeChecked();
});

test("pages the ledger by month and deep-links to one", async ({ page }) => {
  await completeOnboarding(page);
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);
  const pad = (value: number) => String(value).padStart(2, "0");
  const lastMonthKey = `${lastMonth.getFullYear()}-${pad(lastMonth.getMonth() + 1)}`;

  await addExpense(page, "This month coffee");
  await addExpense(page, "Last month rent", `${lastMonthKey}-15`);

  await page.getByRole("link", { name: /Transactions/ }).click();
  const thisMonthKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  await page.goto(`/transactions?month=${thisMonthKey}`);
  await expect(page.getByText("This month coffee")).toBeVisible();
  await expect(page.getByText("Last month rent")).toHaveCount(0);

  await page.getByLabel("Previous month").first().click();
  await expect(page.getByText("Last month rent")).toBeVisible();
  await expect(page.getByText("This month coffee")).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`month=${lastMonthKey}$`));

  // A deep link lands on its month directly.
  await page.goto(`/transactions?month=${thisMonthKey}`);
  await expect(page.getByText("This month coffee")).toBeVisible();

  // Search stays in the month until it is widened explicitly.
  await page.getByLabel("Search transactions").fill("rent");
  await expect(page.getByText("Nothing matches")).toBeVisible();
  await page.getByRole("checkbox", { name: "Search all months" }).click();
  await expect(page.getByText("Last month rent")).toBeVisible();
});

/** Seeds one expense this month and one last month, then opens this month's ledger with swipe on. */
async function openLedgerWithSwipe(page: Page) {
  await completeOnboarding(page);
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() - 1, 15);
  const pad = (value: number) => String(value).padStart(2, "0");
  const lastKey = `${last.getFullYear()}-${pad(last.getMonth() + 1)}`;
  const thisKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  // Wait for each sheet to close: a full reload while a save is in flight can drop the next page.
  await addExpense(page, "This month coffee");
  await expect(page).toHaveURL(/\/overview$/);
  await addExpense(page, "Last month rent", `${lastKey}-15`);
  await expect(page).toHaveURL(/\/overview$/);
  await page.goto("/gestures");
  const swipeSwitch = page.getByRole("switch", {
    name: "Swipe to change month",
  });
  await swipeSwitch.click();
  await expect(swipeSwitch).toBeChecked();
  await page.goto(`/transactions?month=${thisKey}`);
  await expect(page.getByText("This month coffee")).toBeVisible();
  return { lastKey, thisKey };
}

test("swipes between months with a finger but not with a mouse", async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(
    browserName !== "chromium",
    "Touch input is injected through the Chrome DevTools Protocol.",
  );
  const { lastKey } = await openLedgerWithSwipe(page);

  // A mouse drag across the list must stay inert (desktop text selection).
  if (!isMobile) {
    await page.mouse.move(700, 600);
    await page.mouse.down();
    await page.mouse.move(1100, 600, { steps: 12 });
    await page.mouse.up();
    await expect(page.getByText("This month coffee")).toBeVisible();
    await expect(page.getByText("Last month rent")).toHaveCount(0);
    return;
  }

  // A vertical-dominant finger drag must not change the month.
  const cdp = await page.context().newCDPSession(page);
  const drag = async (from: [number, number], to: [number, number]) => {
    const steps = 14;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: from[0], y: from[1] }],
    });
    for (let i = 1; i <= steps; i += 1) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: from[0] + ((to[0] - from[0]) * i) / steps,
            y: from[1] + ((to[1] - from[1]) * i) / steps,
          },
        ],
      });
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  };
  const width = page.viewportSize()?.width ?? 400;
  await drag([width / 2, 650], [width / 2 + 10, 350]);
  await expect(page.getByText("This month coffee")).toBeVisible();

  // A short horizontal drag springs back.
  await drag([width / 2, 500], [width / 2 + 30, 502]);
  await expect(page.getByText("This month coffee")).toBeVisible();

  // A long drag toward the end edge steps back a month.
  await drag([40, 500], [width - 40, 505]);
  await expect(page.getByText("Last month rent")).toBeVisible();
  await expect(page.getByText("This month coffee")).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`month=${lastKey}$`));
});

test("selects the rows between a held row and the finger while dragging", async ({
  page,
  context,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Drives a touch drag.");
  await completeOnboarding(page);
  for (const title of ["Row A", "Row B", "Row C", "Row D", "Row E"])
    await addExpense(page, title);
  await page.getByRole("link", { name: /Transactions/ }).click();
  const box = async (title: string) => {
    const found = await page
      .getByText(title, { exact: true })
      .filter({ visible: true })
      .first()
      .boundingBox();
    if (!found) throw new Error(`no row ${title}`);
    return found;
  };
  // The list scrolls to and flashes the last saved row; wait for it to come to rest.
  await page.waitForTimeout(1200);
  const cdp = await context.newCDPSession(page);
  const touch = (
    type: "touchStart" | "touchMove" | "touchEnd",
    y: number | null,
  ) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: y === null ? [] : [{ x: 120, y }],
    });
  const centre = async (title: string) => {
    const b = await box(title);
    return b.y + b.height / 2;
  };
  // Newest first: E, D, C, B, A. Hold on D, drag to B.
  const startY = await centre("Row D");
  await touch("touchStart", startY);
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(100);
    await touch("touchMove", startY + (i % 2));
  }
  await expect(page.getByText("1 selected")).toBeVisible();
  // A browser has committed the held touch to scrolling by now; a drag from a selected row (which
  // opts out of touch scrolling) is the one that always works.
  await touch("touchEnd", null);
  // Lifting the finger folds the top section away for selection mode, which moves the rows up.
  await page.waitForTimeout(600);
  const firstBefore = await box("Row E");
  const grabY = await centre("Row D");
  const targetY = await centre("Row B");
  await touch("touchStart", grabY);
  await touch("touchMove", grabY + 1);
  await page.waitForTimeout(50);
  for (let step = 1; step <= 12; step++) {
    await touch("touchMove", grabY + ((targetY - grabY) * step) / 12);
    await page.waitForTimeout(16);
  }
  await expect(page.getByText("3 selected")).toBeVisible();
  await touch("touchEnd", null);
  await expect(page.getByText("3 selected")).toBeVisible();
  // The list itself did not scroll under the finger.
  expect((await box("Row E")).y).toBeCloseTo(firstBefore.y, 0);
});
