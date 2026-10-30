import { act, render, screen } from "@testing-library/react-native";

import { DateField } from "@/components/ui/date-field.web";

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

// The error fades in, so it is present before it is visible.
const HIDDEN = { includeHiddenElements: true };
const RANGE_ERROR = /^Choose a date on or after/;

type InputProps = {
  onChange: (event: {
    currentTarget: { value: string; validity: { badInput: boolean } };
  }) => void;
};

// The web field renders a DOM <input>; the test renderer keeps it as a host element, so the
// change handler is called with the one event shape it reads.
const type = async (value: string) => {
  const input = screen.getByLabelText("Due date", HIDDEN);
  await act(async () => {
    (input.props as InputProps).onChange({
      currentTarget: { value, validity: { badInput: false } },
    });
  });
};

describe("DateField (web) range error", () => {
  const field = (value: string, minimumDate?: string) => (
    <DateField
      label="Due date"
      value={value}
      onChange={() => undefined}
      minimumDate={minimumDate}
    />
  );

  it("shows the error for a typed date outside the bounds", async () => {
    await render(field("2026-06-10", "2026-06-01"));
    await type("2026-05-01");

    expect(screen.getByText(RANGE_ERROR, HIDDEN)).toBeTruthy();
  });

  it("clears the error when the bounds change so the rejected date would now be valid", async () => {
    const view = await render(field("2026-06-10", "2026-06-01"));
    await type("2026-05-01");
    expect(screen.getByText(RANGE_ERROR, HIDDEN)).toBeTruthy();

    await view.rerender(field("2026-06-10", "2026-04-01"));

    expect(screen.queryByText(RANGE_ERROR, HIDDEN)).toBeNull();
  });

  it("shows the form's value again when the rejected date becomes valid, instead of the uncommitted one", async () => {
    // An end date bounded below by a start date that then moves earlier.
    const view = await render(field("2026-06-10", "2026-06-01"));
    const input = screen.getByLabelText("Due date", HIDDEN) as unknown as {
      value: string;
    };
    input.value = "2026-05-01";
    await type("2026-05-01");
    expect(screen.getByText(RANGE_ERROR, HIDDEN)).toBeTruthy();

    await view.rerender(field("2026-06-10", "2026-04-01"));

    expect(screen.queryByText(RANGE_ERROR, HIDDEN)).toBeNull();
    // The form still holds Jun 10, and that is what the field shows.
    expect(input.value).toBe("2026-06-10");
    // Moving the bound back does not resurrect the dropped rejection.
    await view.rerender(field("2026-06-10", "2026-06-01"));
    expect(screen.queryByText(RANGE_ERROR, HIDDEN)).toBeNull();
    expect(input.value).toBe("2026-06-10");
  });

  it("clears the error when the value changes, and does not bring it back", async () => {
    const view = await render(field("2026-06-10", "2026-06-01"));
    await type("2026-05-01");
    expect(screen.getByText(RANGE_ERROR, HIDDEN)).toBeTruthy();

    await view.rerender(field("2026-06-12", "2026-06-01"));
    expect(screen.queryByText(RANGE_ERROR, HIDDEN)).toBeNull();
    await view.rerender(field("2026-06-10", "2026-06-01"));
    expect(screen.queryByText(RANGE_ERROR, HIDDEN)).toBeNull();
  });
});
