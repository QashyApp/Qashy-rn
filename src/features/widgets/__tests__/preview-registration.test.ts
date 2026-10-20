describe("requestPreviewRegistration", () => {
  function load() {
    let module!: typeof import("@/features/widgets/preview-registration");
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- a fresh copy per test
      module = require("@/features/widgets/preview-registration");
    });
    return module;
  }

  it("asks the native side once per process", async () => {
    const { requestPreviewRegistration } = load();
    const register = jest.fn(async () => "registered");
    expect(requestPreviewRegistration(register)).toBe(true);
    expect(requestPreviewRegistration(register)).toBe(false);
    expect(requestPreviewRegistration(register)).toBe(false);
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("never rejects when the native call does", async () => {
    const { requestPreviewRegistration } = load();
    const register = jest.fn(async () => {
      throw new Error("boom");
    });
    expect(() => requestPreviewRegistration(register)).not.toThrow();
    // A rejection handled inside would otherwise surface as an unhandled one here.
    await Promise.resolve();
    await Promise.resolve();
    expect(register).toHaveBeenCalledTimes(1);
  });
});
