#!/usr/bin/env node
/**
 * Renders the branding SVGs in `assets/branding/` and `public/` down to the
 * exact PNG sizes the app already ships (native icon/splash, Android adaptive
 * icon layers, and the web manifest icons).
 *
 * Uses Playwright's bundled Chromium — already a devDependency for e2e — so
 * there is no new native image library to vendor. Each target is rendered by
 * loading a tiny HTML page whose only content is the SVG, sized to the exact
 * output viewport, and screenshotting it with `omitBackground: true` where the
 * output needs a transparent background (the two Android foreground layers).
 *
 * Run: `node scripts/render-icons.mjs`
 */
import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + "/..";

const APP_ICON_SVG = await readFile(
  path.join(ROOT, "assets/branding/qashy-app-icon.svg"),
  "utf8",
);
const MARK_SVG = await readFile(
  path.join(ROOT, "assets/branding/qashy-mark.svg"),
  "utf8",
);
const MARK_MONO_SVG = await readFile(
  path.join(ROOT, "assets/branding/qashy-mark-monochrome.svg"),
  "utf8",
);
const PUBLIC_ICON_SVG = await readFile(
  path.join(ROOT, "public/qashy-icon.svg"),
  "utf8",
);

/** Strips the outer `<svg ...>` tag, keeping only its children, so a mark can be re-wrapped. */
function innerMarkup(svg) {
  return svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
}

/**
 * Wraps a 1024-viewBox mark (a `<circle>`/`<path>` group with no background)
 * into a transparent square, scaled so it sits inside Android's ~66% adaptive
 * icon safe zone, centered on the mark's own geometric middle (512, 512).
 */
function safeZoneMark(markSvg, { size, scale = 0.66 }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
    <g transform="translate(512 512) scale(${scale}) translate(-512 -512)">
      ${innerMarkup(markSvg)}
    </g>
  </svg>`;
}

/** The adaptive icon background layer: a flat blue background layer, no mark, no rounded corners (Android supplies its own mask). */
function backgroundOnlySvg({ size }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
    <rect width="1024" height="1024" fill="#5070FF"/>
  </svg>`;
}

/** Maskable PWA icon: full-bleed background, mark inside the 80% maskable safe zone. */
function maskableSvg({ size }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
    <rect width="1024" height="1024" fill="#5070FF"/>
    <g transform="translate(512 512) scale(0.78) translate(-512 -512)">
      ${innerMarkup(MARK_SVG)}
    </g>
  </svg>`;
}

const targets = [
  {
    out: "assets/images/icon.png",
    svg: APP_ICON_SVG,
    size: 1024,
    transparent: false,
  },
  // The splash screen now sits on the app's own neutral background token
  // (see app.json), so the splash image has to carry its own color rather
  // than being a white glyph meant for an indigo backdrop — the full,
  // self-contained icon reads correctly on both the light and dark splash.
  {
    out: "assets/images/splash-icon.png",
    svg: APP_ICON_SVG,
    size: 512,
    transparent: false,
  },
  {
    out: "assets/images/favicon.png",
    svg: PUBLIC_ICON_SVG,
    size: 48,
    transparent: true,
  },
  {
    out: "assets/images/android-icon-foreground.png",
    svg: safeZoneMark(MARK_SVG, { size: 512 }),
    size: 512,
    transparent: true,
  },
  {
    out: "assets/images/android-icon-background.png",
    svg: backgroundOnlySvg({ size: 512 }),
    size: 512,
    transparent: false,
  },
  {
    out: "assets/images/android-icon-monochrome.png",
    svg: safeZoneMark(MARK_MONO_SVG, { size: 432 }),
    size: 432,
    transparent: true,
  },
  {
    out: "public/qashy-icon-192.png",
    svg: PUBLIC_ICON_SVG,
    size: 192,
    transparent: true,
  },
  {
    out: "public/qashy-icon-512.png",
    svg: PUBLIC_ICON_SVG,
    size: 512,
    transparent: true,
  },
  // iOS rounds apple-touch icons itself, so this one stays a full square.
  {
    out: "public/qashy-apple-touch-icon.png",
    svg: APP_ICON_SVG,
    size: 180,
    transparent: false,
  },
  {
    out: "public/qashy-icon-maskable-512.png",
    svg: maskableSvg({ size: 512 }),
    size: 512,
    transparent: false,
  },
];

// The CSS forces every SVG to the exact output pixel size regardless of its
// own `viewBox`, so one page shape works for the 1024-viewBox app icon, the
// 512-viewBox public icon, and the synthesized 1024-viewBox mark wrappers.
function pageHtml(svgMarkup, size) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent;}
    svg{display:block;width:${size}px;height:${size}px;}
  </style></head><body>${svgMarkup}</body></html>`;
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const target of targets) {
    await page.setViewportSize({ width: target.size, height: target.size });
    await page.setContent(pageHtml(target.svg, target.size));
    await page.waitForTimeout(30);
    const outPath = path.join(ROOT, target.out);
    await page.screenshot({
      path: outPath,
      omitBackground: target.transparent,
    });
    console.log(
      `wrote ${target.out} (${target.size}x${target.size}, transparent=${target.transparent})`,
    );
  }
} finally {
  await browser.close();
}
