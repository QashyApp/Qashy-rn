import { render } from "@testing-library/react-native";

import { useTabLongPress } from "@/components/navigation/use-tab-long-press";

type Listener = (event: { index: number }) => void;

const mockRemove = jest.fn();
const mockAdd = jest.fn<{ remove: () => void } | null, [Listener]>();
jest.mock("../../../../modules/qashy-tab-gestures", () => ({
  addTabLongPressListener: (listener: Listener) => mockAdd(listener),
}));

function Probe({ onLongPress }: { onLongPress: () => void }) {
  useTabLongPress(onLongPress);
  return null;
}

describe("useTabLongPress", () => {
  beforeEach(() => {
    mockRemove.mockReset();
    mockAdd.mockReset();
    mockAdd.mockReturnValue({ remove: mockRemove });
  });

  it("calls the latest handler on a long press and unsubscribes on unmount", async () => {
    const first = jest.fn();
    const second = jest.fn();
    const view = await render(<Probe onLongPress={first} />);
    await view.rerender(<Probe onLongPress={second} />);
    expect(mockAdd).toHaveBeenCalledTimes(1);

    mockAdd.mock.calls[0][0]({ index: 2 });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    await view.unmount();
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });

  it("does nothing where the native module is missing", async () => {
    mockAdd.mockReturnValue(null);
    const view = await render(<Probe onLongPress={jest.fn()} />);
    await view.unmount();
    expect(mockRemove).not.toHaveBeenCalled();
  });
});
