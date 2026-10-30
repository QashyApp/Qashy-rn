import { expect, test, type Page } from "@playwright/test";
import { fillAmount, dismissKeypad, todayKey } from "./helpers";

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
  // The quick-pick tiles are named "Euro, EUR": the currency's name, then its code.
  await page
    .getByRole("radio", { name: new RegExp(`(^|, )${currency}$`) })
    .click();
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
