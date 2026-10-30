import { expect, test, type Page } from "@playwright/test";
import {
  confirmDialog,
  fillAmount,
  dismissKeypad,
  completeOnboarding,
} from "./helpers";

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
    page.getByText(/Every 3 months · Next Jan 1, 2099/),
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
