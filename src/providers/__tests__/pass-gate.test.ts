import { createPassGate } from "@/providers/pass-gate";

const deferred = () => {
  let resolve: (value: boolean) => void = () => undefined;
  const promise = new Promise<boolean>((done) => (resolve = done));
  return { promise, resolve };
};

describe("createPassGate", () => {
  it("runs one pass at a time and reports a skipped request as false", async () => {
    const first = deferred();
    const run = jest.fn(() => first.promise);
    const gate = createPassGate(run);

    const started = gate.request();
    expect(await gate.request()).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);

    first.resolve(true);
    expect(await started).toBe(true);
    // Free again once the pass is over.
    run.mockResolvedValueOnce(true);
    expect(await gate.request()).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("makes a queued request wait for the running pass and then run its own", async () => {
    const first = deferred();
    const second = deferred();
    const run = jest
      .fn<Promise<boolean>, []>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const gate = createPassGate(run);

    const running = gate.request();
    let settled = false;
    const queued = gate.requestQueued().then((ran) => {
      settled = true;
      return ran;
    });

    // The running pass finishing is not what settles a queued request.
    first.resolve(false);
    await running;
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(run).toHaveBeenCalledTimes(2);

    second.resolve(true);
    expect(await queued).toBe(true);
  });

  it("shares one follow-up pass between every queued caller", async () => {
    const first = deferred();
    const run = jest
      .fn<Promise<boolean>, []>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(true);
    const gate = createPassGate(run);

    void gate.request();
    const a = gate.requestQueued();
    const b = gate.requestQueued();
    first.resolve(true);

    expect(await Promise.all([a, b])).toEqual([true, true]);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("queues another pass for a caller that arrives once the follow-up has started", async () => {
    const first = deferred();
    const second = deferred();
    const third = deferred();
    const run = jest
      .fn<Promise<boolean>, []>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);
    const gate = createPassGate(run);

    void gate.request();
    const early = gate.requestQueued();
    first.resolve(true);
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
    // The follow-up is now running, and began before this call.
    expect(run).toHaveBeenCalledTimes(2);

    let lateSettled = false;
    const late = gate.requestQueued().then((ran) => {
      lateSettled = true;
      return ran;
    });
    second.resolve(true);
    expect(await early).toBe(true);
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
    expect(lateSettled).toBe(false);
    expect(run).toHaveBeenCalledTimes(3);

    third.resolve(false);
    expect(await late).toBe(false);
  });

  it("starts straight away when nothing is running", async () => {
    const run = jest.fn().mockResolvedValue(true);
    const gate = createPassGate(run);
    expect(await gate.requestQueued()).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
