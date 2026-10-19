import type { Budget } from "@/domain/models";
import {
  languageFromLocale,
  translateMessage,
} from "@/localization/localization";
import { ONE_WITH_PLURAL } from "@/localization/messages/he";
import { accountDeletionMessage } from "@/utils/account-impact";
import { categoryDeletionMessage } from "@/utils/category-impact";

describe("localization", () => {
  it("maps supported locale tags to their interface language", () => {
    expect(languageFromLocale("he-IL")).toBe("he");
    expect(languageFromLocale("en-US")).toBe("en");
    expect(languageFromLocale("fr-FR")).toBe("en");
  });

  it("translates interface copy and preserves dynamic currency codes", () => {
    expect(translateMessage("Base currency", "he")).toBe("מטבע בסיס");
    expect(translateMessage("Opening balance (ILS)", "he")).toBe(
      "יתרת פתיחה (ILS)",
    );
    expect(translateMessage("  Continue ", "he")).toBe("  המשך ");
    expect(translateMessage("Create goal", "he")).toBe("יצירת יעד");
    expect(translateMessage("Every 2 months.", "he")).toBe("כל חודשיים");
    expect(translateMessage("75% remains in this period.", "he")).toBe(
      "75% נותרו בתקופה הזו.",
    );
    expect(translateMessage("Amount is required.", "he")).toBe(
      "יש למלא את השדה סכום.",
    );
    expect(translateMessage("Enter a valid contribution.", "he")).toBe(
      "הזינו הפקדה תקינה.",
    );
    expect(
      translateMessage("Use a real target date in YYYY-MM-DD format.", "he"),
    ).toBe("השתמשו בתאריך יעד אמיתי בתבנית YYYY-MM-DD.");
    expect(
      translateMessage(
        "Missing exchange rate for EUR → ILS on 2026-07-01.",
        "he",
      ),
    ).toBe("חסר שער חליפין מ־EUR ל־ILS בתאריך 2026-07-01.");
    expect(translateMessage("Delete Rainy day fund?", "he")).toBe(
      "למחוק את Rainy day fund?",
    );
    expect(translateMessage("Row 3: Unknown category: Old", "he")).toBe(
      "שורה 3: קטגוריה לא מוכרת: Old",
    );
    expect(translateMessage("Transaction kind", "he")).toBe("סוג תנועה");
    expect(translateMessage("Expense, money out", "he")).toBe("הוצאה, כסף יצא");
    expect(translateMessage("Budget progress", "he")).toBe("התקדמות התקציב");
  });

  it("translates the one-time budget adjustment copy", () => {
    expect(translateMessage("Adjust budget", "he")).toBe("התאמת תקציב");
    expect(translateMessage("Add funds", "he")).toBe("הוספת כסף");
    expect(translateMessage("Delete this adjustment?", "he")).toBe(
      "למחוק את ההתאמה הזו?",
    );
    expect(translateMessage("Delete adjustment +$100.00", "he")).toBe(
      "מחיקת התאמה +$100.00",
    );
    expect(
      translateMessage(
        "+$100.00 will be removed from this period’s limit.",
        "he",
      ),
    ).toBe("+$100.00 יוסר מהמגבלה של התקופה הזו.");
  });

  it("translates the theme picker title, helper text, and every built-in theme name and description", () => {
    for (const message of [
      "Theme",
      "Choose the overall look. Every theme has a light and a dark version.",
      "This theme sets its own accent color.",
      "Classic",
      "High contrast",
      "Lilac-tinted surfaces, soft depth and lively controls.",
      "Rounded Material surfaces that follow your Android system colors.",
      "Maximum contrast and bold edges for easy reading.",
    ]) {
      expect(translateMessage(message, "he")).not.toBe(message);
      expect(translateMessage(message, "en")).toBe(message);
    }
    expect(translateMessage("Classic", "he")).toBe("קלאסי");
  });

  it("translates the custom theme import, export and delete copy", () => {
    for (const message of [
      "Custom themes",
      "Import theme",
      "Export theme",
      "Delete theme",
      "Delete this theme?",
      "Replace this theme?",
      "Replace",
      "Theme imported.",
      "Couldn’t import theme",
      "At most 8 custom themes can be stored; delete one first.",
      "This file is too large to be a theme.",
    ]) {
      expect(translateMessage(message, "he")).not.toBe(message);
      expect(translateMessage(message, "en")).toBe(message);
    }
  });

  it("leaves unknown copy and English unchanged", () => {
    expect(translateMessage("Custom account name", "he")).toBe(
      "Custom account name",
    );
    expect(translateMessage("Base currency", "en")).toBe("Base currency");
  });

  it("translates the redesign-era additions to the Hebrew dictionary", () => {
    expect(translateMessage("Clear filters", "he")).toBe("ניקוי הסינון");
    expect(translateMessage("Under pace", "he")).toBe("מתחת לקצב");
    expect(translateMessage("Over budget", "he")).toBe("חריגה מהתקציב");
    expect(translateMessage("Projected", "he")).toBe("צפי");
    expect(translateMessage("remaining", "he")).toBe("נותרו");
    expect(translateMessage("Pairing progress", "he")).toBe("התקדמות החיבור");
    expect(translateMessage("Advanced", "he")).toBe("מתקדם");
    expect(translateMessage("Preview · Net worth", "he")).toBe(
      "תצוגה מקדימה · שווי נקי",
    );
    expect(translateMessage("Choose file", "he")).toBe("בחירת קובץ");
    expect(translateMessage("Import", "he")).toBe("ייבוא");
    // Same "label (currency)" dynamic pattern as "Opening balance (ILS)", exercised through
    // a different fixed label to confirm the pattern isn't matching on that label alone.
    expect(translateMessage("Amount (ILS)", "he")).toBe("סכום (ILS)");
  });

  it("translates the language setting copy", () => {
    expect(translateMessage("Language", "he")).toBe("שפה");
    expect(translateMessage("System default", "he")).toBe(
      "ברירת המחדל של המערכת",
    );
    expect(
      translateMessage(
        "Qashy follows your device’s language by default. Choose another one for this device only.",
        "he",
      ),
    ).toBe(
      "Qashy עוקב אחר שפת המכשיר כברירת מחדל. אפשר לבחור שפה אחרת למכשיר הזה בלבד.",
    );
  });

  it("reads Hebrew for iw, the legacy Android code", () => {
    expect(languageFromLocale("iw-IL")).toBe("he");
  });

  it('reads a count of one as a singular, not as "1 transactions"', () => {
    expect(translateMessage("Import 1 transaction", "he")).toBe(
      "ייבוא תנועה אחת",
    );
    expect(translateMessage("Import 3 transactions", "he")).toBe(
      "ייבוא 3 תנועות",
    );
    expect(translateMessage("1 transaction imported.", "he")).toBe(
      "יובאה תנועה אחת.",
    );
    expect(translateMessage("3 transactions imported.", "he")).toBe(
      "יובאו 3 תנועות.",
    );
    expect(translateMessage("+1 more rejected row", "he")).toBe(
      "ועוד שורה אחת שנדחתה",
    );
    expect(translateMessage("+4 more rejected rows", "he")).toBe(
      "ועוד 4 שורות שנדחו",
    );
  });

  it("translates the fee caption as one phrase", () => {
    expect(translateMessage("incl. $2.00 fee", "he")).toBe(
      "כולל עמלה של $2.00",
    );
  });

  it("translates the donut chart summary, with its percentages", () => {
    expect(
      translateMessage(
        "Spending by category. Total $1,234.50. 1. Food, 60 percent. 2. Rent, 1 percent.",
        "he",
      ),
    ).toBe(
      "הוצאות לפי קטגוריה. סך הכול $1,234.50. 1. Food, 60 אחוזים. 2. Rent, אחוז אחד.",
    );
    expect(
      translateMessage("Spending by category. No spending yet.", "he"),
    ).toBe("הוצאות לפי קטגוריה. אין הוצאות עדיין.");
  });

  it("agrees count and noun for one and for many", () => {
    const he = (message: string) => translateMessage(message, "he");
    // Ones read as a noun, never "1 plurals".
    expect(he("Skipped 1 unreadable row")).toBe(
      "דולגה שורה אחת שלא ניתן לקרוא",
    );
    expect(he("Skipped 3 unreadable rows")).toBe(
      "דולגו 3 שורות שלא ניתן לקרוא",
    );
    expect(
      he("The rest of the file was read. Check line 3 for stray quotes."),
    ).toBe("שאר הקובץ נקרא. בדקו בשורה 3 אם יש מירכאות מיותרות.");
    expect(
      he("The rest of the file was read. Check lines 3, 5 for stray quotes."),
    ).toBe("שאר הקובץ נקרא. בדקו בשורות 3, 5 אם יש מירכאות מיותרות.");
    expect(he("1 choice available")).toBe("אפשרות אחת זמינה");
    expect(he("4 choices available")).toBe("4 אפשרויות זמינות");
    expect(he("1 selected")).toBe("פריט אחד נבחר");
    expect(he("3 selected")).toBe("3 נבחרו");
    // Every N: the dual for two, the plural above.
    expect(he("Every 2 days.")).toBe("כל יומיים");
    expect(he("Every 2 weeks.")).toBe("כל שבועיים");
    expect(he("Every 2 months.")).toBe("כל חודשיים");
    expect(he("Every 2 years.")).toBe("כל שנתיים");
    expect(he("Every 3 days.")).toBe("כל 3 ימים");
    expect(he("Every 5 weeks.")).toBe("כל 5 שבועות");
    expect(he("Every 12 months.")).toBe("כל 12 חודשים");
    expect(he("Every 4 years.")).toBe("כל 4 שנים");
  });

  it("translates batch deletion of budgets, goals, accounts and categories", () => {
    const he = (message: string) => translateMessage(message, "he");
    expect(he("Delete 1 budget?")).toBe("למחוק תקציב אחד?");
    expect(he("Delete 2 budgets?")).toBe("למחוק 2 תקציבים?");
    expect(he("Delete 2 goals?")).toBe("למחוק 2 יעדים?");
    expect(he("Delete 3 accounts?")).toBe("למחוק 3 חשבונות?");
    expect(he("Delete 3 categories?")).toBe("למחוק 3 קטגוריות?");
    expect(he("Couldn’t delete budgets")).toBe("לא ניתן למחוק תקציבים");
    expect(he("Couldn’t delete goals")).toBe("לא ניתן למחוק יעדים");
  });

  it("reads the keypad's plus key as the existing word, not as adding an item", () => {
    expect(translateMessage("plus", "he")).toBe("פלוס");
    expect(translateMessage("Add", "he")).toBe("הוספה");
  });

  it("agrees a validation message with the gender of its field", () => {
    const he = (message: string) => translateMessage(message, "he");
    // Feminine nouns take a feminine predicate and adjective.
    expect(he("Fee must be greater than zero.")).toBe(
      "עמלה חייבת להיות גדולה מאפס.",
    );
    expect(he("Contribution must be greater than zero.")).toBe(
      "הפקדה חייבת להיות גדולה מאפס.",
    );
    expect(he("Fee cannot be negative.")).toBe("עמלה אינה יכולה להיות שלילית.");
    expect(he("Starting progress cannot be negative.")).toBe(
      "התקדמות התחלתית אינה יכולה להיות שלילית.",
    );
    expect(he("Enter a valid fee.")).toBe("הזינו עמלה תקינה.");
    expect(he("Enter a valid opening balance.")).toBe(
      "הזינו יתרת פתיחה תקינה.",
    );
    expect(he("Enter a valid category cap.")).toBe(
      "הזינו מגבלת קטגוריה תקינה.",
    );
    expect(he("Budget period is invalid.")).toBe("תקופת התקציב אינה תקינה.");
    expect(he("Budget period limit must be positive.")).toBe(
      "מגבלת תקופת התקציב חייבת להיות חיובית.",
    );
    // Masculine nouns keep the masculine forms.
    expect(he("Amount must be greater than zero.")).toBe(
      "סכום חייב להיות גדול מאפס.",
    );
    expect(he("Amount cannot be negative.")).toBe(
      "סכום אינו יכול להיות שלילי.",
    );
    expect(he("Enter a valid exchange rate.")).toBe("הזינו שער חליפין תקין.");
    expect(he("Number of times must be a whole number.")).toBe(
      "מספר פעמים חייב להיות מספר שלם.",
    );
    expect(he("Account type is invalid.")).toBe("סוג חשבון אינו תקין.");
  });

  it("never leaves a field label of a validation message in English", () => {
    const labels = [
      "Amount",
      "Fee",
      "Contribution",
      "Target",
      "Opening balance",
      "Category cap",
      "Total limit",
      "Starting progress",
      "Destination amount",
      "Exchange rate",
      "Number of times",
      "Repeat interval",
      "Account balance",
      "Budget limit total",
      "Category limit",
      "Goal target",
      "Net flow",
      "Income total",
      "Expense total",
      "Converted amount",
      "Recurring amount",
      "Destination base amount",
    ];
    const shapes = [
      "{} is required.",
      "{} must be greater than zero.",
      "{} cannot be negative.",
      "{} must be a positive whole number.",
      "{} must be a whole number.",
      "{} is outside the supported range.",
      "{} can have at most 2 decimal places.",
    ];
    for (const label of labels) {
      for (const shape of shapes) {
        const message = shape.replace("{}", label);
        expect([
          message,
          /[A-Za-z]/.test(translateMessage(message, "he")),
        ]).toEqual([message, false]);
      }
      expect(
        /[A-Za-z]/.test(
          translateMessage(`Enter a valid ${label.toLowerCase()}.`, "he"),
        ),
      ).toBe(false);
    }
    // Entity labels of "Could not find the ... to update." and "Choose valid ... values."
    for (const entity of [
      "account",
      "budget",
      "category",
      "goal",
      "tag",
      "contribution",
      "recurring rule",
      "exchange rate",
      "transaction",
      "expense category",
    ]) {
      expect(
        /[A-Za-z]/.test(
          translateMessage(`Could not find the ${entity} to update.`, "he"),
        ),
      ).toBe(false);
    }
  });

  it("words the decimal places of a currency with none, one, two and three", () => {
    const he = (digits: number) =>
      translateMessage(
        `Amount can have at most ${digits} decimal places.`,
        "he",
      );
    expect(he(0)).toBe("לסכום אסור שיהיו ספרות אחרי הנקודה.");
    expect(he(1)).toBe("לסכום יכולה להיות לכל היותר ספרה אחת אחרי הנקודה.");
    expect(he(2)).toBe("לסכום יכולות להיות לכל היותר 2 ספרות אחרי הנקודה.");
    expect(he(3)).toBe("לסכום יכולות להיות לכל היותר 3 ספרות אחרי הנקודה.");
  });

  it("translates the required fields of the CSV mapping, one label at a time", () => {
    const he = (message: string) => translateMessage(message, "he");
    expect(he("Map required fields: Date, Amount.")).toBe(
      "מפו את שדות החובה: תאריך, סכום.",
    );
    expect(he("Map required fields: Account.")).toBe(
      "מפו את שדות החובה: חשבון.",
    );
    // The broader `Map ...` pattern still handles a single field.
    expect(he("Map date")).toBe("מיפוי תאריך");
  });

  it("counts the seconds of the pairing countdown for 0, 1, 2, 3 and 11", () => {
    const he = (message: string) => translateMessage(message, "he");
    expect(he("1 second left")).toBe("נותרה שנייה אחת");
    expect(he("0 seconds left")).toBe("נותרו 0 שניות");
    expect(he("2 seconds left")).toBe("נותרו שתי שניות");
    expect(he("3 seconds left")).toBe("נותרו 3 שניות");
    expect(he("11 seconds left")).toBe("נותרו 11 שניות");
  });

  it("agrees the counts of an import result for 0, 1, 2, 3 and 11", () => {
    const he = (message: string) => translateMessage(message, "he");
    const nouns: [string, string, string, string][] = [
      ["account", "accounts", "חשבון אחד", "חשבונות"],
      ["category", "categories", "קטגוריה אחת", "קטגוריות"],
      ["tag", "tags", "תגית אחת", "תגיות"],
      ["transaction", "transactions", "תנועה אחת", "תנועות"],
      [
        "recurring schedule",
        "recurring schedules",
        "תזמון חוזר אחד",
        "תזמונים חוזרים",
      ],
      ["budget", "budgets", "תקציב אחד", "תקציבים"],
      ["goal", "goals", "יעד אחד", "יעדים"],
    ];
    for (const [singular, plural, one, many] of nouns) {
      expect(he(`1 ${singular}`)).toBe(one);
      for (const count of [0, 2, 3, 11]) {
        expect(he(`${count} ${plural}`)).toBe(`${count} ${many}`);
      }
    }
    expect(
      he(
        "Import blocked: 1 item(s) could not be imported, so nothing was imported.",
      ),
    ).toBe("הייבוא נחסם: לא ניתן היה לייבא פריט אחד, ולכן שום דבר לא יובא.");
    for (const count of [2, 3, 11]) {
      expect(
        he(
          `Import blocked: ${count} item(s) could not be imported, so nothing was imported.`,
        ),
      ).toBe(
        `הייבוא נחסם: לא ניתן היה לייבא ${count} פריטים, ולכן שום דבר לא יובא.`,
      );
    }
  });

  it("translates the Cashew import sentences, warnings and file errors", () => {
    const he = (message: string) => translateMessage(message, "he");
    expect(he("Cashew backup")).toBe("גיבוי Cashew");
    expect(he("Choose Cashew backup file")).toBe("בחירת קובץ גיבוי Cashew");
    expect(
      he(
        "This file does not look like a Cashew backup. Choose a Cashew backup file.",
      ),
    ).toBe("הקובץ הזה אינו נראה כגיבוי של Cashew. בחרו קובץ גיבוי Cashew.");
    expect(he("Transactions with a zero amount were not imported.")).toBe(
      "תנועות עם סכום אפס לא יובאו.",
    );
    expect(he("This SQLite file does not look like a Cashew backup.")).toBe(
      "קובץ ה־SQLite הזה אינו נראה כגיבוי של Cashew.",
    );
    expect(
      he(
        "This SQLite file looks damaged or incomplete (page 12 does not exist).",
      ),
    ).toBe("קובץ ה־SQLite הזה נראה פגום או חלקי (עמוד 12 אינו קיים).");
    expect(he("This SQLite file looks damaged or incomplete (no pages).")).toBe(
      "קובץ ה־SQLite הזה נראה פגום או חלקי (אין עמודים).",
    );
    expect(he("The backup lists this category more than once.")).toBe(
      "הקטגוריה הזו מופיעה בגיבוי יותר מפעם אחת.",
    );
    expect(he("The backup lists this budget more than once.")).toBe(
      "התקציב הזה מופיע בגיבוי יותר מפעם אחת.",
    );
    expect(he("Backup file is larger than the 64 MiB safety limit.")).toBe(
      "קובץ הגיבוי גדול ממגבלת הבטיחות של 64 MiB.",
    );
  });

  it("translates the category deletion message with the budgets it leaves unfiltered", () => {
    const he = (message: string) => translateMessage(message, "he");
    expect(
      he(
        "Transactions in these categories become uncategorized, and the categories are removed from budgets and goals.",
      ),
    ).toBe(
      "התנועות בקטגוריות האלה יהפכו ללא קטגוריה, והקטגוריות יוסרו מהתקציבים והיעדים.",
    );
    expect(he("The budget “Food” would then cover all your spending.")).toBe(
      "התקציב “Food” יכסה אז את כל ההוצאות שלכם.",
    );
    expect(
      he("These budgets “Food”, “Fun” would then cover all your spending."),
    ).toBe("התקציבים “Food”, “Fun” יכסו אז את כל ההוצאות שלכם.");
  });

  it("translates every line of the account deletion dialog, with counts and names", () => {
    const he = (message: string) => translateMessage(message, "he");
    const budget = (name: string): Budget =>
      ({
        name,
        deletedAt: null,
        archived: false,
        filters: { categoryIds: [], accountIds: ["a1"], tagIds: [] },
      }) as unknown as Budget;
    const lines = accountDeletionMessage(
      {
        accounts: [
          { id: "a1", name: "Old", deletedAt: null },
          { id: "a2", name: 'Cash "main"', deletedAt: null },
        ],
        transactions: [
          {
            id: "t1",
            kind: "transfer",
            status: "posted",
            accountId: "a1",
            destinationAccountId: "a2",
            recurringRuleId: null,
            deletedAt: null,
          },
          {
            id: "t2",
            kind: "expense",
            status: "posted",
            accountId: "a1",
            destinationAccountId: null,
            recurringRuleId: null,
            deletedAt: null,
          },
          {
            id: "t3",
            kind: "expense",
            status: "posted",
            accountId: "a1",
            destinationAccountId: null,
            recurringRuleId: null,
            deletedAt: null,
          },
        ],
        recurringRules: [
          { id: "r1", template: { accountId: "a1" }, deletedAt: null },
          { id: "r2", template: { accountId: "a1" }, deletedAt: null },
        ],
        budgets: [budget("Food")],
        goals: [],
      } as unknown as Parameters<typeof accountDeletionMessage>[0],
      ["a1"],
    );
    for (const line of lines) {
      const hebrew = he(line);
      expect(hebrew).not.toBe(line);
      // Only the account and budget names stay as typed.
      expect(
        hebrew.replace(/“[^”]*”/g, "").replace(/Cash "main" \(\d+\)/g, ""),
      ).not.toMatch(/[A-Za-z]/);
    }
    expect(he("Deletes 1 transaction.")).toBe("מוחק תנועה אחת.");
    expect(he("Deletes 2 recurring schedules.")).toBe("מוחק 2 תזמונים חוזרים.");
  });

  it("translates the undo bar and search defaults", () => {
    expect(translateMessage("Undo", "he")).toBe("ביטול הפעולה");
    expect(translateMessage("Search", "he")).toBe("חיפוש");
  });

  it("translates every message the category deletion dialog can build", () => {
    const budget = (name: string): Budget =>
      ({
        name,
        deletedAt: null,
        archived: false,
        filters: { categoryIds: ["c1"], accountIds: [], tagIds: [] },
      }) as unknown as Budget;
    for (const [ids, budgets] of [
      [["c1"], []],
      [["c1", "c2"], []],
      [["c1"], [budget("Food")]],
      [["c1", "c2"], [budget("Food")]],
      [["c1"], [budget("Food"), budget("Fun")]],
      [
        ["c1", "c2"],
        [budget("Food"), budget("Fun")],
      ],
    ] as [string[], Budget[]][]) {
      // Each line is translated on its own, as the confirmation dialog does.
      for (const message of categoryDeletionMessage(budgets, ids)) {
        const hebrew = translateMessage(message, "he");
        expect(hebrew).not.toBe(message);
        // Only the quoted budget names stay as typed.
        expect(hebrew.replace(/“[^”]*”/g, "")).not.toMatch(/[A-Za-z]/);
      }
    }
  });

  it("reads a count of one as a singular for every counted noun, even spelled plural", () => {
    const he = (message: string) => translateMessage(message, "he");
    for (const [plural, singular] of Object.entries(ONE_WITH_PLURAL)) {
      const expected = he(singular);
      // The singular has its own Hebrew, and the plural spelling reads the same.
      expect([singular, expected === singular]).toEqual([singular, false]);
      expect([plural, he(plural)]).toEqual([plural, expected]);
      expect(expected).not.toMatch(/(^|\D)1 /);
    }
  });

  it("counts 0, 1, 2, 3 and 11 of each noun the app lists", () => {
    const he = (message: string) => translateMessage(message, "he");
    const rows: [(count: number) => string, string, string, string][] = [
      [
        (n) => `${n} ${n === 1 ? "transaction" : "transactions"}`,
        "תנועה אחת",
        "תנועות",
        "תנועות",
      ],
      [
        (n) => `Edit ${n} ${n === 1 ? "transaction" : "transactions"}`,
        "עריכת תנועה אחת",
        "עריכת",
        "תנועות",
      ],
      [
        (n) => `Delete ${n} ${n === 1 ? "account" : "accounts"}?`,
        "למחוק חשבון אחד?",
        "למחוק",
        "חשבונות",
      ],
      [
        (n) => `${n} ${n === 1 ? "minute" : "minutes"} ago`,
        "לפני דקה",
        "לפני",
        "דקות",
      ],
      [
        (n) => `${n} ${n === 1 ? "device" : "devices"}`,
        "מכשיר אחד",
        "",
        "מכשירים",
      ],
      [
        (n) => `Sent ${n} ${n === 1 ? "change" : "changes"}`,
        "נשלח שינוי אחד",
        "נשלחו",
        "שינויים",
      ],
      [
        (n) => `${n} ${n === 1 ? "second" : "seconds"} left`,
        "נותרה שנייה אחת",
        "נותרו",
        "שניות",
      ],
    ];
    for (const [make, one, prefix, noun] of rows) {
      expect(he(make(1))).toBe(one);
      for (const count of [0, 2, 3, 11]) {
        const out = he(make(count));
        expect(out).toContain(noun);
        expect(out).toContain(prefix);
        expect(out).not.toMatch(/[A-Za-z]/);
      }
    }
    // Two of a unit of time has its own word.
    expect(he("2 minutes ago")).toBe("לפני שתי דקות");
    expect(he("2 hours ago")).toBe("לפני שעתיים");
    expect(he("2 days ago")).toBe("לפני יומיים");
    expect(he("2 months ago")).toBe("לפני חודשיים");
    expect(he("2 seconds left")).toBe("נותרו שתי שניות");
    expect(he("3 days ago")).toBe("לפני 3 ימים");
    expect(he("11 hours ago")).toBe("לפני 11 שעות");
    expect(he("0 minutes ago")).toBe("לפני 0 דקות");
    // A single percent is singular.
    expect(he("1% remains in this period.")).toBe("1% נותר בתקופה הזו.");
    expect(he("0% remains in this period.")).toBe("0% נותרו בתקופה הזו.");
    expect(he("2% remains in this period.")).toBe("2% נותרו בתקופה הזו.");
    expect(he("11% remains in this period.")).toBe("11% נותרו בתקופה הזו.");
  });

  it("translates the sync, pairing, file and relay errors a screen can show", () => {
    const he = (message: string) => translateMessage(message, "he");
    for (const message of [
      "This device is offline.",
      "Sync could not complete.",
      "That is not a Qashy pairing code.",
      "That file is not a Qashy sync file.",
      "Only https:// addresses can be used here.",
      "Remove the username and password from the address.",
      "Could not reach the relay: connection refused",
      "The relay answered 503.",
      "That pairing code has expired. Generate a new one on the other device.",
      "Op 3's hash is missing.",
      "Roster member 2's signing key is not readable.",
      "That batch carries 12000 ops; the limit is 10000.",
    ]) {
      const hebrew = he(message);
      expect([message, hebrew === message]).toEqual([message, false]);
    }
    expect(he("This device is offline.")).toBe(
      "המכשיר הזה אינו מחובר לאינטרנט.",
    );
    expect(he("Op 3's hash is missing.")).toBe("ערך חסר: הגיבוב של פעולה 3.");
    // The relay's own detail is copied, and only the frame around it is translated.
    expect(he("Could not reach the relay: connection refused")).toBe(
      "לא ניתן היה להגיע לממסר: connection refused",
    );
  });

  it("translates custom theme file errors, contrast notes and the summary line", () => {
    const he = (message: string) => translateMessage(message, "he");
    expect(he("name: must be 1 to 40 characters")).toBe(
      "name: חייב להיות באורך של 1 עד 40 תווים",
    );
    expect(he("…and 3 more")).toBe("…ועוד 3");
    expect(
      he(
        "palette.light.primary changed from #FFFFFF to #EEEEEE to keep 4.5:1 contrast against palette.light.onPrimary",
      ),
    ).toBe(
      "palette.light.primary שונה מ־#FFFFFF ל־#EEEEEE כדי לשמור על ניגודיות 4.5:1 מול palette.light.onPrimary",
    );
    expect(
      he(
        "Invalid custom theme: name: must be 1 to 40 characters; $: must be a JSON object",
      ),
    ).toBe(
      "ערכת עיצוב מותאמת לא תקינה: name: חייב להיות באורך של 1 עד 40 תווים; $: חייב להיות אובייקט JSON",
    );
  });

  it("translates the CSV row failures, with the file's own words in brackets", () => {
    const he = (message: string) => translateMessage(message, "he");
    expect(he("Row 3: Invalid row")).toBe("שורה 3: שורה לא תקינה");
    expect(he("Fee kind must be percent or fixed.")).toBe(
      "סוג העמלה חייב להיות אחוז (percent) או קבוע (fixed).",
    );
    expect(he("Type must be one of: expense, income, transfer.")).toBe(
      "הסוג חייב להיות הוצאה (expense), הכנסה (income) או העברה (transfer).",
    );
  });
});
