import { readSqliteTables } from "../cashew/sqlite-reader";
import {
  NODE_SQLITE_AVAILABLE,
  SKIP_MESSAGE,
  buildDatabase,
} from "./cashew-fixture";

const describeIfSqlite = NODE_SQLITE_AVAILABLE ? describe : describe.skip;
if (!NODE_SQLITE_AVAILABLE) {
  console.warn(SKIP_MESSAGE);
}

describeIfSqlite("sqlite reader table names", () => {
  test('stores a table named "__proto__" as data, not as the prototype', () => {
    const { bytes } = buildDatabase((db) => {
      db.exec('CREATE TABLE "__proto__" (value INTEGER)');
      db.exec('INSERT INTO "__proto__" (value) VALUES (7)');
    });
    const tables = readSqliteTables(bytes);
    expect(Object.getPrototypeOf(tables)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(tables, "__proto__")).toBe(
      true,
    );
    expect(tables["__proto__"]).toEqual([{ value: 7 }]);
    expect(({} as Record<string, unknown>).value).toBeUndefined();
  });
});
