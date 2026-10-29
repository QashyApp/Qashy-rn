import { createHash } from "crypto";

import { THEME_HINT_SCRIPT_HASH } from "@/utils/csp";
import {
  parseThemeHint,
  THEME_HINT_KEY,
  THEME_HINT_SCRIPT,
} from "@/utils/theme-hint";

describe("theme hint", () => {
  it("accepts only a theme mode with two plain hex colors", () => {
    const ok = { mode: "dark", background: "#0E0F13", accent: "#5966E9" };
    expect(parseThemeHint(JSON.stringify(ok))).toEqual(ok);
    expect(parseThemeHint(JSON.stringify({ ...ok, mode: "system" }))).toEqual({
      ...ok,
      mode: "system",
    });
    for (const bad of [
      null,
      "",
      "not json",
      JSON.stringify({ ...ok, mode: "sepia" }),
      JSON.stringify({ ...ok, background: "rgb(0,0,0)" }),
      JSON.stringify({ ...ok, accent: "#FFF" }),
      JSON.stringify({ mode: "dark" }),
      // The previous format stored the resolved scheme; it is no hint rather than a stale one.
      JSON.stringify({
        scheme: "dark",
        background: "#0E0F13",
        accent: "#5966E9",
      }),
      JSON.stringify([ok]),
    ]) {
      expect(parseThemeHint(bad)).toBeNull();
    }
  });

  it("pins the inline script's hash in the content security policy", () => {
    const hash = `sha256-${createHash("sha256").update(THEME_HINT_SCRIPT).digest("base64")}`;
    expect(THEME_HINT_SCRIPT_HASH).toBe(hash);
  });

  it("reads only the hint key and never throws", () => {
    expect(THEME_HINT_SCRIPT).toContain(THEME_HINT_KEY);
    const values: Record<string, string> = {};
    const style = {
      setProperty: (name: string, value: string) => {
        values[name] = value;
      },
      colorScheme: "",
    };
    const metas: Record<string, { content: string }> = {
      "qashy-theme-color-light": { content: "" },
      "qashy-theme-color-dark": { content: "" },
    };
    const doc = {
      documentElement: { style },
      getElementById: (id: string) => {
        const meta = metas[id];
        return meta
          ? {
              setAttribute: (_name: string, value: string) =>
                (meta.content = value),
            }
          : null;
      },
    };
    const run = (stored: string | null) =>
      new Function("localStorage", "document", THEME_HINT_SCRIPT)(
        { getItem: () => stored },
        doc,
      );
    run(
      JSON.stringify({
        mode: "dark",
        background: "#0E0F13",
        accent: "#000000",
      }),
    );
    expect(values["--qashy-bg"]).toBe("#0E0F13");
    expect(style.colorScheme).toBe("dark");
    // A forced dark on a light-system device must tint the address bar dark from the first paint.
    expect(metas["qashy-theme-color-light"].content).toBe("#0E0F13");
    expect(metas["qashy-theme-color-dark"].content).toBe("#0E0F13");
    for (const key of Object.keys(values)) delete values[key];
    style.colorScheme = "";
    run("{not json");
    run(JSON.stringify({ mode: "dark", background: "red" }));
    expect(values).toEqual({});
  });

  it("leaves the paint to the live system scheme when the mode is system", () => {
    const values: Record<string, string> = {};
    const style = {
      setProperty: (name: string, value: string) => {
        values[name] = value;
      },
      colorScheme: "",
    };
    const metas: Record<string, { content: string }> = {
      "qashy-theme-color-light": { content: "" },
      "qashy-theme-color-dark": { content: "" },
    };
    const doc = {
      documentElement: { style },
      getElementById: (id: string) => {
        const meta = metas[id];
        return meta
          ? {
              setAttribute: (_name: string, value: string) =>
                (meta.content = value),
            }
          : null;
      },
    };
    const run = (stored: string) =>
      new Function("localStorage", "document", THEME_HINT_SCRIPT)(
        { getItem: () => stored },
        doc,
      );
    // Last session was system + dark: the cached dark color must not be painted on a light launch.
    run(
      JSON.stringify({
        mode: "system",
        background: "#0E0F13",
        accent: "#000000",
      }),
    );
    // A hint from before `mode` existed carries only the resolved scheme and is ignored too.
    run(
      JSON.stringify({
        scheme: "dark",
        background: "#0E0F13",
        accent: "#000000",
      }),
    );
    expect(values).toEqual({});
    expect(style.colorScheme).toBe("");
    expect(metas["qashy-theme-color-light"].content).toBe("");
    expect(metas["qashy-theme-color-dark"].content).toBe("");
    run(
      JSON.stringify({
        mode: "light",
        background: "#F6F7F9",
        accent: "#000000",
      }),
    );
    expect(values["--qashy-bg"]).toBe("#F6F7F9");
    expect(style.colorScheme).toBe("light");
  });
});
