import { act, renderHook } from "@testing-library/react-native";

import { LocalFinanceRepository } from "@/data/local-finance-repository";
import { MemoryStorageAdapter } from "@/data/memory-storage";
import type { FinanceState, RecurringRule } from "@/domain/models";
import { useRecurringForm } from "@/features/more/recurring/use-recurring-form";
import { nextDueDateOnReactivation } from "@/utils/recurring-impact";

/**
 * The "Schedule active" switch's lifecycle in the schedule form. Today is Oct 30, 2026 throughout.
 * The rules below are monthly on the 10th from Jan 10.
 */

const mockToday = "2026-10-30";
let mockParams: { id?: string } = {};
let mockState: FinanceState;
/** The values the form hands the sheet each render; its first is the baseline for "unsaved changes". */
let mockSheetValues: { active: boolean }[] = [];
const mockSaveRecurringRule = jest.fn(async (..._args: unknown[]) => undefined);
const mockRepository = {
  saveRecurringRule: (...args: unknown[]) => mockSaveRecurringRule(...args),
  deleteEntities: jest.fn(async () => undefined),
};

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
}));
jest.mock("@/components/navigation/use-form-sheet", () => ({
  useFormSheet: ({ values }: { values: { active: boolean } }) => {
    mockSheetValues.push(values);
    return { closeToOwner: jest.fn(), allowLeave: jest.fn() };
  },
}));
jest.mock("@/features/shared/use-automatic-rates", () => ({
  useRateLookup: () => false,
  useTurnOnAutomaticRates: () => ({ turningOn: false, turnOn: jest.fn() }),
}));
jest.mock("@/providers/exchange-rate-provider", () => ({
  useExchangeRateStatus: () => ({}),
}));
jest.mock("@/providers/finance-provider", () => ({
  useFinanceRepository: () => mockRepository,
  useFinanceState: () => mockState,
}));
jest.mock("@/localization/localization", () => ({
  useLocalization: () => ({ locale: "en-US", t: (text: string) => text }),
}));
jest.mock("@/utils/confirm", () => ({
  confirmAction: jest.fn(async () => true),
  confirmDestructive: jest.fn(async () => true),
  errorMessage: (reason: unknown, fallback: string) =>
    reason instanceof Error ? reason.message : fallback,
  showError: jest.fn(),
}));
jest.mock("@/services/haptics", () => ({ hapticSuccess: jest.fn() }));
jest.mock("@/utils/date", () => ({
  ...jest.requireActual("@/utils/date"),
  todayLocal: () => mockToday,
}));

async function snapshotWithAccount() {
  const repository = new LocalFinanceRepository(new MemoryStorageAdapter());
  await repository.initialize();
  await repository.completeOnboarding({
    locale: "en-US",
    baseCurrency: "USD",
    accountName: "Everyday",
    accountType: "checking",
    openingBalanceMinor: 100_000,
    themeMode: "system",
    accentSource: "system",
    accentHex: "#5966E9",
  });
  return repository.getSnapshot();
}

function makeRule(
  accountId: string,
  overrides: Partial<RecurringRule>,
): RecurringRule {
  return {
    id: "rule-1",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    template: {
      kind: "expense",
      title: "Gym",
      note: "",
      accountId,
      categoryId: null,
      tagIds: [],
      amountMinor: 2_500,
      currency: "USD",
    },
    unit: "month",
    interval: 1,
    startDate: "2026-01-10",
    endDate: "2026-12-31",
    nextDueDate: "2026-11-10",
    autoPost: false,
    active: true,
    pausedByDependency: false,
    ...overrides,
  };
}

async function openForm(overrides: Partial<RecurringRule>) {
  const snapshot = await snapshotWithAccount();
  const rule = makeRule(snapshot.accounts[0].id, overrides);
  mockState = { ...snapshot, recurringRules: [rule] };
  mockParams = { id: rule.id };
  // Not spread: `result` is a getter on the hook handle and must stay one.
  const hook = await renderHook(() => useRecurringForm());
  return { rule, result: hook.result };
}

const savedInput = () =>
  mockSaveRecurringRule.mock.calls[0][0] as { active: boolean };

beforeEach(() => {
  mockSheetValues = [];
  mockSaveRecurringRule.mockClear();
});

describe("the schedule form's active switch", () => {
  it("stays off after shortening the end into the past and extending it back", async () => {
    const { result } = await openForm({});
    expect(result.current.scheduleEnded).toBe(false);
    expect(result.current.effectiveActive).toBe(true);

    await act(async () => result.current.setEndDate("2026-10-01"));
    expect(result.current.scheduleEnded).toBe(true);
    expect(result.current.effectiveActive).toBe(false);
    // Off for real, not just shown off.
    expect(result.current.active).toBe(false);

    await act(async () => result.current.setEndDate("2026-12-31"));
    // Extending only unlocks the switch: the user turns the schedule on.
    expect(result.current.scheduleEnded).toBe(false);
    expect(result.current.effectiveActive).toBe(false);

    await act(async () => {
      await result.current.save();
    });
    expect(mockSaveRecurringRule).toHaveBeenCalledTimes(1);
    expect(savedInput().active).toBe(false);
  });

  it("unlocks off for a schedule generation ended, and saves on once the user turns it on", async () => {
    const { result } = await openForm({
      endDate: "2026-03-31",
      nextDueDate: "2026-04-10",
      active: false,
    });
    expect(result.current.scheduleEnded).toBe(true);

    await act(async () => result.current.setEndDate("2026-12-31"));
    expect(result.current.scheduleEnded).toBe(false);
    expect(result.current.effectiveActive).toBe(false);

    await act(async () => result.current.setActive(true));
    expect(result.current.scheduleEnded).toBe(false);
    expect(result.current.effectiveActive).toBe(true);

    await act(async () => {
      await result.current.save();
    });
    expect(savedInput().active).toBe(true);
  });

  it("opens a long-expired paused schedule as ended, on the date the list shows", async () => {
    const stale = {
      endDate: "2026-03-31",
      nextDueDate: "2026-03-10",
      active: false,
    };
    const { result, rule } = await openForm(stale);
    const resumesAt = nextDueDateOnReactivation(rule, mockToday);
    expect(resumesAt).toBe("2026-11-10");
    expect(result.current.scheduleEnded).toBe(true);
    expect(result.current.effectiveActive).toBe(false);
    expect(result.current.nextAfterEnd).toBe(resumesAt);

    // Extending past the date it would resume at unlocks it, still off.
    await act(async () => result.current.setEndDate("2026-12-31"));
    expect(result.current.scheduleEnded).toBe(false);
    expect(result.current.nextAfterEnd).toBeNull();
    expect(result.current.effectiveActive).toBe(false);
  });

  it("opens a stored-active schedule that is already past its end locked off, not dirty", async () => {
    const { result } = await openForm({
      endDate: "2026-03-31",
      nextDueDate: "2026-04-10",
      active: true,
    });
    expect(result.current.scheduleEnded).toBe(true);
    expect(result.current.active).toBe(false);
    expect(result.current.effectiveActive).toBe(false);
    // Every render's values equal the first (the baseline): opening alone is not a change.
    const baseline = JSON.stringify(mockSheetValues[0]);
    expect(mockSheetValues.length).toBeGreaterThan(0);
    for (const values of mockSheetValues)
      expect(JSON.stringify(values)).toBe(baseline);

    // Extending it unlocks the switch, off.
    await act(async () => result.current.setEndDate("2026-12-31"));
    expect(result.current.scheduleEnded).toBe(false);
    expect(result.current.effectiveActive).toBe(false);
  });

  it("keeps the last ended lock while the interval is blank", async () => {
    const { result } = await openForm({
      endDate: "2026-03-31",
      nextDueDate: "2026-03-10",
      active: false,
    });
    expect(result.current.scheduleEnded).toBe(true);

    await act(async () => result.current.setInterval(""));
    expect(result.current.intervalError).toBeDefined();
    expect(result.current.scheduleEnded).toBe(true);
    expect(result.current.effectiveActive).toBe(false);

    await act(async () => result.current.setInterval("1"));
    expect(result.current.scheduleEnded).toBe(true);
  });

  it("keeps a schedule that is not ended unlocked while the interval is blank", async () => {
    const { result } = await openForm({});
    await act(async () => result.current.setInterval(""));
    expect(result.current.scheduleEnded).toBe(false);
    expect(result.current.effectiveActive).toBe(true);
  });
});
