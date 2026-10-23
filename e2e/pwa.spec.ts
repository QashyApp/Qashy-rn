import { expect, test } from "@playwright/test";
import { completeOnboarding } from "./helpers";

test("exposes an installable web manifest", async ({ page }) => {
  const response = await page.request.get("/manifest.json");
  expect(response.ok()).toBeTruthy();
  const manifest = await response.json();
  expect(manifest.short_name).toBe("Qashy");
  expect((await page.request.get(manifest.icons[0].src)).ok()).toBeTruthy();
  expect((await page.request.get(manifest.icons[1].src)).ok()).toBeTruthy();
});

test("registers the service worker and starts offline", async ({
  page,
  context,
  browserName,
}) => {
  await page.goto("/");
  const scope = await page.evaluate(
    async () => (await navigator.serviceWorker.ready).scope,
  );
  expect(scope).toContain("4173");
  await page.reload();
  expect(
    await page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
  ).toBeTruthy();
  // Reloading an offline context aborts inside WebKit itself ("WebKit
  // encountered an internal error"), so the offline leg only runs on Chromium.
  // Registration and control above are still asserted on every browser.
  test.skip(
    browserName === "webkit",
    "Playwright/WebKit cannot reload an offline context.",
  );
  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText("Money, made calmer.")).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

// The policy's shape is asserted in `src/utils/__tests__/csp.test.ts`; that it does not break
// the app can only be asserted here, against the real export in a real browser. Both halves
// matter and neither substitutes for the other: a policy strict enough to be worth shipping is
// exactly one strict enough to white-screen the app, and the failure is silent in every check
// that does not load a page.
test("runs the exported app under its content security policy without a violation", async ({
  page,
}) => {
  const violations: string[] = [];
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { __csp: string[] }).__csp.push(
        `${event.effectiveDirective} blocked ${event.blockedURI} ${event.sample ?? ""}`.trim(),
      );
    });
  });

  const collect = async () => {
    violations.push(
      ...(await page.evaluate(
        () => (window as unknown as { __csp: string[] }).__csp,
      )),
    );
  };

  await completeOnboarding(page);
  await collect();

  // The pages that carry the crypto. `/sync-pair` in particular pulls in the camera, the QR
  // renderer, and the wordlist — the three things most likely to want something the policy
  // does not grant.
  for (const path of [
    "/more",
    "/sync",
    "/sync-pair",
    "/sync-recovery",
    "/sync-merge",
  ]) {
    await page.goto(path);
    await collect();
  }

  expect(violations).toEqual([]);

  // A policy that was never applied also produces no violations, so prove it is actually there
  // and that it is the strict one rather than something a build step relaxed.
  const policy = await page.getAttribute(
    'meta[http-equiv="Content-Security-Policy"]',
    "content",
  );
  expect(policy).toContain("default-src 'none'");
  expect(policy).toContain("object-src 'none'");
  expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
  // The hash has to be quoted to be a hash. Unquoted it parses as a host source and is dropped,
  // which blocks Expo Router's hydration script and shows up only as a violation on this page —
  // so pin the emitted form here too rather than relying on the count above staying at zero.
  expect(policy).toMatch(/script-src 'self' 'sha256-[A-Za-z0-9+/]+=*'/);

  // And that the app is genuinely running, not a blank page that violated nothing.
  await page.goto("/overview");
  await expect(page.getByText("Net worth", { exact: true })).toBeVisible();
});
