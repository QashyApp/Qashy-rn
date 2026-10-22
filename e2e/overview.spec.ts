import { expect, test } from "@playwright/test";
import { completeOnboarding } from "./helpers";

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
