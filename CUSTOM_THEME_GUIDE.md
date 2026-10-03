# Custom theme guide

This guide shows you how to write your own Qashy theme as a small JSON file, import it, switch to it, export it and delete it. You do not need to be a programmer, but you do need to be comfortable editing a text file with braces and quotes.

## What a theme is

A theme is the whole look of the app: colors, corner roundness, spacing, how raised or flat surfaces feel, the typeface, button press animation, the icon style and chart styling. Every theme has a light version and a dark version.

A custom theme is just data. It is a JSON file that picks values from fixed lists and ranges. It cannot contain code, links or images, and Qashy never downloads anything for it. Your theme is stored on the device you imported it on and nowhere else (see [Privacy](#privacy)).

## Quick start

1. Copy the minimal example below into a file named `forest-minimal.json` (any name ending in `.json` works).
2. In Qashy open **More > Appearance > Theme** and choose **Import theme**. Pick the file.
3. Your theme now appears in the theme list. Choose it to switch to it.
4. Edit the file, change the `id` if you want to keep both versions or keep the same `id` to update it, and import again.

The smallest valid theme only has to say who it is and give at least one color for light and one for dark. Everything you leave out is inherited from the built-in **Classic** theme.

<!-- valid -->
```json
{
  "themeSchemaVersion": 1,
  "id": "forest-minimal",
  "name": "Forest Minimal",
  "palette": {
    "light": {
      "background": "#EEF3EC",
      "surface": "#FFFFFF"
    },
    "dark": {
      "background": "#0D120E",
      "surface": "#161D17"
    }
  }
}
```

## File format

A theme file is one JSON object. The first field is always the format version:

```jsonc
{ "themeSchemaVersion": 1 }
```

`themeSchemaVersion` must be exactly `1`. Future versions of Qashy that change the format will use a new number, and files with a number the app does not know are rejected rather than guessed at.

Rules that apply to the whole file:

- The file must be valid JSON: double quotes around every key and every text value, no comments, no trailing commas.
- Every key must be one this guide lists. An unknown key anywhere (top level or nested) is an error. This is on purpose, so a typo such as `"raduis"` is reported instead of silently ignored.
- The whole file, written as compact JSON, must be at most 16 KB (16,384 characters).
- If anything is wrong, the whole file is rejected and nothing changes. You always get every problem at once, each with the path of the field.

## Every field

Colors are always written as `#RRGGBB` (a hash and exactly six hex digits, upper or lower case). Short forms such as `#FFF`, names such as `red`, and `rgb(...)` are not accepted.

"Inherits" means: if you leave the field out, the value comes from the theme named in `extends` (Classic if you did not name one).

### Top level

| Field | Type | Allowed values | Default / inheritance | Required |
|---|---|---|---|---|
| `themeSchemaVersion` | number | exactly `1` | none | yes |
| `id` | text | lowercase letters, digits and hyphens, starts with a letter or digit, 1 to 48 characters. Must not be a built-in theme id (`classic`, `material-you`, `high-contrast`) | none | yes |
| `name` | text | 1 to 40 characters, no control or text-direction characters | none | yes |
| `extends` | text | a built-in theme id: `classic`, `material-you`, `high-contrast` | `classic` | no |
| `palette` | object | has `light` and `dark`, see below | inherits per color | yes |
| `accent` | object | see below | inherits | no |
| `shape` | object | see below | inherits | no |
| `material` | object | see below | inherits | no |
| `motion` | object | see below | inherits | no |
| `type` | object | see below | inherits | no |
| `icons` | object | see below | inherits | no |
| `charts` | object | see below | inherits | no |

The `id` is the theme's permanent identity on your device. Importing a file whose `id` matches a theme you already imported updates that theme instead of adding a second one.

### `palette` (required, both schemes)

`palette` must contain both `light` and `dark`, and each must set at least one color. See [Both light and dark](#both-light-and-dark-are-required).

Each of `palette.light` and `palette.dark` is an object whose keys are any of the following. All values are `#RRGGBB`. Any key you leave out inherits the same key of the same scheme from the `extends` theme.

| Key | What it colors |
|---|---|
| `background` | The page behind everything |
| `surface` | Cards and sections |
| `surfaceElevated` | Raised layers such as sheets and menus |
| `surfaceMuted` | Quiet fills, chips, inactive areas |
| `surfaceSunken` | Wells: progress tracks, input fields, segmented-control tracks |
| `text` | Main text. Must read clearly on `surface`, `surfaceElevated` and `background` |
| `textMuted` | Secondary text. Must read clearly on `surface` |
| `border` | Outlines and dividers |
| `positive` | Income and good news. Must be visible on `surface` |
| `negative` | Expenses and bad news. Must be visible on `surface` |
| `warning` | Warnings. Must be visible on `surface` |
| `transfer` | Transfers between accounts (neither income nor expense) |

### `accent`

The accent is the color of buttons, selected items and highlights. Whatever you pick, Qashy adjusts it per scheme at display time so it stays visible on the surface, and chooses readable text for the inside of accent buttons.

| Field | Type | Allowed values | Default |
|---|---|---|---|
| `accent.mode` | text | `"user"` (the person using the theme picks an accent on the Appearance screen) or `"fixed"` (the theme owns its accent and the picker is hidden). `"system"` is not allowed in custom themes | inherited from the base theme; `"user"` if the base uses `"system"` |
| `accent.default` | color | `#RRGGBB` | the base theme's default accent |
| `accent.presets` | list of colors | 0 to 12 colors, each `#RRGGBB`. These are the swatches offered in the picker | the base theme's presets |

### `shape`

All numbers are in density-independent pixels. Any key you leave out inherits from the base theme. Classic values are shown as the defaults.

`shape.radius` (corner roundness, 0 is square):

| Key | Used for | Range | Classic default |
|---|---|---|---|
| `sm` | small elements | 0 to 64 | 10 |
| `control` | buttons and inputs | 0 to 64 | 14 |
| `tile` | icon tiles and swatches | 0 to 64 | 14 |
| `card` | cards | 0 to 64 | 22 |
| `sheet` | floating panels | 0 to 64 | 28 |
| `nav` | navigation items | 0 to 64 | 16 |
| `pill` | fully round shapes | 0 to 999 | 999 |

`shape.space` (the spacing ladder; each step 0 to 48):

| Key | Classic default |
|---|---|
| `xxs` | 2 |
| `xs` | 4 |
| `sm` | 8 |
| `md` | 12 |
| `lg` | 16 |
| `xl` | 20 |
| `xxl` | 24 |
| `xxxl` | 32 |

`shape.tile` (the square holding a category or account icon):

| Key | Meaning | Range | Classic default |
|---|---|---|---|
| `size` | normal tile | 32 to 64 | 40 |
| `icon` | glyph inside it, must not be larger than `size` | 12 to 40 | 20 |
| `compactSize` | tile in dense lists | 28 to 48 | 32 |
| `compactIcon` | glyph inside it, must not be larger than `compactSize` | 12 to 32 | 16 |

### `material`

Controls how surfaces are built. See [Shadows and materials](#shadows-and-materials-soft-vs-bevel).

| Field | Type | Allowed values | Default |
|---|---|---|---|
| `material.engine` | text | `"soft"` or `"bevel"` | the base theme's engine (`soft` for Classic) |
| `material.gradients` | true or false | `true` or `false` | the base theme's setting (`true` for Classic) |
| `material.bevelDepth` | whole number | 1 to 4. Only used when the engine is `bevel` | the base theme's depth if it is also bevel, otherwise 2 |

### `motion`

| Field | Type | Allowed values | Default |
|---|---|---|---|
| `motion.press` | text | `"scale"` (pressed controls shrink slightly) or `"translate"` (they move down a few pixels) | base theme (`scale` for Classic) |
| `motion.pressScale` | number | 0.9 to 1. Must be below 1 when `press` is `"scale"` | 0.97 when switching to `scale`, otherwise the base theme's value |
| `motion.pressTranslate` | number | 0 to 8. Must be at least 1 when `press` is `"translate"` | 2 when switching to `translate`, otherwise the base theme's value |
| `motion.durationScale` | number | 0.5 to 2. Multiplies the base theme's animation durations: below 1 is snappier, above 1 is slower | 1 |

Qashy still respects the device's reduced-motion setting whatever you write here.

### `type`

| Field | Type | Allowed values | Default |
|---|---|---|---|
| `type.text.family` | text | a font id, see [Fonts](#fonts) | the base theme's text font |
| `type.numeric.family` | text | a font id. Used for digits and money amounts | the base theme's numeric font |

Each is an object with a single key, `family`. You cannot change font sizes or weights, only the typeface.

### `icons`

| Field | Type | Allowed values | Default |
|---|---|---|---|
| `icons.set` | text | `"ionicons"` or `"pixel"`, see [Icon sets](#icon-sets) | the base theme's set |

### `charts`

| Field | Type | Allowed values | Default |
|---|---|---|---|
| `charts.patterns` | true or false | `true` adds hatch and dot patterns so chart series differ by more than color | base theme (`false` for Classic) |
| `charts.lineWidth` | number | 1 to 6. Stroke of trend lines; sparklines use half a point less (never below 1) | base theme (2.5 for Classic) |
| `charts.donutThickness` | number | 8 to 32 | base theme (16 for Classic) |
| `charts.gridDash` | text | up to four whole numbers of 1 or 2 digits separated by single spaces, such as `"4 4"` or `"2 2 6"`, or `""` for solid lines | base theme (`"4 4"` for Classic) |
| `charts.lineCap` | text | `"round"`, `"butt"` or `"square"` | base theme (`round` for Classic) |
| `charts.categoryPalette` | list of colors | 6 to 12 colors, each `#RRGGBB`. Suggested colors for NEW categories and accounts; existing ones keep their stored colors | the base theme's palette |

## Both light and dark are required

Every Qashy theme has a light and a dark version, and a custom theme must say so. `palette.light` and `palette.dark` must both be present and each must set at least one color. A file with only a light palette is rejected, because otherwise dark mode (or anyone whose device is set to dark) would get colors you never chose.

If you want a theme that looks the same in both modes, write the same colors twice. You do not have to list all twelve colors in each: just the ones you want to change, and the rest come from the base theme.

<!-- invalid -->
```json
{
  "themeSchemaVersion": 1,
  "id": "light-only",
  "name": "Light Only",
  "palette": {
    "light": { "background": "#EEF3EC", "surface": "#FFFFFF" }
  }
}
```

## How `extends` works

`extends` names a built-in theme to start from: `classic`, `material-you`, or `high-contrast`. If you leave it out, the base is `classic`.

Qashy builds your theme in three steps:

1. Start from every value of the base theme.
2. Replace each value you wrote. Within `palette.light` and `palette.dark`, `shape.radius`, `shape.space` and `shape.tile`, each key is replaced on its own, so you can change a single color or a single corner radius and keep the rest.
3. Check and adjust contrast (next section).

Extra details:

- A custom theme can only extend a built-in theme. Extending another custom theme is not allowed (so a theme never depends on a file that may have been deleted).
- Colors are inherited per scheme: your `palette.light` only changes the light scheme, and `palette.dark` only the dark one.
- If the base has hard-edged bevel shadows and you choose `"soft"`, you get the neutral Classic soft shadows. If the base is `high-contrast`, the outline rings are redrawn in your colors.

<!-- valid -->
```json
{
  "themeSchemaVersion": 1,
  "id": "night-ink",
  "name": "Night Ink",
  "extends": "high-contrast",
  "palette": {
    "light": { "background": "#FAF7F0" },
    "dark": { "background": "#05070D" }
  }
}
```

## Contrast clamping

Text that is too faint to read would make money unreadable, so Qashy does not trust a theme to get contrast right. Colors are checked after your values are merged on top of the base theme, separately for light and for dark:

| Color | Must reach | Against |
|---|---|---|
| `text` | 4.5:1 | `surface`, `surfaceElevated` and `background` |
| `textMuted` | 4.5:1 | `surface` |
| `positive`, `negative`, `warning` | 3:1 | `surface` |

If a color is too faint, it is not rejected. It is moved toward a readable shade (lighter or darker, whichever helps) just far enough, and a warning is shown after import. Your file is stored exactly as you wrote it; the correction is applied when the theme is drawn.

The warnings look like this, one per changed color:

<!-- valid -->
```json
{
  "themeSchemaVersion": 1,
  "id": "pale-demo",
  "name": "Pale Demo",
  "palette": {
    "light": { "textMuted": "#AAAAAA", "positive": "#9FE0B0" },
    "dark": { "background": "#101010" }
  }
}
```

<!-- warnings -->
```text
palette.light.textMuted changed from #AAAAAA to #767678 to keep 4.5:1 contrast against surface
palette.light.positive changed from #9FE0B0 to #739F80 to keep 3:1 contrast against surface
```

The exact replacement shades depend on your other colors. If your colors make it impossible to reach the minimum at all (for example one `text` color that has to read on a very light `surface` and a very dark `background` at once), the theme is rejected with a message starting `palette.<scheme>.<color>: cannot reach` and you need to change the colors yourself.

The accent is handled separately: it is lifted per scheme so it stays visible on the surface (at least 3:1), and text drawn on accent buttons is chosen automatically to be readable.

## What is not allowed, and why

A theme file may only hold choices from fixed lists and ranges. Not allowed:

- Code or scripts of any kind.
- Web addresses (`http://`, `https://`, `//example.com/...`), `url(...)`, `@import`, and data URIs (`data:...`). Qashy is a private app that does not fetch content from the internet for themes, and a link in a file you received from someone else could otherwise be used to track you.
- Remote or embedded fonts, images or textures. Fonts and icon sets can only be chosen from the ones that ship inside the app.
- Raw shadow strings. Shadows are derived from your palette and the `material` choice, which guarantees that they match the colors and that hard-edged themes stay hard-edged.
- Extending a custom theme (only built-in themes can be extended).
- The accent mode `"system"` (that is reserved for the Android Material You theme).
- Unknown keys, wrong types, and numbers outside the stated ranges.

Qashy looks for suspicious text in every value and every key of the file, wherever it sits, and rejects the whole file if it finds any.

<!-- invalid -->
```json
{
  "themeSchemaVersion": 1,
  "id": "sneaky",
  "name": "https://example.com/tracker.png",
  "palette": {
    "light": { "background": "#EEF3EC" },
    "dark": { "background": "#0D120E" }
  }
}
```

## Fonts

A theme chooses a typeface by its id from the fonts bundled with Qashy. These are the only ids accepted by `type.text.family` and `type.numeric.family`:

| Id | Typeface | Covers | Notes |
|---|---|---|---|
| `rubik` | Rubik | English and Hebrew | Classic's text font |
| `space-grotesk` | Space Grotesk | English only | Classic's font for digits and money |
| `pixelify-sans` | Pixelify Sans | English only | Pixel look |

Qashy supports Hebrew, and only Rubik has Hebrew letters. So whenever you pick a font other than `rubik`, Qashy automatically adds Rubik as a fallback: English letters and digits use your font, and Hebrew text is drawn in Rubik. You do not need to do anything for this, and you cannot remove it.

All bundled fonts are open-license fonts that ship inside the app and work offline.

## Icon sets

`icons.set` decides how category and account icons are drawn on this device.

| Id | Look |
|---|---|
| `ionicons` | The standard outline icons |
| `pixel` | Chunky pixel-art icons |

The icon you chose for an account or category is part of your data and is the same on all your devices. A theme only changes how it is drawn here. Emoji icons are always drawn as the emoji. An icon the chosen set does not have is drawn in the standard style instead of showing an empty box.

## Shadows and materials (soft vs bevel)

You never write shadows yourself. You pick a material engine, and Qashy derives all shadows from your colors.

- **`soft`** (the Classic look): surfaces have blurred, gentle shadows and a faint highlight on the top edge, so cards look softly raised and inputs look slightly pressed in. With `"gradients": true` a subtle gradient is layered on surfaces and accent buttons.
- **`bevel`** (the hard-edged pixel look): there is no blur anywhere. Every surface gets a crisp light edge on the top left, a dark edge on the bottom right and a solid drop edge below it, like a chunky pixel block. `bevelDepth` is the thickness of those edges in pixels (1 to 4; 2 is a good start). Pressing a bevel control flips the light and dark edges so it looks pushed in. Bevel looks best with `"gradients": false`, square corners (`shape.radius` all 0) and `"press": "translate"`.

## Importing, switching, exporting and deleting

All of this is on **More > Appearance**.

**Import**

1. Open **Theme**. The list shows the built-in themes followed by your custom themes.
2. Choose **Import theme** and pick a `.json` file from your device.
3. If the file is invalid, it is rejected as a whole. You see a list of errors, each starting with the path of the problem (for example `palette.dark: must be an object`), and nothing changes. Fix the file and import it again.
4. If the file is valid but some colors were too faint, the theme is imported and you see the contrast warnings described above.
5. You can have at most 8 custom themes. If you already have 8, delete one first.

**Switch**: tap a theme in the list. The change applies on this device only.

**Export**: on a custom theme, choose **Export** to save it as a `.json` file you can edit or share. The exported file is your original theme (tidied into a standard key order), not the contrast-corrected version.

**Delete**: on a custom theme, choose **Delete**. If the theme you delete is the one in use, Qashy switches back to Classic. Built-in themes cannot be deleted or exported.

## When a theme is broken or missing

Qashy never shows a half-working theme. If the selected theme cannot be found, or the stored copy of a custom theme no longer passes validation, it is dropped from the list and the app uses Classic. Nothing crashes and your financial data is unaffected. A theme id that your device does not have (for example, after a theme was deleted) also resolves to Classic.

## Limits

- 16 KB per theme file.
- 8 custom themes at a time.
- Nesting deeper than 8 levels is rejected.
- Only the bundled fonts and icon sets listed above.

## A complete example

This file uses every section: a pixel look with a pixel font, pixel icons, square corners, hard bevels, press-by-moving, and custom charts.

<!-- valid -->
```json
{
  "themeSchemaVersion": 1,
  "id": "moss-block",
  "name": "Moss Block",
  "extends": "classic",
  "palette": {
    "light": {
      "background": "#D5DDC4",
      "surface": "#EAF0DC",
      "surfaceElevated": "#F4F8EA",
      "surfaceMuted": "#DCE5CB",
      "surfaceSunken": "#CCD6B8",
      "text": "#1F2A14",
      "textMuted": "#475736",
      "border": "#475736",
      "positive": "#2F6B1E",
      "negative": "#A52A22",
      "warning": "#7F5200",
      "transfer": "#2C5C9A"
    },
    "dark": {
      "background": "#10160B",
      "surface": "#1B2412",
      "surfaceElevated": "#242F18",
      "surfaceMuted": "#2D3A1F",
      "surfaceSunken": "#0B1007",
      "text": "#E9F2D8",
      "textMuted": "#B3C49A",
      "border": "#6F8552",
      "positive": "#8FD35A",
      "negative": "#FF8F82",
      "warning": "#F0C050",
      "transfer": "#86B4F0"
    }
  },
  "accent": {
    "mode": "user",
    "default": "#4C9A2A",
    "presets": [
      "#4C9A2A",
      "#2F6F8F",
      "#B5651D",
      "#A33B2E",
      "#6B4E9B"
    ]
  },
  "shape": {
    "radius": {
      "sm": 0,
      "control": 0,
      "tile": 0,
      "card": 0,
      "sheet": 0,
      "nav": 0,
      "pill": 0
    },
    "space": {
      "xxs": 2,
      "xs": 4,
      "sm": 8,
      "md": 12,
      "lg": 16,
      "xl": 20,
      "xxl": 24,
      "xxxl": 32
    },
    "tile": {
      "size": 40,
      "icon": 20,
      "compactSize": 32,
      "compactIcon": 16
    }
  },
  "material": {
    "engine": "bevel",
    "gradients": false,
    "bevelDepth": 2
  },
  "motion": {
    "press": "translate",
    "pressTranslate": 2,
    "durationScale": 0.8
  },
  "type": {
    "text": {
      "family": "pixelify-sans"
    },
    "numeric": {
      "family": "pixelify-sans"
    }
  },
  "icons": {
    "set": "pixel"
  },
  "charts": {
    "patterns": true,
    "lineWidth": 3,
    "donutThickness": 18,
    "gridDash": "2 2",
    "lineCap": "butt",
    "categoryPalette": [
      "#5E8C31",
      "#B5651D",
      "#3E7CB1",
      "#8E5BA8",
      "#C0392B",
      "#C9A227",
      "#2E8B7A",
      "#7A6A58"
    ]
  }
}
```

## Troubleshooting

Each error starts with the path of the problem. Find the part of your message that matches the first column.

| Message contains | What it means | How to fix it |
|---|---|---|
| `themeSchemaVersion: must be` | The version is missing or not `1` | Add `"themeSchemaVersion": 1` as a number, not text |
| `id: must be lowercase letters, digits and hyphens` | The `id` has capitals, spaces, symbols, or is too long | Use something like `"forest-night"`, up to 48 characters |
| `is a built-in theme id; choose another` | The `id` is `classic`, `material-you`, or `high-contrast` | Pick your own `id` |
| `name: must be 1 to 40 characters` | The name is empty or too long | Use a short name |
| `name: must not contain control or direction-override characters` | The name has hidden formatting characters | Retype the name with plain letters |
| `custom themes cannot extend custom themes` | `extends` is not a built-in theme id | Use `classic`, `material-you`, or `high-contrast`, or leave `extends` out |
| `must be an object` | A section is the wrong kind of value, for example `"palette": "dark"` or `palette.dark` is missing | Write it as an object with braces. Both `palette.light` and `palette.dark` must exist |
| `must define at least one color` | A scheme in `palette` is empty (`{}`) | Give `light` and `dark` at least one color each |
| `unknown key (allowed:` | A key is misspelled or does not exist | Compare with the lists in this guide; the message lists the allowed keys |
| `must be a #RRGGBB color` | A color is not a six-digit hex code | Use a form like `"#1A2B3C"`, with the hash and six digits |
| `must be a list of` | A list of colors has the wrong number of entries or is not a list | Use `[ ... ]`: 0 to 12 for `accent.presets`, 6 to 12 for `charts.categoryPalette` |
| `a number` | A number is missing, is text in quotes, or is outside its range. For example `shape.radius.card: must be a number from 0 to 64` | Write a plain number without quotes inside the stated range |
| `an integer` | A whole number is required. For example `material.bevelDepth: must be an integer from 1 to 4` | Use 1, 2, 3 or 4 |
| `must be one of` | The value is not one of the choices. Used for `material.engine`, `motion.press`, `charts.lineCap`, `type.*.family` and `icons.set` | Pick from the lists in this guide; the message shows the allowed values |
| `must be true or false` | A switch has quotes or another value | Write `true` or `false` without quotes |
| `must be up to four numbers separated by spaces` | `charts.gridDash` is malformed | Use `"4 4"`, `"2 2"` or `""` for solid |
| `is not allowed for custom themes` | `accent.mode` was set to `"system"` | Use `"user"` or `"fixed"` |
| `must not contain a URL, data URI or script` | Some value or key looks like a web address, `data:` URI, `url(...)` or script | Remove it. Themes cannot load anything from outside |
| `must not be larger than shape.tile.size` | `shape.tile.icon` is bigger than `shape.tile.size` | Make `icon` smaller or `size` bigger. The same applies to `compactIcon` and `compactSize` |
| `must be at least 1 when motion.press` | `press` is `"translate"` but `pressTranslate` is below 1 | Set `pressTranslate` between 1 and 8 |
| `must be below 1 when motion.press` | `press` is `"scale"` but `pressScale` is 1 | Set `pressScale` between 0.9 and 0.99 |
| `cannot reach` | A text or status color cannot reach the minimum contrast against the surfaces you chose | Make the surfaces lighter or darker so they differ more from the text |
| `theme file is too large` | The file is over 16 KB | Remove lists and sections you do not need |
| `nested too deeply` | The file has objects nested more than 8 levels | Flatten the structure to match the format in this guide |

If the file is not valid JSON at all (a missing comma or quote), the import fails before any of the checks above and nothing changes. A JSON checker such as the one built into a code editor will point to the line.

## Privacy

Custom themes stay on the device where you imported them. They are not part of the settings that Qashy syncs between your devices, so a theme you add on your phone does not appear on your laptop (import the file there too). They are never uploaded anywhere and are never stored in the offline web cache. They leave the device only inside a backup file that you explicitly create, or when you export a theme yourself. Qashy fetches nothing from the internet for a theme.
