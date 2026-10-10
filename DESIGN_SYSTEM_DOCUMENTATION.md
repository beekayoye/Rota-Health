# Rota Health Design System — Architecture & Token Guide

Welcome to the **Rota Health Design System** documentation. This guide details the token conversion pipeline, token architecture, developer rules of engagement, and component styling patterns.

---

## 🏛 1. Core Architecture: The Two-Tier Color System

The most fundamental architectural principle of this design system is the **separation of Color Foundations (Primitives) from Semantic UI Roles**.

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
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       │ applied to
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           UI COMPONENTS & VIEWS                             │
│                  Buttons, Cards, Dialogs, Inputs, Navigation                │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Why This Separation is Essential

| Feature | Primitive Colors (`--primitive-color-*`) | Color Roles (`--color-role-*` / `--color-*`) |
| :--- | :--- | :--- |
| **Purpose** | Brand palette definition (palette spectrum 0–100) | Semantic UI application (intent & role) |
| **Consumer** | Design System architects & theme definitions | Frontend engineers building UI components |
| **Allowed in UI CSS?** | 🛑 **NO.** Strictly prohibited in component styles | ✅ **YES.** The required standard for all UI |
| **Theme Agility** | Fixed values per palette | Dynamically adapts for Dark Mode, High Contrast, etc. |
| **Example** | `--primitive-color-primary-40: #004bccff;` | `--color-primary: var(--primitive-color-key-primary);` |

### The "Why Not Primitives?" Rule

When you write:
```css
/* ❌ ANTI-PATTERN: DO NOT DO THIS */
.card {
  background-color: var(--primitive-color-neutral-98);
  color: var(--primitive-color-neutral-10);
  border: 1px solid var(--primitive-color-primary-40);
}
```
**What breaks?**
1. **Dark Mode Breaks:** When the user switches to dark mode, `--primitive-color-neutral-98` is still nearly pure white (`#f9fafb`), blinding the user.
2. **Accessibility Breaks:** WCAG AAA contrast guarantees between surface and on-surface text are lost.
3. **Re-theming is Impossible:** Updating a brand key color requires hunting down dozens of hardcoded primitive variable names across hundreds of component files.

Instead, write:
```css
/* ✅ CORRECT PATTERN: ALWAYS DO THIS */
.card {
  background-color: var(--color-surface);
  color: var(--color-on-surface);
  border: 1px solid var(--color-surface-variant);
}
```
**Why this works:**
- In Light Mode: `--color-surface` automatically resolves to `--primitive-color-neutral-98`.
- In Dark Mode: `--color-surface` can effortlessly be remapped to `--primitive-color-neutral-10`.
- The UI code remains completely untouched and future-proof!

---

## 🎨 2. Semantic Color Roles Catalog (28 Tokens)

All 28 semantic color roles are mapped to their foundational primitives with automatic hex fallbacks:

### Primary Palette Roles (Interactive & Brand Anchor)
| Token Name | UI CSS Variable | Role CSS Variable | Foundational Primitive Reference | Hex Fallback | Recommended UI Usage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `primary` | `--color-primary` | `--color-role-primary` | `var(--primitive-color-key-primary)` | `#004ed4ff` | Primary CTA buttons, active tabs, main brand highlights |
| `on primary` | `--color-on-primary` | `--color-role-on-primary` | `var(--primitive-color-primary-100)` | `#ffffffff` | Text and icons placed on top of `primary` |
| `primary container` | `--color-primary-container` | `--color-role-primary-container` | `var(--primitive-color-primary-90)` | `#ccdfffff` | Tonal badge backgrounds, selected list item fills |
| `on primary container` | `--color-on-primary-container` | `--color-role-on-primary-container` | `var(--primitive-color-primary-30)` | `#003899ff` | Text and icons placed inside `primary container` |

### Secondary Palette Roles (Supporting Accents)
| Token Name | UI CSS Variable | Role CSS Variable | Foundational Primitive Reference | Hex Fallback | Recommended UI Usage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `secondary` | `--color-secondary` | `--color-role-secondary` | `var(--primitive-color-key-secondary)` | `#003eaaff` | Secondary action buttons, secondary filter chips |
| `on secondary` | `--color-on-secondary` | `--color-role-on-secondary` | `var(--primitive-color-secondary-100)` | `#ffffffff` | Text and icons on top of `secondary` |
| `secondary container` | `--color-secondary-container` | `--color-role-secondary-container` | `var(--primitive-color-secondary-90)` | `#d6e5ffff` | Subtle secondary pills, callout containers |
| `on secondary container` | `--color-on-secondary-container` | `--color-role-on-secondary-container` | `var(--primitive-color-secondary-30)` | `#003eaaff` | Text and icons inside `secondary container` |

### Tertiary Palette Roles (Accent Highlights)
| Token Name | UI CSS Variable | Role CSS Variable | Foundational Primitive Reference | Hex Fallback | Recommended UI Usage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `tertiary` | `--color-tertiary` | `--color-role-tertiary` | `var(--primitive-color-key-tertiary)` | `#005efeff` | Accent elements, notifications, progress meters |
| `on tertiary` | `--color-on-tertiary` | `--color-role-on-tertiary` | `var(--primitive-color-tertiary-100)` | `#ffffffff` | Text and icons on top of `tertiary` |
| `tertiary container` | `--color-tertiary-container` | `--color-role-tertiary-container` | `var(--primitive-color-tertiary-90)` | `#ccdfffff` | Accent card backgrounds, tertiary status badges |
| `on tertiary container` | `--color-on-tertiary-container` | `--color-role-on-tertiary-container` | `var(--primitive-color-tertiary-30)` | `#003999ff` | Text and icons inside `tertiary container` |

### Error & Feedback Roles
| Token Name | UI CSS Variable | Role CSS Variable | Foundational Primitive Reference | Hex Fallback | Recommended UI Usage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `error` | `--color-error` | `--color-role-error` | `var(--primitive-color-key-error)` | `#c51707ff` | Destructive action buttons, validation error outlines |
| `on error` | `--color-on-error` | `--color-role-on-error` | `var(--primitive-color-error-100)` | `#ffffffff` | Text and icons placed on top of `error` |
| `error container` | `--color-error-container` | `--color-role-error-container` | `var(--primitive-color-error-90)` | `#fdd2ceff` | Background fill for error banners and alert boxes |
| `on error container` | `--color-on-error-container` | `--color-role-on-error-container` | `var(--primitive-color-error-30)` | `#ad1406ff` | Text and icons inside error alert banners |

### Surface & Background Roles (Hierarchy & Elevation)
| Token Name | UI CSS Variable | Role CSS Variable | Foundational Primitive Reference | Hex Fallback | Recommended UI Usage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `surface color` | `--color-surface` | `--color-role-surface` | `var(--primitive-color-neutral-98)` | `#f9fafbff` | Default screen / page background |
| `on surface` | `--color-on-surface` | `--color-role-on-surface` | `var(--primitive-color-neutral-10)` | `#16181dff` | Primary body text and headlines on surfaces |
| `surface variant` | `--color-surface-variant` | `--color-role-surface-variant` | `var(--primitive-color-neutral-variant-90)` | `#e5e5e6ff` | Card dividers, input borders, inactive icons |
| `on surface variant` | `--color-on-surface-variant` | `--color-role-on-surface-variant` | `var(--primitive-color-neutral-variant-30)` | `#4b4c4eff` | Secondary text, captions, placeholder copy |
| `surface container lowest` | `--color-surface-container-lowest` | `--color-role-surface-container-lowest` | `var(--primitive-color-neutral-100)` | `#ffffffff` | Clean canvas base, lowest depth card containers |
| `surface container low` | `--color-surface-container-low` | `--color-role-surface-container-low` | `var(--primitive-color-neutral-98)` | `#f9fafbff` | Shallow elevated cards, sidebars |
| `surface container` | `--color-surface-container` | `--color-role-surface-container` | `var(--primitive-color-neutral-95)` | `#f0f1f4ff` | Standard card surface, default section containers |
| `surface container high` | `--color-surface-container-high` | `--color-role-surface-container-high` | `var(--primitive-color-neutral-90)` | `#e2e4e9ff` | Elevated surfaces, dropdown panels |
| `surface container highest`| `--color-surface-container-highest` | `--color-role-surface-container-highest`| `var(--primitive-color-neutral-90)` | `#e2e4e9ff` | Modals, dialog sheets, popovers |
| `inverse surface` | `--color-inverse-surface` | `--color-role-inverse-surface` | `var(--primitive-color-neutral-20)` | `#2c303aff` | Tooltip backgrounds, snackbars, dark banners |
| `inverse on surface` | `--color-inverse-on-surface` | `--color-role-inverse-on-surface` | `var(--primitive-color-neutral-95)` | `#f0f1f4ff` | Text and icons inside tooltips / snackbars |
| `surface tint` | `--color-surface-tint` | `--color-role-surface-tint` | `var(--primitive-color-primary-40)` | `#004bccff` | Tint layer applied for elevation scrims |

---

## 🔤 3. Typography System (DM Sans)

The typography scale utilizes **DM Sans** with optical weight and letter-spacing balances:

| Style Name | Font Size | Line Height | Weight | Letter Spacing | CSS Utility Class |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `display large` | `64px` | `96px` | 500 | `-4px` | `.type-display-large` |
| `display medium` | `50px` | `75px` | 500 | `-3px` | `.type-display-medium` |
| `display small` | `40px` | `60px` | 500 | `-2.3px` | `.type-display-small` |
| `headline large` | `32px` | `48px` | 500 | `-1.55px` | `.type-headline-large` |
| `headline medium` | `28px` | `42px` | 500 | `-1.35px` | `.type-headline-medium` |
| `headline small` | `24px` | `36px` | 500 | `-1px` | `.type-headline-small` |
| `title large` | `22px` | `33px` | 500 | `-1px` | `.type-title-large` |
| `title medium` | `16px` | `24px` | 600 | `-0.85px` | `.type-title-medium` |
| `title small` | `14px` | `21px` | 400 | `-0.75px` | `.type-title-small` |
| `body large` | `16px` | `24px` | 500 | `-0.8px` | `.type-body-large` |
| `body medium` | `14px` | `21px` | 500 | `-0.75px` | `.type-body-medium` |
| `body small` | `12px` | `18px` | 400 | `-0.75px` | `.type-body-small` |
| `label large` | `14px` | `21px` | 500 | `-0.9px` | `.type-label-large` |
| `label medium` | `12px` | `18px` | 500 | `-0.9px` | `.type-label-medium` |
| `label small` | `11px` | `16.5px` | 500 | `-0.8px` | `.type-label-small` |

### Using Typography Variables
Each typography style has granular CSS variables and a composite shorthand:
```css
/* Granular */
font-size: var(--typography-body-large-font-size);
line-height: var(--typography-body-large-line-height);
font-weight: var(--typography-body-large-font-weight);

/* Or composite font */
font: var(--typography-body-large-font);
```

---

## 📐 4. Spacing Scale

The spacing scale is based on an 8-point and 4-point geometric system:

| Token Name | Value | Shorthand Alias | Usage Guidelines |
| :--- | :--- | :--- | :--- |
| `no spacing` | `0px` | `--spacing-none` | Resetting margins or paddings |
| `extra small spacing` | `4px` | `--spacing-xs` | Badge padding, icon-to-label gaps |
| `small spacing` | `8px` | `--spacing-sm` | Button internal gaps, item list spacing |
| `medium spacing` | `12px` | `--spacing-md` | Input field padding, compact card gaps |
| `base spacing` | `16px` | `--spacing-base` | Default component padding, grid gutters |
| `large spacing` | `20px` | `--spacing-lg` | Card internal padding, section margins |
| `extra large spacing` | `24px` | `--spacing-xl` | Large container padding, header gaps |
| `very large spacing` | `32px` | `--spacing-2xl` | Section padding, hero margins |

---

## ✨ 5. Elevation & Shadow Effects

Three elevation tiers are provided as complete box-shadow strings:

| Elevation Level | CSS Variable | Value | Recommended Usage |
| :--- | :--- | :--- | :--- |
| `soft shadow` | `--shadow-soft` | `2px 2px 20px 0px #0000001f` | Cards, resting surface containers, table rows |
| `medium shadow` | `--shadow-medium` | `2px 4px 6px 0px #00000047` | Hovered cards, dropdown menus, flyouts |
| `hard shadow` | `--shadow-hard` | `4px 6px 8px 0px #00000052` | Modal dialogs, action sheets, floating popovers |

---

## 💻 6. Real-World Component Styling Recipes

### Recipe 1: Primary Button
```css
.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
  background-color: var(--color-primary);
  color: var(--color-on-primary);
  font: var(--typography-label-large-font);
  padding: var(--spacing-sm) var(--spacing-base);
  border-radius: var(--spacing-sm);
  border: none;
  cursor: pointer;
  transition: opacity 0.2s ease, box-shadow 0.2s ease;
}

.btn-primary:hover {
  opacity: 0.92;
  box-shadow: var(--shadow-soft);
}

.btn-primary:active {
  opacity: 0.84;
}
```

### Recipe 2: Elevated Card
```css
.card {
  background-color: var(--color-surface-container);
  color: var(--color-on-surface);
  border: 1px solid var(--color-surface-variant);
  border-radius: var(--spacing-md);
  padding: var(--spacing-large);
  box-shadow: var(--shadow-soft);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-medium);
}

.card-title {
  font: var(--typography-title-medium-font);
  color: var(--color-on-surface);
  margin-bottom: var(--spacing-xs);
}

.card-body {
  font: var(--typography-body-medium-font);
  color: var(--color-on-surface-variant);
}
```

### Recipe 3: Form Input
```css
.form-input {
  width: 100%;
  background-color: var(--color-surface-container-lowest);
  color: var(--color-on-surface);
  border: 1px solid var(--color-surface-variant);
  border-radius: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-base);
  font: var(--typography-body-large-font);
  outline: none;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.form-input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-container);
}

.form-input.is-error {
  border-color: var(--color-error);
}
```

---

## 🛠 7. The Script: How It Works & CLI Reference

The converter script `convert-tokens.js` is a zero-dependency Node.js utility.

### Running via NPM
```bash
# Standard conversion to design-tokens.css
npm run tokens

# Build all modular CSS files and JS exports in dist/
npm run build:tokens

# Run automated test suite
npm test
```

### Running via Node CLI
```bash
# Default conversion
node convert-tokens.js

# Custom input and output paths
node convert-tokens.js --input my-tokens.json --output static/theme.css

# Output rem units instead of pixels (16px base)
node convert-tokens.js --rem --base 16

# View CLI options
node convert-tokens.js --help
```

### Programmatic API (Importing in Node.js)
```javascript
const { convertDesignTokens } = require('./convert-tokens.js');

const result = convertDesignTokens({
  inputFile: 'design-tokens.tokens.json',
  outputFile: 'design-tokens.css',
  splitModules: true,
  exportJson: true,
  exportJs: true,
});

console.log('Generated files:', result.stats.filesGenerated);
```
