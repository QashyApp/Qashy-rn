import * as symbols from "expo-symbols";

// The Android tab bar draws its `md` icons through Expo Router, which loads `expo-symbols` as an
// optional library and throws from the tab layout's render when it is missing. That took the whole
// app down to the root error screen once the package was removed as iOS-only, so keep it pinned.
describe("native tab icons", () => {
  it("can resolve the Material Symbols loader Expo Router needs on Android", () => {
    expect(typeof symbols.unstable_getMaterialSymbolSourceAsync).toBe(
      "function",
    );
  });
});
