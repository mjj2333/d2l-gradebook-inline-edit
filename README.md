# D2L Gradebook Inline Edit — Browser Extension

A Chrome/Edge browser extension that adds **double-click inline editing** to the D2L Standard Gradebook view at sd63.onlinelearningbc.com. Converted from Tampermonkey v8.11 — no Tampermonkey required.

---

## Features

- Double-click any grade cell to edit it inline
- Supports fraction grades (numerator only) and Final Adjusted Grades (numerator + denominator)
- Pending changes highlighted in yellow until saved
- Batch save via RPC — saves all changes in one go then reloads
- Cancel button restores all cells to their original state

---

## File Structure

```
d2l-gradebook-inline-edit/
├── manifest.json       ← extension config
├── content/
│   └── main.js         ← full script logic
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## Installation

### Chrome / Edge (Developer Mode)

1. **Download** this repo (Code → Download ZIP and unzip, or `git clone`)
2. Open **chrome://extensions** (or **edge://extensions**)
3. Toggle **Developer mode** on
4. Click **Load unpacked** → select the `d2l-gradebook-inline-edit` folder
5. Navigate to the D2L gradebook — the script activates automatically

### Keeping it updated

```bash
git pull
```
Then click **↻** reload on the extension card.

---

## Network Drive Deployment

Place this folder on a shared network drive. Each user loads it once via **Load unpacked**. When you update the files (e.g. via `git pull` to the network folder), users just click **↻** to reload — no reinstall needed.

---

## Pushing to GitHub (first time)

```bash
cd d2l-gradebook-inline-edit
git init && git add . && git commit -m "Initial commit: D2L Gradebook Inline Edit v8.11" && git branch -M main && git remote add origin https://github.com/mjj2333/d2l-gradebook-inline-edit.git && git push -u origin main
```

### Future updates

```bash
git add . && git commit -m "Describe changes" && git push
```

---

## Version History

| Version | Change |
|---|---|
| 8.11 | Fixed shadow DOM event routing, userId selector, style restore |
| 8.10 | Fixed userId function name (gotoGradeUserGroupSectionFilter) |
| 8.9  | Fixed shadow root timing with customElements.whenDefined |
| 8.8  | Switched to shadow root event listener via composedPath() |
| 8.7  | Fixed header rows moved from tbody to thead |
