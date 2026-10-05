import {
  announceSavedTransaction,
  consumeSavedTransactionSignal,
  flashesForSave,
  getSavedTransactionSignal,
  resetSavedTransactionSignal,
  SIGNAL_LIFETIME_MS,
  subscribeSavedTransactionSignal,
} from "@/features/transactions/list/saved-transaction-signal";

beforeEach(resetSavedTransactionSignal);

describe("flashesForSave", () => {
  const today = "2026-05-10";
  it("flashes a back-dated new entry the full number of times", () => {
    expect(
      flashesForSave({ isNew: true, localDate: "2026-04-02", today }),
    ).toBe(3);
  });
  it("flashes less for an entry dated today", () => {
    expect(flashesForSave({ isNew: true, localDate: today, today })).toBe(2);
  });
  it("stays quiet for an edit that kept its date", () => {
    expect(
      flashesForSave({
        isNew: false,
        previousDate: "2026-04-02",
        localDate: "2026-04-02",
        today,
      }),
    ).toBe(0);
  });
  it("flashes an edit that moved the date", () => {
    expect(
      flashesForSave({
        isNew: false,
        previousDate: "2026-04-02",
        localDate: "2026-04-09",
        today,
      }),
    ).toBe(3);
  });
});

describe("saved transaction signal", () => {
  const entry = {
    id: "t1",
    localDate: "2026-04-02",
    isNew: true,
    today: "2026-05-10",
  };

  it("carries the id and month and notifies subscribers", () => {
    const listener = jest.fn();
    subscribeSavedTransactionSignal(listener);
    announceSavedTransaction(entry, 1000);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getSavedTransactionSignal(1000)).toMatchObject({
      id: "t1",
      month: "2026-04",
      flashes: 3,
    });
  });

  it("announces nothing for a quiet edit", () => {
    announceSavedTransaction(
      { ...entry, isNew: false, previousDate: entry.localDate },
      1000,
    );
    expect(getSavedTransactionSignal(1000)).toBeNull();
  });

  it("expires on its own", () => {
    announceSavedTransaction(entry, 1000);
    expect(
      getSavedTransactionSignal(1000 + SIGNAL_LIFETIME_MS - 1),
    ).not.toBeNull();
    expect(getSavedTransactionSignal(1000 + SIGNAL_LIFETIME_MS)).toBeNull();
  });

  it("is consumed once, and a newer save is not consumed by an older token", () => {
    announceSavedTransaction(entry, 1000);
    const first = getSavedTransactionSignal(1000)!;
    announceSavedTransaction({ ...entry, id: "t2" }, 1000);
    consumeSavedTransactionSignal(first.token);
    expect(getSavedTransactionSignal(1000)?.id).toBe("t2");
    consumeSavedTransactionSignal(getSavedTransactionSignal(1000)!.token);
    expect(getSavedTransactionSignal(1000)).toBeNull();
  });
});
