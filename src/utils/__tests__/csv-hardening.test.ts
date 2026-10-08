import {
  escapeCsv,
  parseCsvTable,
  parseCsvText,
  unescapeCsvFormula,
} from "@/utils/csv";

describe("CSV quoting", () => {
  it("accepts an opening quote after spaces or tabs and discards that padding", () => {
    const table = parseCsvTable(
      'date,title,amount\n2026-01-01, "Coffee, beans",3.50\n2026-01-02,\t"Tea",1.00',
    );
    expect(table.rowErrors).toEqual([]);
    expect(table.rows.map((row) => [row.title, row.amount])).toEqual([
      ["Coffee, beans", "3.50"],
      ["Tea", "1.00"],
    ]);
  });

  it("still rejects a quote that follows other text in an unquoted field", () => {
    const table = parseCsvTable('date,title\n2026-01-01,ab "cd"');
    expect(table.rows).toHaveLength(0);
    expect(table.rowErrors).toMatchObject([{ lineNumber: 2 }]);
  });
});

describe("CSV byte-order mark", () => {
  it("strips a leading BOM so a quoted first header parses", () => {
    const table = parseCsvTable('\uFEFF"date","title"\n2026-01-01,Coffee');
    expect(table.headers).toEqual(["date", "title"]);
    expect(table.rows[0]).toMatchObject({
      date: "2026-01-01",
      title: "Coffee",
    });
    expect(
      parseCsvText('\uFEFF"date",title\n2026-01-01,Coffee')[0],
    ).toMatchObject({
      date: "2026-01-01",
    });
  });
});

describe("unclosed quoted fields", () => {
  it("reports the line where the quote opened and keeps the rows after it", () => {
    const table = parseCsvTable(
      'date,title\n2026-01-01,Good\n2026-01-02,"open\n2026-01-03,Next\n2026-01-04,After',
    );
    expect(table.rowErrors).toEqual([
      {
        lineNumber: 3,
        message: "Unclosed quoted CSV field starting on line 3.",
      },
    ]);
    expect(table.rows.map((row) => [row.rowNumber, row.title])).toEqual([
      [2, "Good"],
      [4, "Next"],
      [5, "After"],
    ]);
  });

  it("stops a runaway quoted field after the line limit and resumes on the next line", () => {
    const body = Array.from(
      { length: 300 },
      (_, index) => `2026-02-01,Row ${index}`,
    ).join("\n");
    const table = parseCsvTable(`date,title\n2026-01-01,"runaway\n${body}`);
    expect(table.rowErrors).toEqual([
      {
        lineNumber: 2,
        message: "Unclosed quoted CSV field starting on line 2.",
      },
    ]);
    expect(table.rows).toHaveLength(300);
    expect(table.rows[0]).toMatchObject({ rowNumber: 3, title: "Row 0" });
    expect(table.rows[299]).toMatchObject({ rowNumber: 302, title: "Row 299" });
  });
});

describe("formula guard", () => {
  it("guards values that start with whitespace, a BOM or a formula character", () => {
    expect(escapeCsv("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(escapeCsv(" =SUM(A1)")).toBe("' =SUM(A1)");
    expect(escapeCsv("\t=cmd")).toBe("'\t=cmd");
    expect(escapeCsv("\uFEFF@home")).toBe("'\uFEFF@home");
    expect(escapeCsv("-abc")).toBe("'-abc");
    expect(escapeCsv(" -5")).toBe("' -5");
  });

  it("leaves plain numbers unguarded", () => {
    expect(escapeCsv("-12.50")).toBe("-12.50");
    expect(escapeCsv("42")).toBe("42");
  });

  it("removes only the apostrophe the export prefixed", () => {
    expect(escapeCsv("'@home")).toBe("''@home");
    expect(unescapeCsvFormula("''@home")).toBe("'@home");
    // A foreign value with an apostrophe that no trigger follows is not altered.
    expect(unescapeCsvFormula("'Twas")).toBe("'Twas");
    expect(unescapeCsvFormula("'=x")).toBe("=x");
  });

  it("round-trips export then import for values that look like formulas or start with an apostrophe", () => {
    const values = [
      "=SUM(A1)",
      " =SUM(A1)",
      "\t=cmd",
      "'@home",
      "''=x",
      "'Twas",
      "'",
      "''",
      "-abc",
      " -5",
      "+5",
      "@",
      "plain",
      "-12.50",
    ];
    for (const value of values) {
      const table = parseCsvTable(`title\n${escapeCsv(value)}`);
      expect({ value, title: table.rows[0].title }).toEqual({
        value,
        title: value,
      });
    }
  });

  it("quotes values with leading or trailing spaces and keeps them on import", () => {
    expect(escapeCsv(" note ")).toBe('" note "');
    const table = parseCsvTable(`title,note\nx,${escapeCsv(" note ")}`);
    expect(table.rows[0].note).toBe(" note ");
  });
});
