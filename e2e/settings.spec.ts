import { expect, test } from "@playwright/test";
import { confirmDialog, completeOnboarding } from "./helpers";

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
