import { expect, type Locator, type Page } from "@playwright/test";

/** Confirms the in-app dialog (replaces the browser confirm). Cancel renders first, confirm last. */
export async function confirmDialog(page: Page) {
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
/** The keypad group's accessible name, in English or Hebrew (the UI follows the chosen language). */
const KEYPAD_NAME = /^(Amount keypad|מקלדת סכומים)$/;
const BACKSPACE_NAME = /^(Delete last character|מחיקת התו האחרון)$/;
const DECIMAL_NAME = /^(Decimal separator|מפריד עשרוני)$/;

export async function fillAmount(field: Locator, value: string) {
  const page = field.page();
  const touch = await page.evaluate(
    () => window.matchMedia("(pointer: coarse)").matches,
  );
  if (!touch) {
    await field.fill(value);
    return;
  }
  const keypad = page.getByRole("group", { name: KEYPAD_NAME });
  // An autofocused field opens the keypad by itself, a little after the sheet settles.
  const opened = await keypad
    .waitFor({ state: "visible", timeout: 1_000 })
    .then(() => true)
    .catch(() => false);
  if (!opened) await field.click();
  await expect(keypad).toBeVisible();
  // The amount shown in the field may already hold text (an autofocused or prefilled field).
  const backspace = keypad.getByRole("button", {
    name: BACKSPACE_NAME,
  });
  for (let left = (await field.inputValue()).length; left > 0; left -= 1) {
    await backspace.click();
  }
  for (const character of value) {
    const key =
      character === "."
        ? keypad.getByRole("button", { name: DECIMAL_NAME })
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
export async function dismissKeypad(page: Page) {
  const touch = await page.evaluate(
    () => window.matchMedia("(pointer: coarse)").matches,
  );
  if (!touch) return;
  const keypad = page.getByRole("group", { name: KEYPAD_NAME });
  await expect(keypad).toBeVisible();
  // The top of the screen is always the dimmed part, never the keypad.
  await page.mouse.click(10, 10);
  await expect(keypad).toHaveCount(0);
}

export async function completeOnboarding(page: Page) {
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
export async function addExpense(page: Page, title: string, date?: string) {
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

/** Today's local date as `YYYY-MM-DD`, matching `todayLocal()` in `src/utils/date.ts`. */
export function todayKey(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
