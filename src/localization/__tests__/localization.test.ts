import { languageFromLocale, translateMessage } from '@/localization/localization';

describe('localization', () => {
  it('maps supported locale tags to their interface language', () => {
    expect(languageFromLocale('he-IL')).toBe('he');
    expect(languageFromLocale('en-US')).toBe('en');
    expect(languageFromLocale('fr-FR')).toBe('en');
  });

  it('translates interface copy and preserves dynamic currency codes', () => {
    expect(translateMessage('Base currency', 'he')).toBe('מטבע בסיס');
    expect(translateMessage('Opening balance (ILS)', 'he')).toBe('יתרת פתיחה (ILS)');
    expect(translateMessage('  Continue ', 'he')).toBe('  המשך ');
    expect(translateMessage('Create goal', 'he')).toBe('יצירת יעד');
    expect(translateMessage('Every 2 months.', 'he')).toBe('כל 2 חודש');
    expect(translateMessage('75% remains in this period.', 'he')).toBe('75% נותרו בתקופה הזו.');
    expect(translateMessage('Amount is required.', 'he')).toBe('יש למלא את השדה סכום.');
    expect(translateMessage('Enter a valid contribution.', 'he')).toBe('הזינו הפקדה תקין.');
    expect(translateMessage('Use a real target date in YYYY-MM-DD format.', 'he')).toBe('השתמשו בתאריך יעד אמיתי בתבנית YYYY-MM-DD.');
    expect(translateMessage('Missing exchange rate for EUR → ILS on 2026-07-01.', 'he')).toBe('חסר שער חליפין מ־EUR ל־ILS בתאריך 2026-07-01.');
    expect(translateMessage('Delete Rainy day fund?', 'he')).toBe('למחוק את Rainy day fund?');
    expect(translateMessage('Row 3: Unknown category: Old', 'he')).toBe('שורה 3: קטגוריה לא מוכרת: Old');
    expect(translateMessage('Transaction kind', 'he')).toBe('סוג תנועה');
    expect(translateMessage('Expense, money out', 'he')).toBe('הוצאה, כסף יצא');
    expect(translateMessage('Budget progress', 'he')).toBe('התקדמות התקציב');
  });

  it('translates the one-time budget adjustment copy', () => {
    expect(translateMessage('Adjust budget', 'he')).toBe('התאמת תקציב');
    expect(translateMessage('Add funds', 'he')).toBe('הוספת כסף');
    expect(translateMessage('Delete this adjustment?', 'he')).toBe('למחוק את ההתאמה הזו?');
    expect(translateMessage('Delete adjustment +$100.00', 'he')).toBe('מחיקת התאמה +$100.00');
    expect(translateMessage('+$100.00 will be removed from this period’s limit.', 'he'))
      .toBe('+$100.00 יוסר מהמגבלה של התקופה הזו.');
  });

  it('translates the theme picker title, helper text, and every built-in theme name and description', () => {
    for (const message of [
      'Theme',
      'Choose the overall look. Every theme has a light and a dark version.',
      'This theme sets its own accent color.',
      'Classic',
      'High contrast',
      'Soft, tactile surfaces with a calm indigo accent.',
      'Rounded Material surfaces that follow your Android system colors.',
      'Maximum contrast and bold edges for easy reading.',
    ]) {
      expect(translateMessage(message, 'he')).not.toBe(message);
      expect(translateMessage(message, 'en')).toBe(message);
    }
    expect(translateMessage('Classic', 'he')).toBe('קלאסי');
  });

  it('translates the custom theme import, export and delete copy', () => {
    for (const message of [
      'Custom themes',
      'Import theme',
      'Export theme',
      'Delete theme',
      'Delete this theme?',
      'Replace this theme?',
      'Replace',
      'Theme imported.',
      'Couldn’t import theme',
      'At most 8 custom themes can be stored; delete one first.',
      'This file is too large to be a theme.',
    ]) {
      expect(translateMessage(message, 'he')).not.toBe(message);
      expect(translateMessage(message, 'en')).toBe(message);
    }
  });

  it('leaves unknown copy and English unchanged', () => {
    expect(translateMessage('Custom account name', 'he')).toBe('Custom account name');
    expect(translateMessage('Base currency', 'en')).toBe('Base currency');
  });

  it('translates the redesign-era additions to the Hebrew dictionary', () => {
    expect(translateMessage('Clear filters', 'he')).toBe('ניקוי הסינון');
    expect(translateMessage('Under pace', 'he')).toBe('מתחת לקצב');
    expect(translateMessage('Over budget', 'he')).toBe('חריגה מהתקציב');
    expect(translateMessage('Projected', 'he')).toBe('צפי');
    expect(translateMessage('remaining', 'he')).toBe('נותרו');
    expect(translateMessage('Pairing progress', 'he')).toBe('התקדמות החיבור');
    expect(translateMessage('Advanced', 'he')).toBe('מתקדם');
    expect(translateMessage('Preview · Net worth', 'he')).toBe('תצוגה מקדימה · שווי נקי');
    expect(translateMessage('Choose file', 'he')).toBe('בחירת קובץ');
    expect(translateMessage('Import', 'he')).toBe('ייבוא');
    // Same "label (currency)" dynamic pattern as "Opening balance (ILS)", exercised through
    // a different fixed label to confirm the pattern isn't matching on that label alone.
    expect(translateMessage('Amount (ILS)', 'he')).toBe('סכום (ILS)');
  });
});
