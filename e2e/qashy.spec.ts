import { expect, test, type Locator, type Page } from "@playwright/test";

/** Confirms the in-app dialog (replaces the browser confirm). Cancel renders first, confirm last. */
async function confirmDialog(page: Page) {
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button").last().click();
  await expect(dialog).toHaveCount(0);
}

/**
 * Types into an amount field. On a touch screen the field opens the calculator keypad over the whole
 * screen and gives up focus at once, so the amount is entered the way a person does, key by key,
 * and the keypad is closed afterwards with "Set amount". (`fill` types into a focused field, and
 * WebKit drops the text because the keypad has already taken the focus away.)
 */
async function fillAmount(field: Locator, value: string) {
  const page = field.page();
  const touch = await page.evaluate(
    () => window.matchMedia("(pointer: coarse)").matches,
  );
  if (!touch) {
    await field.fill(value);
    return;
  }
  const keypad = page.getByRole("group", { name: "Amount keypad" });
  // An autofocused field opens the keypad by itself, a little after the sheet settles.
  const opened = await keypad
    .waitFor({ state: "visible", timeout: 1_000 })
    .then(() => true)
    .catch(() => false);
  if (!opened) await field.click();
  await expect(keypad).toBeVisible();
  // The amount shown in the field may already hold text (an autofocused or prefilled field).
  const backspace = keypad.getByRole("button", {
    name: "Delete last character",
  });
  for (let left = (await field.inputValue()).length; left > 0; left -= 1) {
    await backspace.click();
  }
  for (const character of value) {
    const key =
      character === "."
        ? keypad.getByRole("button", { name: "Decimal separator" })
        : keypad.getByRole("button", { name: character, exact: true });
    await key.click();
  }
  const setAmount = page.getByRole("button", {
    name: /(Set amount|קביעת סכום)$/,
  });
  await setAmount.click();
  await expect(setAmount).toHaveCount(0);
}

/**
 * Closes the calculator keypad an autofocused amount field opened, by tapping the dimmed screen
 * behind it the way a person does, so the form underneath can be used. A no-op without touch.
 */
async function dismissKeypad(page: Page) {
  const touch = await page.evaluate(
    () => window.matchMedia("(pointer: coarse)").matches,
  );
  if (!touch) return;
  const keypad = page.getByRole("group", { name: "Amount keypad" });
  await expect(keypad).toBeVisible();
  // The top of the screen is always the dimmed part, never the keypad.
  await page.mouse.click(10, 10);
  await expect(keypad).toHaveCount(0);
}

async function completeOnboarding(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Get started" }).click();
  // Currency, then the first account.
  await page.getByRole("button", { name: "Continue" }).click();
  await fillAmount(page.getByLabel("Opening balance (USD)"), "1000");
  await page.getByRole("button", { name: "Continue" }).click();
  // Appearance, then the review step.
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Start using Qashy" }).click();
  await expect(page).toHaveURL(/\/overview$/);
}

/** Adds an expense through the transaction sheet from wherever the page is. */
async function addExpense(page: Page, title: string, date?: string) {
  await page.getByLabel("Add transaction").first().click();
  await fillAmount(page.getByLabel("Amount (USD)"), "12");
  await page.getByLabel("Title").fill(title);
  if (date) {
    // Date lives behind "More details" on a fresh transaction — collapsed by
    // default since the fast-entry path (amount → category → save) never needs it.
    await page.getByRole("button", { name: "More details" }).click();
    await page.getByLabel("Date").fill(date);
  }
  await page.getByRole("button", { name: "Add transaction" }).click();
}

const TRANSACTIONS_URL = /\/transactions(\?month=\d{4}-\d{2})?$/;

test("onboarding shell is responsive and branded", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Money, made calmer.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Get started" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "I already use Qashy" }),
  ).toBeVisible();
});

test("offers pairing and backup restore to someone who already uses Qashy", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "I already use Qashy" }).click();
  await expect(page.getByText("Welcome back")).toBeVisible();
  await page
    .getByRole("button", { name: "Restore from a backup file" })
    .click();
  await expect(page).toHaveURL(/\/sync-transfer\?onboarding=1$/);
  await expect(page.getByText("Restore a backup").first()).toBeVisible();
  // Creating a backup needs a vault this device does not have yet.
  await expect(page.getByText("Create a vault backup")).toHaveCount(0);
  await page.goBack();
  await page.getByRole("button", { name: "Pair with another device" }).click();
  await expect(page).toHaveURL(/\/sync-pair\?onboarding=1$/);
  await expect(page.getByText("Join your other device").first()).toBeVisible();
  await expect(page.getByText("This device has my data")).toBeHidden();
});

test("chooses readable locale and currency options during onboarding", async ({
  page,
}) => {
  await page.goto("/");

  // Language comes first, on the welcome screen, so the rest of setup reads in it.
  await expect(page.getByRole("radio", { name: "English" })).toBeChecked();
  await page.getByRole("radio", { name: "עברית" }).click();
  await expect(page.getByText("כסף, בצורה רגועה יותר.")).toBeVisible();
  await page.getByRole("button", { name: "בואו נתחיל" }).click();
  await expect(page.getByText("המטבע הראשי שלכם")).toBeVisible();

  // `exact` matters: the search box is "Search base currency", so a substring
  // match would pull in the dialog alongside the field it belongs to.
  const currencyField = page.getByLabel("מטבע בסיס", { exact: true });
  await currencyField.click();
  await page.getByLabel("חיפוש מטבע בסיס").fill("ILS");
  await page.getByRole("radio", { name: /שקל/ }).click();
  await expect(currencyField.getByText(/שקל/)).toBeVisible();

  await page.getByRole("button", { name: "המשך" }).click();
  await fillAmount(page.getByLabel("יתרת פתיחה (ILS)"), "1000");
  await page.getByRole("button", { name: "המשך" }).click();
  await page.getByRole("button", { name: "המשך" }).click();
  await expect(page.getByText("קטגוריות התחלתיות")).toBeVisible();
  await page.getByRole("button", { name: "התחילו להשתמש ב־Qashy" }).click();
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByText("שווי נקי", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "סקירה" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "he-IL");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  await page.getByLabel("הוספת תנועה").first().click();
  await expect(
    page.getByRole("radiogroup", { name: "סוג תנועה" }),
  ).toBeVisible();
  await expect(page.getByRole("radio", { name: "מסעדות" })).toBeVisible();
  await fillAmount(page.getByLabel("סכום (ILS)"), "10");
  await page.getByLabel("כותרת").fill("בדיקת נגישות");
  await page.getByRole("button", { name: "הוספת תנועה" }).click();
  await expect(
    page.getByRole("button", { name: /הוצאה, כסף יצא.*בדיקת נגישות/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Expense, money out/ }),
  ).toHaveCount(0);

  await page.goto("/goal");
  // The form starts empty: the localized default name shows as the placeholder and is used on save.
  await expect(page.getByLabel("שם היעד")).toHaveAttribute(
    "placeholder",
    "קרן ליום גשום",
  );
  await fillAmount(page.getByPlaceholder("0.00").first(), "5000");
  await page.getByRole("button", { name: "יצירת יעד" }).click();
  await expect(page).toHaveURL(/\/plan$/);
  await expect(page.getByText("יעד חיסכון")).toBeVisible();
  await expect(page.getByText("saving goal")).toHaveCount(0);

  await page.goto("/budget");
  await expect(page.getByLabel("שם התקציב")).toHaveAttribute(
    "placeholder",
    "הוצאות יומיומיות",
  );
  await fillAmount(page.getByPlaceholder("0.00").first(), "1000");
  await page.getByRole("button", { name: "יצירת תקציב" }).click();
  await expect(page).toHaveURL(/\/plan$/);
  await expect(page.getByText(/ to /)).toHaveCount(0);

  await page.getByRole("link", { name: "עוד" }).click();
  await page.getByRole("button", { name: "מחזורית חדשה" }).click();
  await expect(page.getByText("רישום אוטומטי")).toBeVisible();
  await expect(
    page.getByText("כבוי כברירת מחדל. תנועות עתידיות ממתינות לבדיקה שלכם."),
  ).toBeVisible();
  await expect(page.getByText("כל חודש", { exact: true })).toBeVisible();
});

test("applies an onboarding theme choice immediately", async ({ page }) => {
  await page.goto("/");
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  const heading = page.getByText("Make it yours");
  const lightColor = await heading.evaluate(
    (element) => getComputedStyle(element).color,
  );
  await page.getByRole("radio", { name: "Dark" }).click();
  await expect
    .poll(() => heading.evaluate((element) => getComputedStyle(element).color))
    .not.toBe(lightColor);
});

test("guards onboarding and stale edit routes", async ({ page }) => {
  await page.goto("/overview");
  await expect(page).toHaveURL(/\/onboarding$/);
  await completeOnboarding(page);
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/overview$/);
  await page.goto("/transaction?id=missing");
  await expect(page).toHaveURL(/\/transactions$/);
});

test("exposes an installable web manifest", async ({ page }) => {
  const response = await page.request.get("/manifest.json");
  expect(response.ok()).toBeTruthy();
  const manifest = await response.json();
  expect(manifest.short_name).toBe("Qashy");
  expect((await page.request.get(manifest.icons[0].src)).ok()).toBeTruthy();
  expect((await page.request.get(manifest.icons[1].src)).ok()).toBeTruthy();
});

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
  await page.getByRole("radio", { name: "Expense" }).click();
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

/** The goal and budget forms start empty (defaults show as placeholders); a target / limit is required. */
async function createDefaultGoal(page: Page, target = "5000") {
  await page.goto("/goal");
  await fillAmount(
    page.getByRole("textbox", { name: /^Target \(USD\)/ }),
    target,
  );
  await page.getByRole("button", { name: "Create goal" }).click();
}

async function fillBudgetLimit(page: Page, limit = "1000") {
  await fillAmount(
    page.getByRole("textbox", { name: /^Total limit \(USD\)/ }),
    limit,
  );
}

test("edits and deletes manual goal contributions", async ({ page }) => {
  await completeOnboarding(page);
  await createDefaultGoal(page);
  await page.getByRole("button", { name: "Open" }).click();

  await fillAmount(page.getByLabel("Add a manual contribution"), "25");
  await page.getByLabel("Contribution date").fill("2026-07-10");
  await page.getByLabel("Contribution note").fill("First amount");
  await page.getByRole("button", { name: "Add contribution" }).click();
  await expect(page.getByText(/First amount/)).toBeVisible();

  await page.getByRole("button", { name: /Edit contribution/ }).click();
  await fillAmount(page.getByLabel("Contribution amount"), "30");
  await page.getByLabel("Contribution note").fill("Corrected amount");
  await page.getByRole("button", { name: "Save contribution" }).click();
  await expect(page.getByText(/Corrected amount/)).toBeVisible();
  await expect(page.getByText(/First amount/)).toHaveCount(0);

  await page.getByRole("button", { name: /Delete contribution/ }).click();
  await confirmDialog(page);
  await expect(page.getByText("No manual contributions yet.")).toBeVisible();
});

test("adds, persists, guards and removes a one-time budget adjustment", async ({
  page,
}) => {
  await completeOnboarding(page);
  await page.goto("/budget");
  await fillBudgetLimit(page);
  await page.getByRole("button", { name: "Create budget" }).click();
  await expect(page.getByText("of $1,000.00")).toBeVisible();

  await page.getByRole("button", { name: /^Adjust Everyday spending/ }).click();
  await fillAmount(page.getByLabel("Amount (USD)"), "250");
  await page.getByLabel("Note (optional)").fill("Birthday money");
  await expect(page.getByText(/\$1,000\.00 → \$1,250\.00/)).toBeVisible();
  await page.getByRole("button", { name: "Add funds" }).last().click();

  // The card reflects it immediately and after a reload.
  await expect(page).toHaveURL(/\/plan$/);
  await expect(page.getByText("of $1,250.00")).toBeVisible();
  await expect(page.getByText(/adjusted \+\$250\.00/)).toBeVisible();
  await page.reload();
  await expect(page.getByText("of $1,250.00")).toBeVisible();

  // A cut that would take the limit below zero is refused before it is saved.
  await page.getByRole("button", { name: /^Adjust Everyday spending/ }).click();
  await dismissKeypad(page);
  await page.getByRole("radio", { name: "Reduce budget" }).click();
  await fillAmount(page.getByLabel("Amount (USD)"), "2000");
  await expect(
    page.getByText("This would reduce the budget below zero."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reduce budget" }).last(),
  ).toBeDisabled();

  // A smaller one goes through, and the +$250 can then be removed from the sheet.
  await fillAmount(page.getByLabel("Amount (USD)"), "100");
  await page.getByRole("button", { name: "Reduce budget" }).last().click();
  await expect(page.getByText(/adjusted \+\$150\.00/)).toBeVisible();
  await page.getByRole("button", { name: /^Adjust Everyday spending/ }).click();
  await dismissKeypad(page);
  await page
    .getByRole("button", { name: "Delete adjustment +$250.00" })
    .click();
  await confirmDialog(page);
  await expect(page.getByText("Limit this period: $900.00")).toBeVisible();
});

test("shows every category cap and the actual recurring interval", async ({
  page,
}) => {
  await completeOnboarding(page);
  await page.goto("/budget");
  await fillBudgetLimit(page, "1000");
  for (const category of ["Groceries", "Dining", "Transport", "Home"]) {
    await page.getByRole("checkbox", { name: category }).click();
    await fillAmount(page.getByLabel(`${category} cap (optional)`), "100");
  }
  await page.getByRole("button", { name: "Create budget" }).click();
  for (const category of ["Groceries", "Dining", "Transport", "Home"]) {
    await expect(page.getByText(category, { exact: true })).toBeVisible();
  }

  await page.getByRole("link", { name: "More" }).click();
  await page.getByRole("button", { name: "New recurring" }).click();
  await page.getByLabel("Title").fill("Quarterly bill");
  await fillAmount(page.getByLabel("Amount (USD)"), "10");
  await page.getByRole("textbox", { name: "Every, required" }).fill("3");
  await page
    .getByRole("textbox", { name: "Starts, required" })
    .fill("2099-01-01");
  await page.getByRole("button", { name: "Create schedule" }).click();
  await expect(
    page.getByText(/Every 3 months\. · Next Jan 1, 2099/),
  ).toBeVisible();
});

test("uncategorizes, pauses, and resumes a recurring schedule", async ({
  page,
}) => {
  await completeOnboarding(page);
  await page.getByRole("link", { name: "More" }).click();
  await page.getByRole("button", { name: "New recurring" }).click();
  await page.getByLabel("Title").fill("Flexible schedule");
  await fillAmount(page.getByLabel("Amount (USD)"), "10");
  await page.getByRole("radio", { name: "Dining" }).click();
  await page
    .getByRole("textbox", { name: "Starts, required" })
    .fill("2099-01-01");
  await expect(
    page.getByRole("switch", { name: "Post automatically" }),
  ).toBeVisible();
  await expect(
    page.getByRole("switch", { name: "Schedule active" }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Create schedule" }).click();

  await page.getByRole("button", { name: /Flexible schedule/ }).click();
  const uncategorized = page.getByRole("radio", { name: "Uncategorized" });
  await uncategorized.click();
  await expect(uncategorized).toBeChecked();
  await page.getByRole("switch", { name: "Schedule active" }).click();
  await page.getByRole("button", { name: "Save schedule" }).click();
  await expect(
    page.getByRole("button", { name: /Flexible schedule.*Paused/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Flexible schedule/ }).click();
  await expect(
    page.getByRole("radio", { name: "Uncategorized" }),
  ).toBeChecked();
  await page.getByRole("switch", { name: "Schedule active" }).click();
  await page.getByRole("button", { name: "Save schedule" }).click();
  await expect(
    page.getByRole("button", { name: /Flexible schedule.*Next Jan 1, 2099/ }),
  ).toBeVisible();
});

test("selects a custom budget start date and labels progress controls", async ({
  page,
}) => {
  await completeOnboarding(page);
  await page.goto("/budget");
  await dismissKeypad(page);
  await page.getByRole("radio", { name: "Custom" }).click();
  await page.getByLabel("Start date").fill("2099-01-01");
  await page.getByLabel("End date").fill("2099-01-31");
  await fillBudgetLimit(page);
  await expect(page.getByRole("switch", { name: "Rollover" })).toBeVisible();
  await page.getByRole("button", { name: "Create budget" }).click();
  await expect(page.getByText(/Jan 1, 2099 to Jan 31, 2099/)).toBeVisible();
  await expect(
    page.getByRole("progressbar", {
      name: "Everyday spending: Budget progress",
    }),
  ).toBeVisible();

  await createDefaultGoal(page);
  await expect(
    page.getByRole("progressbar", { name: "Rainy day fund: Goal progress" }),
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
  await page.getByRole("button", { name: "Import 1 transactions" }).click();
  await confirmDialog(page);
  // Pressable does not await an async onPress handler. Wait for the preview to move out of its
  // pre-commit state before navigating, or WebKit can reload the ledger while the Dexie write is
  // still in flight.
  await expect(
    page.getByRole("button", { name: "Import 1 transactions" }),
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

test("keeps Plan creation actions inside their empty sections", async ({
  page,
}) => {
  await completeOnboarding(page);
  await page.getByRole("link", { name: "Plan" }).click();

  await expect(page.getByRole("heading", { name: "Budgets" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Goals" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New budget" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New goal" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Create a budget" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create a goal" }),
  ).toBeVisible();
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

test("can leave an invalid custom accent by returning to the default source", async ({
  page,
}) => {
  await completeOnboarding(page);
  await page.getByRole("link", { name: "More" }).click();
  await page.getByRole("button", { name: /Appearance/ }).click();
  await page.getByLabel("Custom accent").fill("#ZZ");
  await page
    .getByRole("radio", { name: /Qashy default|Material You wallpaper/ })
    .click();
  const save = page.getByRole("button", { name: "Save appearance" });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  await page.getByRole("radio", { name: "Dark" }).click();
  await page.getByRole("button", { name: "Save appearance" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
});

test("resets all local data and returns to onboarding", async ({ page }) => {
  await completeOnboarding(page);
  await page.getByRole("link", { name: "More" }).click();
  await page.getByRole("button", { name: "Reset all data" }).click();
  await confirmDialog(page);

  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByText("Money, made calmer.")).toBeVisible();
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

test("registers the service worker and starts offline", async ({
  page,
  context,
  browserName,
}) => {
  await page.goto("/");
  const scope = await page.evaluate(
    async () => (await navigator.serviceWorker.ready).scope,
  );
  expect(scope).toContain("4173");
  await page.reload();
  expect(
    await page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
  ).toBeTruthy();
  // Reloading an offline context aborts inside WebKit itself ("WebKit
  // encountered an internal error"), so the offline leg only runs on Chromium.
  // Registration and control above are still asserted on every browser.
  test.skip(
    browserName === "webkit",
    "Playwright/WebKit cannot reload an offline context.",
  );
  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText("Money, made calmer.")).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

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
  expect(chrome.themeColor).toBe("#F1F2F5");
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

// The policy's shape is asserted in `src/utils/__tests__/csp.test.ts`; that it does not break
// the app can only be asserted here, against the real export in a real browser. Both halves
// matter and neither substitutes for the other: a policy strict enough to be worth shipping is
// exactly one strict enough to white-screen the app, and the failure is silent in every check
// that does not load a page.
test("runs the exported app under its content security policy without a violation", async ({
  page,
}) => {
  const violations: string[] = [];
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { __csp: string[] }).__csp.push(
        `${event.effectiveDirective} blocked ${event.blockedURI} ${event.sample ?? ""}`.trim(),
      );
    });
  });

  const collect = async () => {
    violations.push(
      ...(await page.evaluate(
        () => (window as unknown as { __csp: string[] }).__csp,
      )),
    );
  };

  await completeOnboarding(page);
  await collect();

  // The pages that carry the crypto. `/sync-pair` in particular pulls in the camera, the QR
  // renderer, and the wordlist — the three things most likely to want something the policy
  // does not grant.
  for (const path of [
    "/more",
    "/sync",
    "/sync-pair",
    "/sync-recovery",
    "/sync-merge",
  ]) {
    await page.goto(path);
    await collect();
  }

  expect(violations).toEqual([]);

  // A policy that was never applied also produces no violations, so prove it is actually there
  // and that it is the strict one rather than something a build step relaxed.
  const policy = await page.getAttribute(
    'meta[http-equiv="Content-Security-Policy"]',
    "content",
  );
  expect(policy).toContain("default-src 'none'");
  expect(policy).toContain("object-src 'none'");
  expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
  // The hash has to be quoted to be a hash. Unquoted it parses as a host source and is dropped,
  // which blocks Expo Router's hydration script and shows up only as a violation on this page —
  // so pin the emitted form here too rather than relying on the count above staying at zero.
  expect(policy).toMatch(/script-src 'self' 'sha256-[A-Za-z0-9+/]+=*'/);

  // And that the app is genuinely running, not a blank page that violated nothing.
  await page.goto("/overview");
  await expect(page.getByText("Net worth", { exact: true })).toBeVisible();
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

// --- Automatic exchange rates (Frankfurter) -------------------------------------------------
//
// These onboard with EUR as the base currency (rather than the default USD) so a USD account is
// genuinely foreign and needs a rate. `https://api.frankfurter.dev/**` is always intercepted:
// never left to hit the real network, and always counted, so "zero requests while the toggle is
// off" is an assertion about the running app, not an assumption about the mock.

/** Onboards with `currency` as the base currency instead of the default USD. */
async function completeOnboardingWithCurrency(page: Page, currency: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByRole("radio", { name: currency, exact: true }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await fillAmount(page.getByLabel(`Opening balance (${currency})`), "1000");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Start using Qashy" }).click();
  await expect(page).toHaveURL(/\/overview$/);
}

/** Creates an account of `currency` from More → Accounts → Add, and returns to `/more`. */
async function createAccount(page: Page, name: string, currency: string) {
  await page.getByRole("link", { name: "More" }).click();
  await page.getByRole("button", { name: "Add", exact: true }).first().click();
  await page.getByLabel("Account name").fill(name);
  // Currency is a searchable picker, not a text field: open it, narrow by code, choose the match.
  await page.getByLabel("Currency", { exact: true }).click();
  await page.getByLabel("Search currency").fill(currency);
  await page
    .getByRole("radio", { name: new RegExp(currency) })
    .first()
    .click();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/more$/);
}

/** Today's local date as `YYYY-MM-DD`, matching `todayLocal()` in `src/utils/date.ts`. */
function todayKey(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

test("never contacts frankfurter.dev once automatic rates are turned off", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route("https://api.frankfurter.dev/**", async (route) => {
    requests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });

  await completeOnboardingWithCurrency(page, "EUR");
  // Automatic rates are on by default; this test is about the opted-out state.
  await page.getByRole("link", { name: "More" }).click();
  await page.getByRole("button", { name: /Exchange rates/ }).click();
  await page.getByRole("switch", { name: "Fetch rates automatically" }).click();
  await expect(
    page.getByRole("switch", { name: "Fetch rates automatically" }),
  ).not.toBeChecked();
  await page.goBack();
  await createAccount(page, "Card", "USD");

  // The floating "Add transaction" action lives on Overview/Transactions, not on More, where
  // `createAccount` leaves the page.
  await page.getByRole("link", { name: "Overview" }).click();
  // Opening the form for a genuinely foreign account is exactly the moment `ensureRatesFor`
  // would fire if the flag were on.
  await page.getByLabel("Add transaction").first().click();
  await dismissKeypad(page);
  await page.getByRole("radio", { name: "Card · USD" }).click();
  await expect(page.getByText("No rate for this date.")).toBeVisible();

  // Background/foreground the page. `FinanceProvider` reconciles on `visibilitychange`,
  // `focus`, and `pageshow`, and each reconcile races a capped `refreshRatesWithCap()` — the one
  // path that could reach the network without the user touching anything.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("pageshow"));
  });
  await page.waitForTimeout(800);

  expect(requests).toEqual([]);
});

test("fetches automatic rates by default and applies them to a transaction", async ({
  page,
}) => {
  const today = todayKey();
  const requests: string[] = [];
  await page.route("https://api.frankfurter.dev/**", async (route) => {
    requests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { date: today, base: "EUR", quote: "USD", rate: 1.25 },
      ]),
    });
  });

  await completeOnboardingWithCurrency(page, "EUR");
  await createAccount(page, "Card", "USD");

  // Automatic rates are on by default: picking the foreign account is enough to fetch its rate.
  await page.getByRole("link", { name: "Overview" }).click();
  await page.getByLabel("Add transaction").first().click();
  await dismissKeypad(page);
  await page.getByRole("radio", { name: "Card · USD" }).click();

  await expect.poll(() => requests.length).toBeGreaterThan(0);
  const firstRequest = new URL(requests[0]!);
  expect(firstRequest.searchParams.get("base")).toBe("EUR");
  const allowedParams = new Set(["base", "quotes", "date", "from", "to"]);
  for (const key of firstRequest.searchParams.keys()) {
    expect(allowedParams.has(key)).toBe(true);
  }
  // 1 EUR = 1.25 USD, EUR is the base, so 1 USD = 1 / 1.25 = 0.8 EUR.
  await expect(page.getByText(/1 USD = 0\.8 EUR.*Automatic/)).toBeVisible();

  await fillAmount(page.getByLabel("Amount (USD)"), "25");
  await page.getByLabel("Title").fill("Coffee in USD");
  await page.getByRole("button", { name: "Add transaction" }).click();
  await expect(page).toHaveURL(/\/overview$/, { timeout: 15_000 });
  // The ledger shows the transaction in its own account currency (USD); it does not additionally
  // surface a base-converted amount per row, so there is nothing further to assert about that.
  await expect(page.getByText("Coffee in USD")).toBeVisible();
});

test("looks up the rate on the spot in the recurring form", async ({
  page,
}) => {
  const today = todayKey();
  await page.route("https://api.frankfurter.dev/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { date: today, base: "EUR", quote: "USD", rate: 1.25 },
      ]),
    });
  });

  await completeOnboardingWithCurrency(page, "EUR");
  await page.getByRole("link", { name: "More" }).click();
  await page.getByRole("button", { name: "New recurring" }).click();
  await page.getByRole("switch", { name: "Paid in another currency" }).click();
  await page.getByRole("button", { name: "Foreign currency" }).click();
  await page.getByLabel("Search foreign currency").fill("USD");
  await page.getByRole("radio", { name: /USD/ }).first().click();

  // 1 EUR = 1.25 USD, so 1 USD = 0.8 EUR — with no manual rate and nothing turned on by hand.
  await expect(page.getByText(/1 USD = 0\.8 EUR.*Automatic/)).toBeVisible();
});

test("shows a clear error when frankfurter fails, and the rest of the app keeps working", async ({
  page,
}) => {
  await page.route("https://api.frankfurter.dev/**", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: '{"error":"boom"}',
    }),
  );

  await completeOnboardingWithCurrency(page, "EUR");
  // A foreign-currency account is required for any rate lookup to be attempted at all — a
  // vault with only base-currency accounts has nothing to fetch and never calls the network.
  await createAccount(page, "Card", "USD");

  await page.getByRole("link", { name: "More" }).click();
  await page.getByRole("button", { name: /Exchange rates/ }).click();

  await expect(page.getByRole("alert")).toContainText(
    "frankfurter.dev returned an error.",
  );

  // The rest of the app still works: a base-currency transaction needs no rate and saves fine.
  await page.goBack();
  await page.getByRole("link", { name: "Overview" }).click();
  await page.getByLabel("Add transaction").first().click();
  await fillAmount(page.getByLabel("Amount (EUR)"), "5");
  await page.getByLabel("Title").fill("Still works");
  await page.getByRole("button", { name: "Add transaction" }).click();
  await expect(page).toHaveURL(/\/overview$/, { timeout: 15_000 });
  await expect(page.getByText("Still works")).toBeVisible();
});

test("removes and re-adds an Overview card, and the layout survives a reload", async ({
  page,
}) => {
  await completeOnboarding(page);

  await page.getByRole("button", { name: "Customize" }).click();
  await page.getByRole("button", { name: "Remove Recent activity" }).click();
  await page.getByRole("button", { name: "Done" }).click();

  await expect(
    page.getByRole("heading", { name: "Recent activity" }),
  ).toHaveCount(0);
  // The rest of the default layout is untouched by removing one card.
  await expect(
    page.getByRole("heading", { name: "Budget pulse" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Coming up" })).toBeVisible();

  // The device-local layout preference persists like any other `sync_meta` value, so a reload
  // must not resurrect the removed card.
  await page.reload();
  await expect(page).toHaveURL(/\/overview$/);
  await expect(
    page.getByRole("heading", { name: "Recent activity" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Customize" }).click();
  await page.getByRole("button", { name: "Add card" }).click();
  await expect(page).toHaveURL(/\/overview-cards$/);
  await page.getByRole("button", { name: "Add Recent activity card" }).click();

  await expect(page).toHaveURL(/\/overview$/);
  await expect(
    page.getByRole("heading", { name: "Recent activity" }),
  ).toBeVisible();
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
