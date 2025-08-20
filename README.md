# Fake Form Filler (Chrome Extension)

Fills forms on any page with realistic dummy data (Faker.js). Built for fast testing.

## Install

1. Open `chrome://extensions/`
2. Toggle "Developer mode"
3. Click "Load unpacked" and select this folder

## Use

- Click the extension → "Fill Forms"
- Right‑click a page/field → "Fill current form" / "Fill this field"
- Shortcut: `Ctrl+Shift+F` (Mac: `Command+Shift+F`)
- "Clear Forms" removes filled values

## What it supports

- Inputs, textareas, selects, radios, checkboxes
- Smart detection of common field types (email, name, phone, address, etc.)
- Works across most sites and frameworks

## Key files

- `manifest.json` – Extension config (MV3)
- `background/background.js` – Service worker, context menu, shortcut
- `content/content.js` – Form detection + filling logic
- `popup/` – Small UI to scan/fill/clear
