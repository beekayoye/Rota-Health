# Rota Health Design System — Token Converter

> Automated Design Tokens to CSS Custom Properties converter with strict Two-Tier Color Architecture.

---

## ⚡ Quick Start

### 1. Convert Tokens to CSS

```bash
# Run the conversion script (generates design-tokens.css and dist/)
node convert-tokens.js

# Or with npm scripts:
npm run tokens
npm run build:tokens
```

### 2. Run Test Suite

```bash
npm test
```

### 3. Open Interactive Styleguide

Open [`index.html`](./index.html) directly in any web browser to explore all design tokens, swatches, typography scales, spacing, shadows, and interactive components.

---

## 🎨 Color Architecture Notice

This system implements a strict **Two-Tier Color Architecture**:

| Tier                    | Namespace                      | Purpose                               | Can use in UI?                    |
| :---------------------- | :----------------------------- | :------------------------------------ | :-------------------------------- |
| **Tier 1: Primitives**  | `--primitive-color-*`          | Brand foundations & 0–100 tonal stops | 🛑 **NEVER** apply directly to UI |
| **Tier 2: Color Roles** | `--color-role-*` & `--color-*` | Functional semantic UI colors         | ✅ **ALWAYS** apply on the UI     |

### Why?

Color Roles reference Primitives via `var(--primitive-color-*, fallback)`. When theming or dark mode is applied, swapping the underlying primitive tokens or overriding color roles preserves accessibility contrast and design integrity without touching component CSS.

---

## 📁 Generated Outputs

Running `node convert-tokens.js` generates:

- **[`design-tokens.css`](./design-tokens.css)**: Unified, production-ready stylesheet bundle.
- **`dist/tokens-color-roles.css`**: Semantic UI color roles (`--color-role-*`, `--color-*`).
- **`dist/tokens-primitives.css`**: Foundational palettes and key colors (`--primitive-color-*`).
- **`dist/tokens-typography.css`**: DM Sans typography variables (`--typography-*`).
- **`dist/tokens-spacing.css`**: 0–32px spacing scale with t-shirt aliases (`--spacing-*`).
- **`dist/tokens-effects.css`**: Elevation box-shadow variables (`--shadow-*`).
- **`dist/tokens-utilities.css`**: Ready-to-use utility classes (`.type-*`, `.shadow-*`).
- **`dist/tokens.js`**: Universal JavaScript module (ESM & CJS) for React, Vue, or Tailwind.
- **`dist/tokens.resolved.json`**: Resolved JSON token dictionary.

---

## 📖 Complete Documentation

For the full design system reference, token dictionary, and component recipes, see:

- [📘 DESIGN_SYSTEM_DOCUMENTATION.md](./DESIGN_SYSTEM_DOCUMENTATION.md)
- [🌐 Interactive Token Explorer (index.html)](./index.html)
