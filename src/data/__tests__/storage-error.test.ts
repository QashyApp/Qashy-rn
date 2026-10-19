import {
  STORAGE_BUSY_MESSAGE,
  STORAGE_DAMAGED_MESSAGE,
  STORAGE_FULL_MESSAGE,
  STORAGE_NEWER_VERSION_MESSAGE,
  STORAGE_READ_ONLY_MESSAGE,
  STORAGE_UNAVAILABLE_MESSAGE,
  STORAGE_UNKNOWN_MESSAGE,
  storageFailureMessage,
} from "@/data/storage-error";
import { translateMessage } from "@/localization/localization";

const named = (name: string, message = "") =>
  Object.assign(new Error(message), { name });

describe("storageFailureMessage", () => {
  it("maps SQLite result messages to Qashy's sentences", () => {
    expect(
      storageFailureMessage(new Error("Error code : database is locked")),
    ).toBe(STORAGE_BUSY_MESSAGE);
    expect(storageFailureMessage(new Error("database or disk is full"))).toBe(
      STORAGE_FULL_MESSAGE,
    );
    expect(
      storageFailureMessage(new Error("database disk image is malformed")),
    ).toBe(STORAGE_DAMAGED_MESSAGE);
    expect(storageFailureMessage(new Error("file is not a database"))).toBe(
      STORAGE_DAMAGED_MESSAGE,
    );
    expect(
      storageFailureMessage(new Error("attempt to write a readonly database")),
    ).toBe(STORAGE_READ_ONLY_MESSAGE);
    expect(
      storageFailureMessage(new Error("unable to open database file")),
    ).toBe(STORAGE_UNAVAILABLE_MESSAGE);
  });

  it("maps IndexedDB and Dexie error names", () => {
    expect(storageFailureMessage(named("QuotaExceededError"))).toBe(
      STORAGE_FULL_MESSAGE,
    );
    expect(storageFailureMessage(named("VersionError"))).toBe(
      STORAGE_NEWER_VERSION_MESSAGE,
    );
    expect(storageFailureMessage(named("DatabaseClosedError"))).toBe(
      STORAGE_UNAVAILABLE_MESSAGE,
    );
    expect(storageFailureMessage(named("BlockedError"))).toBe(
      STORAGE_BUSY_MESSAGE,
    );
  });

  it("leaves every other error alone, including one that merely mentions a lock", () => {
    expect(
      storageFailureMessage(
        new Error("Unlock was cancelled because this device was locked."),
      ),
    ).toBeNull();
    expect(
      storageFailureMessage(new Error("Choose a valid account.")),
    ).toBeNull();
    expect(storageFailureMessage("locked")).toBeNull();
    expect(storageFailureMessage(null)).toBeNull();
  });

  it("returns sentences the Hebrew dictionary knows", () => {
    for (const message of [
      STORAGE_BUSY_MESSAGE,
      STORAGE_FULL_MESSAGE,
      STORAGE_DAMAGED_MESSAGE,
      STORAGE_READ_ONLY_MESSAGE,
      STORAGE_NEWER_VERSION_MESSAGE,
      STORAGE_UNAVAILABLE_MESSAGE,
      STORAGE_UNKNOWN_MESSAGE,
    ]) {
      expect(translateMessage(message, "he")).not.toBe(message);
    }
  });
});
