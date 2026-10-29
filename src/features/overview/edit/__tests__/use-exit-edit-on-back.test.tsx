import { render } from "@testing-library/react-native";
import { BackHandler } from "react-native";

import { useExitEditOnBack } from "@/features/overview/edit/use-exit-edit-on-back";

// Stands in for the navigator: runs the effect while "mockFocused", the way `useFocusEffect` does.
let mockFocused = true;
jest.mock("expo-router", () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect: useEffectMock } = jest.requireActual("react");
    useEffectMock(() => (mockFocused ? effect() : undefined), [effect]);
  },
}));

function Probe({ active, onExit }: { active: boolean; onExit: () => void }) {
  useExitEditOnBack(active, onExit);
  return null;
}

describe("useExitEditOnBack", () => {
  const remove = jest.fn();
  let add: jest.SpyInstance;
  const press = () => {
    const handler = add.mock.calls.at(-1)?.[1] as () => boolean;
    return handler();
  };

  beforeEach(() => {
    mockFocused = true;
    remove.mockClear();
    add = jest
      .spyOn(BackHandler, "addEventListener")
      .mockImplementation(() => ({ remove }));
  });
  afterEach(() => add.mockRestore());

  it("exits edit mode on the hardware back button and consumes it", async () => {
    const onExit = jest.fn();
    await render(<Probe active onExit={onExit} />);
    expect(add).toHaveBeenCalledWith("hardwareBackPress", expect.any(Function));
    expect(press()).toBe(true);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("leaves back alone when not editing", async () => {
    await render(<Probe active={false} onExit={jest.fn()} />);
    expect(add).not.toHaveBeenCalled();
  });

  it("leaves back alone while the screen is not mockFocused", async () => {
    mockFocused = false;
    await render(<Probe active onExit={jest.fn()} />);
    expect(add).not.toHaveBeenCalled();
  });

  it("stops listening when editing ends", async () => {
    const view = await render(<Probe active onExit={jest.fn()} />);
    await view.rerender(<Probe active={false} onExit={jest.fn()} />);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("calls the latest exit handler without re-subscribing", async () => {
    const first = jest.fn();
    const second = jest.fn();
    const view = await render(<Probe active onExit={first} />);
    await view.rerender(<Probe active onExit={second} />);
    expect(add).toHaveBeenCalledTimes(1);
    press();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
