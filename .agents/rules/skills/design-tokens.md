---
name: design-tokens
description: Runbook for converting design tokens from Figma Tokens JSON into CSS custom properties, modular stylesheets, and JS dictionaries while enforcing the Two-Tier color architecture.
---

# Skill: Design System Token Conversion & Architecture

Use this skill when updating design tokens from Figma, modifying `design-tokens.tokens.json`, regenerating CSS variables, adding typography or spacing styles, or testing UI theme integration.

## 1. Architectural Color Rules (Two-Tier System)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       TIER 1: PRIMITIVES (FOUNDATIONS)                     │
│               Raw Brand Colors & 0–100 Tonal Palette Stops                  │
│             Namespace: --primitive-color-* (e.g., primary-40, neutral-90)   │
│                                                                             │
│                  🛑 RULE: NEVER USE DIRECTLY ON THE UI                      │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       │ feeds into
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     TIER 2: COLOR ROLES (SEMANTIC UI)                       │
│              Functional Tokens (Primary, On-Primary, Surface, Error)        │
│                Namespace: --color-role-* and --color-*                      │
│                                                                             │
│                    ✅ RULE: ALWAYS USE ON THE UI                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **Primitives (`--primitive-color-*`):** Foundation palettes only. Never apply directly to UI component styles.
- **Color Roles (`--color-role-*` / `--color-*`):** Semantic tokens applied to all UI elements. Each role references its primitive foundation via `var(--primitive-color-*, fallback)`.

---

## 2. Token Generation Commands

Execute the converter script `convert-tokens.js`:

```bash
# Generate primary design-tokens.css bundle
node convert-tokens.js

# Generate split modular stylesheets and JS/JSON exports in dist/
node convert-tokens.js --split

# Generate with rem units (16px base)
node convert-tokens.js --rem --output design-tokens.rem.css

# Or use npm script shortcuts
npm run tokens
npm run build:tokens
npm run build:rem
```

---

## 3. Generated Artifacts Reference

| Output File | Contents |
| :--- | :--- |
| `design-tokens.css` | Unified production bundle containing all tokens and utility classes. |
| `dist/tokens-color-roles.css` | 28 Semantic UI color roles (`--color-*` & `--color-role-*`). |
| `dist/tokens-primitives.css` | 90 Foundational color palette stops (`--primitive-color-*`). |
| `dist/tokens-typography.css` | 15 DM Sans typography styles and font shorthands (`--typography-*`). |
| `dist/tokens-spacing.css` | 8-stop spacing scale (0–32px) with t-shirt aliases (`--spacing-*`). |
| `dist/tokens-effects.css` | Multi-layer elevation box-shadow levels (`--shadow-*`). |
| `dist/tokens-utilities.css` | Ready-to-use utility classes (`.type-*`, `.shadow-*`). |
| `dist/tokens.js` | Universal JS module (ESM & CJS) for React, React Native, or Tailwind. |
| `dist/tokens.resolved.json` | JSON dictionary of all resolved tokens with reference paths. |

---

## 4. Token Test Suite Verification

Run the automated token test suite to verify that all references resolve cleanly and naming invariants are intact:

```bash
npm test
```

### Assertions Checked by `test/convert-tokens.test.js`
- Exactly 90 primitive foundation tokens exist under `--primitive-color-*`.
- Exactly 28 color roles exist and resolve 100% cleanly to existing primitive variables.
- All 8 spacing tokens have valid pixel dimensions and aliases.
- All 15 typography styles have DM Sans metrics and valid font shorthands.
- All 3 shadow styles produce valid CSS box-shadow strings.
- All 8 generated build artifacts exist with architectural warnings included.

---

## 5. Visual Preview and Inspection

Open `index.html` in any browser to launch the interactive Token Explorer. Use it to:
- Inspect swatches for all 28 Color Roles and 90 Primitives.
- Copy CSS variable names with one click.
- Review typography scales rendered live with Google Fonts DM Sans.
- Inspect sample buttons, cards, and banners built strictly with Color Roles.
