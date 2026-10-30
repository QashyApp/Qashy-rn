import { expect, test } from "@playwright/test";
import { fillAmount, completeOnboarding } from "./helpers";

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
  // The quick-pick tile behind the dialog is a "שקלים חדשים, ILS" radio too; scope to the list.
  await page
    .getByRole("radiogroup", { name: "בחירת מטבע בסיס" })
    .getByRole("radio", { name: /שקל/ })
    .click();
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
    page.getByText(
      "כבוי: פריטים שהגיע מועדם ממתינים לבדיקה שלכם. פעיל: הם נרשמים מעצמם במועדם, כולל כאלה שמועדם כבר עבר.",
    ),
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
