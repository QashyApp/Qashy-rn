import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { DateField } from "@/components/ui/date-field";

type PickerProps = { onValueChange: (event: unknown, date: Date) => void };
let mockPicker: PickerProps | null = null;

jest.mock("@expo/ui/community/datetime-picker", () => ({
  DateTimePicker: (props: PickerProps) => {
    mockPicker = props;
    return null;
  },
}));

jest.mock("@/theme/theme", () => {
  const actual = jest.requireActual("@/theme/theme");
  return {
    ...actual,
    useQashyTheme: () => actual.accentTokens("#5966E9", false),
  };
});

jest.mock("@/localization/localization", () => ({
  useLocalization: () => ({
    t: (message: string) => message,
    isRtl: false,
    language: "en",
    locale: "en-US",
  }),
}));

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
// The error fades in, so it is present before it is visible.
const HIDDEN = { includeHiddenElements: true };
const RANGE_ERROR = /^Choose a date on or after/;

const open = async () => {
  await fireEvent.press(screen.getByRole("button", { name: /^Due date/ }));
};

describe("DateField (native) range error", () => {
  beforeEach(() => {
    mockPicker = null;
  });

  const field = (value: string, minimumDate?: string) => (
    <DateField
      label="Due date"
      value={value}
      onChange={() => undefined}
      minimumDate={minimumDate}
    />
  );

  it("shows the error for a pick outside the bounds", async () => {
    await render(field("2026-06-10", "2026-06-01"));
    await open();
    await act(async () => mockPicker!.onValueChange(null, utc("2026-05-01")));
    await open();

    expect(screen.getByText(RANGE_ERROR, HIDDEN)).toBeTruthy();
  });

  it("clears the error when the value changes", async () => {
    const view = await render(field("2026-06-10", "2026-06-01"));
    await open();
    await act(async () => mockPicker!.onValueChange(null, utc("2026-05-01")));
    await open();
    expect(screen.getByText(RANGE_ERROR, HIDDEN)).toBeTruthy();

    await view.rerender(field("2026-06-12", "2026-06-01"));

    expect(screen.queryByText(RANGE_ERROR, HIDDEN)).toBeNull();
  });

  it("clears the error when the bounds change so the rejected pick would now be valid", async () => {
    const view = await render(field("2026-06-10", "2026-06-01"));
    await open();
    await act(async () => mockPicker!.onValueChange(null, utc("2026-05-01")));
    await open();
    expect(screen.getByText(RANGE_ERROR, HIDDEN)).toBeTruthy();

    await view.rerender(field("2026-06-10", "2026-04-01"));

    expect(screen.queryByText(RANGE_ERROR, HIDDEN)).toBeNull();
  });
});

describe("DateField (native) rejected pick and value history", () => {
  beforeEach(() => {
    mockPicker = null;
  });

  const field = (value: string) => (
    <DateField
      label="Due date"
      value={value}
      onChange={() => undefined}
      minimumDate="2026-06-01"
    />
  );

  it("does not bring the error back when the value returns to what it was", async () => {
    const view = await render(field("2026-06-10"));
    await open();
    await act(async () => mockPicker!.onValueChange(null, utc("2026-05-01")));
    await open();
    expect(screen.getByText(RANGE_ERROR, HIDDEN)).toBeTruthy();

    await view.rerender(field("2026-06-12"));
    await view.rerender(field("2026-06-10"));

    expect(screen.queryByText(RANGE_ERROR, HIDDEN)).toBeNull();
  });
});
