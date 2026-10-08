/**
 * Native and tests: a deferred `require`, because Metro only evaluates a module the first time it
 * is required, and Jest cannot run `import()` without experimental flags.
 */
export const loadFluentEmoji = (): Promise<
  typeof import("@/theme/fluent-emoji-glyphs")
> =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Promise.resolve(require("@/theme/fluent-emoji-glyphs"));
