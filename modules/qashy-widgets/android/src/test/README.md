# Widget screenshot tests

JVM tests (Robolectric with native graphics) that render the Quick add and Budget widgets' Glance
content to PNGs and fail when text is clipped or a view sticks out of the widget. They are not part
of the app and not part of `npm test`.

They cover every launcher size (1x1, 2x1, 3x1, 4x1, 5x1, 2x2, 3x2, 4x2, 4x3), English (LTR) and
Hebrew (RTL), light and dark, with normal and awkward data (long names, seven-figure amounts,
over-budget at 130% and 250%, hidden amounts, empty states), plus the picker previews.

## Run

From a generated Android project (the module is autolinked into it):

```bash
npx expo prebuild -p android --no-install --clean
cd android
./gradlew :qashy-widgets:testDebugUnitTest -PreactNativeArchitectures=arm64-v8a
```

PNGs land in `modules/qashy-widgets/android/build/outputs/widget-screenshots/`: one per case
(`<kind>_<scenario>_<size>_<lang>_<mode>.png`) and a contact sheet per scenario under `sheets/`.
Robolectric downloads its Android 14 jar on the first run, so the first run needs network access.

## Fidelity

Layout, text measurement and clipping, images, tints, day/night colors and RTL mirroring are the
framework's own code on the exact pixel size of each breakpoint, so what clips here clips on a
device. Glyphs come from Robolectric's fonts, the launcher's rounded corner clipping and the real
wallpaper are not reproduced, and a device font may be a little wider or narrower than the
fonts here (the layouts measure text with a small margin for that).

The device-case test renders USD amounts of -$57,306.00 at several font scales (including a wider-glyph emulation) and fails on any ellipsized amount, clipping, or full and compact amounts mixed in one widget. At a 130% font scale only the amount rules are enforced; three lines cannot fit a two-row widget there.
