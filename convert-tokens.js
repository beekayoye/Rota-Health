/**
 * ============================================================================
 * DESIGN SYSTEM TOKEN CONVERTER (tokens-to-css)
 * ============================================================================
 *
 * Converts design tokens from Figma Tokens format (JSON) into production-ready
 * CSS custom properties (variables), modular stylesheets, and JS/JSON exports.
 *
 * ----------------------------------------------------------------------------
 * COLOR ARCHITECTURE NOTICE:
 * ----------------------------------------------------------------------------
 * This design system implements a strict Two-Tier Color Architecture:
 *
 * 1. PRIMITIVES (Foundational Palette):
 *    - Located under `primitives colors` (e.g., Primary 0-100, Neutral, Error).
 *    - Namespace in CSS: `--primitive-color-*`
 *    - RULE: FOUNDATIONAL ONLY. NEVER apply directly to UI components!
 *
 * 2. COLOR ROLES (Semantic UI Tokens):
 *    - Located under `color roles` (e.g., primary, on-primary, surface, error).
 *    - Namespace in CSS: `--color-role-*` and `--color-*`
 *    - RULE: UI APPLICATION TOKENS. ALWAYS use these in UI components!
 *    - In CSS, Color Roles reference their corresponding Primitive foundation:
 *      e.g. `--color-role-primary: var(--primitive-color-key-primary, #004ed4ff);`
 *
 * ----------------------------------------------------------------------------
 * Author: Antigravity Design Systems Team
 * License: MIT
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

/**
 * Default configuration options
 */
const DEFAULT_OPTIONS = {
  inputFile: 'design-tokens.tokens.json',
  outputFile: 'design-tokens.css',
  outputDir: 'dist',
  splitModules: true,
  exportJson: true,
  exportJs: true,
  includeFallbacks: true,
  useRem: false,
  baseFontSize: 16,
  silent: false,
};

/**
 * Converts a string into a clean kebab-case slug.
 * Safely handles camelCase, spaces, underscores, numbers, and symbols.
 *
 * @param {string} str - Raw string name
 * @returns {string} Kebab-case slug
 */
function slugify(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/([a-z])([A-Z])/g, (match, p1, p2) => p1 + '-' + p2)
    .replace(/([a-zA-Z])([0-9]+)/g, (match, p1, p2) => p1 + '-' + p2)
    .replace(/([0-9]+)([a-zA-Z])/g, (match, p1, p2) => p1 + '-' + p2)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Formats a dimension value into CSS unit (px or rem).
 *
 * @param {number|string} val - Numeric dimension
 * @param {boolean} useRem - Whether to convert to rem
 * @param {number} baseFontSize - Base font size in px
 * @returns {string} CSS formatted dimension
 */
function formatDimension(val, useRem = false, baseFontSize = 16) {
  const num = parseFloat(val);
  if (isNaN(num)) return String(val);
  if (num === 0) return '0px';
  if (useRem) {
    const remVal = (num / baseFontSize).toFixed(4).replace(/\.?0+$/, '');
    return `${remVal}rem`;
  }
  return `${num}px`;
}

/**
 * Formats hex color strings. Ensures standard modern CSS color format.
 *
 * @param {string} hex - Raw hex color
 * @returns {string} Standardized hex color
 */
function formatColor(hex) {
  if (typeof hex !== 'string') return String(hex);
  return hex.toLowerCase().trim();
}

/**
 * Resolves a token reference path like `{primitives colors.key color group.primary key color}`
 * against the root token tree.
 *
 * @param {string} refStr - Reference string with `{path.to.token}`
 * @param {object} rootTokens - Full token JSON tree
 * @returns {{ resolvedToken: object|null, pathParts: string[], primitiveVarName: string|null }}
 */
function resolveTokenReference(refStr, rootTokens) {
  if (!refStr || typeof refStr !== 'string') {
    return { resolvedToken: null, pathParts: [], primitiveVarName: null };
  }

  const cleanRef = refStr.replace(/^\{|\}$/g, '').trim();
  const pathParts = cleanRef.split('.');

  let curr = rootTokens;
  for (const part of pathParts) {
    if (!curr || curr[part] === undefined) {
      return { resolvedToken: null, pathParts, primitiveVarName: null };
    }
    curr = curr[part];
  }

  const primitiveVarName = getPrimitiveVarNameFromPath(pathParts);

  return {
    resolvedToken: curr,
    pathParts,
    primitiveVarName,
  };
}

/**
 * Computes canonical CSS variable name for a primitive color based on its JSON path.
 *
 * @param {string[]} pathParts - Array of path parts
 * @returns {string} CSS variable name
 */
function getPrimitiveVarNameFromPath(pathParts) {
  if (!pathParts || pathParts.length < 2) return null;

  const paletteOrGroup = pathParts[1] || '';
  const tokenName = pathParts[2] || '';

  // Case 1: Key color group
  if (paletteOrGroup.includes('key color')) {
    const keyMatch = tokenName.replace(/\s*key\s*color\s*/i, '').trim();
    const cleanKey = slugify(keyMatch);
    return `--primitive-color-key-${cleanKey}`;
  }

  // Case 2: Tonal palettes (e.g. primary color palette, neutral variant color palette)
  const paletteClean = paletteOrGroup.replace(/\s*color\s*palette\s*/i, '').trim();
  const paletteSlug = slugify(paletteClean);

  // Extract tone number (e.g., primary100 -> 100, neutralvariant90 -> 90)
  const toneMatch = tokenName.match(/([0-9]+)$/);
  const tone = toneMatch ? toneMatch[1] : slugify(tokenName);

  return `--primitive-color-${paletteSlug}-${tone}`;
}

/**
 * Extracts and maps all primitive colors from the design tokens.
 *
 * @param {object} primitivesSection - The `primitives colors` section of tokens
 * @returns {Array<object>} List of primitive token descriptors
 */
function processPrimitives(primitivesSection) {
  const results = [];
  if (!primitivesSection || typeof primitivesSection !== 'object') return results;

  for (const [groupName, groupTokens] of Object.entries(primitivesSection)) {
    if (!groupTokens || typeof groupTokens !== 'object') continue;

    for (const [tokenName, tokenData] of Object.entries(groupTokens)) {
      if (!tokenData || typeof tokenData !== 'object') continue;

      const varName = getPrimitiveVarNameFromPath(['primitives colors', groupName, tokenName]);
      const rawValue = tokenData.value;
      const formattedValue = formatColor(rawValue);

      results.push({
        group: groupName,
        tokenName,
        path: `primitives colors.${groupName}.${tokenName}`,
        varName,
        value: formattedValue,
        description: tokenData.description || null,
        isKeyColor: groupName.toLowerCase().includes('key color'),
        collection: 'Primitives Colors',
      });
    }
  }

  return results;
}

/**
 * Extracts and maps all semantic color roles from the design tokens.
 *
 * @param {object} colorRolesSection - The `color roles` section of tokens
 * @param {object} rootTokens - Full token tree for reference resolution
 * @returns {Array<object>} List of color role descriptors
 */
function processColorRoles(colorRolesSection, rootTokens) {
  const results = [];
  if (!colorRolesSection || typeof colorRolesSection !== 'object') return results;

  for (const [roleName, roleData] of Object.entries(colorRolesSection)) {
    if (!roleData || typeof roleData !== 'object') continue;

    const roleSlug = slugify(roleName.replace(/color$/i, '').trim() || roleName);
    const varNameRole = `--color-role-${roleSlug}`;
    const varNameClean = `--color-${roleSlug}`;

    const rawRef = roleData.value;
    const { resolvedToken, pathParts, primitiveVarName } = resolveTokenReference(
      rawRef,
      rootTokens,
    );
    const resolvedValue = resolvedToken ? formatColor(resolvedToken.value) : rawRef;

    results.push({
      roleName,
      slug: roleSlug,
      varNameRole,
      varNameClean,
      refString: rawRef,
      targetPrimitiveVar: primitiveVarName,
      targetPath: pathParts.join('.'),
      resolvedValue,
      description: roleData.description || null,
      collection: 'Color Roles',
    });
  }

  return results;
}

/**
 * Extracts and maps all spacing tokens.
 *
 * @param {object} spacingSection - The `spacing collection` section of tokens
 * @param {object} options - Configuration options
 * @returns {Array<object>} List of spacing token descriptors
 */
function processSpacing(spacingSection, options) {
  const results = [];
  if (!spacingSection || typeof spacingSection !== 'object') return results;

  const shorthandAliases = {
    'no spacing': 'none',
    'extra small spacing': 'xs',
    'small spacing': 'sm',
    'medium spacing': 'md',
    'base spacing': 'base',
    'large spacing': 'lg',
    'extra large spacing': 'xl',
    'very large spacing': '2xl',
  };

  for (const [name, tokenData] of Object.entries(spacingSection)) {
    if (!tokenData || typeof tokenData !== 'object') continue;

    const rawValue = tokenData.value;
    const formattedValue = formatDimension(rawValue, options.useRem, options.baseFontSize);
    const cleanSlug = slugify(name.replace(/spacing$/i, '').trim() || name);
    const varName = `--spacing-${cleanSlug}`;
    const aliasKey = shorthandAliases[name.toLowerCase().trim()];
    const aliasVarName = aliasKey ? `--spacing-${aliasKey}` : null;

    results.push({
      name,
      slug: cleanSlug,
      rawPx: rawValue,
      value: formattedValue,
      varName,
      aliasVarName,
      collection: 'Spacing Collection',
    });
  }

  return results;
}

/**
 * Extracts and maps all typography tokens.
 *
 * @param {object} typographySection - The `typography` section of tokens
 * @param {object} options - Configuration options
 * @returns {Array<object>} List of typography token descriptors
 */
function processTypography(typographySection, options) {
  const results = [];
  if (!typographySection || typeof typographySection !== 'object') return results;

  for (const [styleName, styleProperties] of Object.entries(typographySection)) {
    if (!styleProperties || typeof styleProperties !== 'object') continue;

    const styleSlug = slugify(styleName);
    const fontSize = styleProperties.fontSize ? styleProperties.fontSize.value : 16;
    const lineHeight = styleProperties.lineHeight ? styleProperties.lineHeight.value : 24;
    const fontWeight = styleProperties.fontWeight ? styleProperties.fontWeight.value : 400;
    const fontFamily = styleProperties.fontFamily ? styleProperties.fontFamily.value : 'DM Sans';
    const letterSpacing = styleProperties.letterSpacing ? styleProperties.letterSpacing.value : 0;
    const fontStyle = styleProperties.fontStyle ? styleProperties.fontStyle.value : 'normal';
    const textDecoration = styleProperties.textDecoration
      ? styleProperties.textDecoration.value
      : 'none';
    const textCase = styleProperties.textCase ? styleProperties.textCase.value : 'none';

    // Format units
    const formattedFontSize = formatDimension(fontSize, options.useRem, options.baseFontSize);
    const formattedLineHeight = formatDimension(lineHeight, options.useRem, options.baseFontSize);
    const formattedLetterSpacing = formatDimension(letterSpacing, false);
    const formattedFontFamily = fontFamily.includes(' ')
      ? `'${fontFamily}', sans-serif`
      : `${fontFamily}, sans-serif`;

    // Composite font shorthand
    const shorthandFont = `${fontStyle} ${fontWeight} ${formattedFontSize}/${formattedLineHeight} ${formattedFontFamily}`;

    results.push({
      styleName,
      slug: styleSlug,
      varPrefix: `--typography-${styleSlug}`,
      properties: {
        fontFamily: formattedFontFamily,
        fontSize: formattedFontSize,
        fontWeight: fontWeight,
        lineHeight: formattedLineHeight,
        letterSpacing: formattedLetterSpacing,
        fontStyle: fontStyle,
        textDecoration: textDecoration,
        textTransform: textCase === 'none' ? 'none' : textCase,
      },
      shorthandFont,
      raw: {
        fontSize,
        lineHeight,
        fontWeight,
        fontFamily,
        letterSpacing,
      },
      collection: 'Typography',
    });
  }

  return results;
}

/**
 * Extracts and maps all effect / shadow tokens.
 *
 * @param {object} effectSection - The `effect` section of tokens
 * @returns {Array<object>} List of effect token descriptors
 */
function processEffects(effectSection) {
  const results = [];
  if (!effectSection || typeof effectSection !== 'object') return results;

  for (const [effectName, effectData] of Object.entries(effectSection)) {
    if (!effectData || typeof effectData !== 'object') continue;

    const val = effectData.value;
    if (!val) continue;

    const effectSlug = slugify(effectName.replace(/shadow$/i, '').trim() || effectName);
    const offsetX = `${val.offsetX || 0}px`;
    const offsetY = `${val.offsetY || 0}px`;
    const radius = `${val.radius || 0}px`;
    const spread = `${val.spread || 0}px`;
    const color = formatColor(val.color || '#000000');

    // Box shadow standard CSS format: offsetX offsetY blur-radius spread-radius color
    const boxShadowValue = `${offsetX} ${offsetY} ${radius} ${spread} ${color}`;
    const varName = `--shadow-${effectSlug}`;

    results.push({
      name: effectName,
      slug: effectSlug,
      varName,
      boxShadowValue,
      individual: {
        offsetX,
        offsetY,
        blur: radius,
        spread,
        color,
      },
      collection: 'Effect (Shadows)',
    });
  }

  return results;
}

/**
 * Generates the complete CSS output string.
 * Includes structured comments, warnings, and formatting.
 *
 * @param {object} parsedTokens - Parsed token data collections
 * @param {object} options - Options
 * @returns {object} Object with combined CSS and individual module CSS strings
 */
function generateCSS(parsedTokens, options) {
  const { primitives, colorRoles, spacing, typography, effects } = parsedTokens;

  // 1. PRIMITIVES MODULE
  let primitivesCSS = `/**
 * ============================================================================
 * DESIGN SYSTEM TOKENS: PRIMITIVE FOUNDATION PALETTES
 * ============================================================================
 * 
 * 🛑 CRITICAL ARCHITECTURAL RULE:
 * ----------------------------------------------------------------------------
 * These variables represent raw foundation colors and tonal palette stops.
 * DO NOT APPLY PRIMITIVE COLORS DIRECTLY TO UI COMPONENTS OR LAYOUTS!
 * 
 * Primitives serve as the foundational palette used exclusively to feed the
 * semantic Color Roles. Applying primitives directly violates design system
 * integrity and breaks multi-theming, dark mode, and accessibility contrast.
 * 
 * For UI elements, ALWAYS use the semantic Color Roles (--color-role-* / --color-*).
 * ============================================================================
 */

:root {
  /* --------------------------------------------------------------------------
   * 1. KEY COLORS (Brand Anchors)
   * -------------------------------------------------------------------------- */
`;

  const keyColors = primitives.filter((p) => p.isKeyColor);
  const tonalPalettes = primitives.filter((p) => !p.isKeyColor);

  for (const item of keyColors) {
    primitivesCSS += `  ${item.varName}: ${item.value}; /* ${item.tokenName} */\n`;
  }

  // Group tonal palettes by group name
  const groupedTones = {};
  for (const item of tonalPalettes) {
    if (!groupedTones[item.group]) groupedTones[item.group] = [];
    groupedTones[item.group].push(item);
  }

  for (const [groupName, items] of Object.entries(groupedTones)) {
    const formattedGroupName = groupName.toUpperCase();
    primitivesCSS += `\n  /* --------------------------------------------------------------------------\n   * TONAL PALETTE: ${formattedGroupName}\n   * -------------------------------------------------------------------------- */\n`;
    for (const item of items) {
      primitivesCSS += `  ${item.varName}: ${item.value};\n`;
    }
  }

  primitivesCSS += `}\n`;

  // 2. COLOR ROLES MODULE
  let colorRolesCSS = `/**
 * ============================================================================
 * DESIGN SYSTEM TOKENS: SEMANTIC COLOR ROLES (UI LAYER)
 * ============================================================================
 * 
 * ✅ ARCHITECTURAL USAGE RULE:
 * ----------------------------------------------------------------------------
 * THESE ARE THE OFFICIAL COLORS TO APPLY ON THE UI!
 * 
 * Each role expresses functional intent (backgrounds, surfaces, foregrounds,
 * accents, interactive states, and error alerts).
 * 
 * Every Color Role references its foundational Primitive token via CSS var(),
 * ensuring dynamic theming, brand swaps, and dark mode adaptation.
 * A raw hex fallback is provided for maximum resilience.
 * 
 * Usage Examples:
 *   background-color: var(--color-primary);
 *   color: var(--color-on-primary);
 *   border: 1px solid var(--color-surface-variant);
 *   background: var(--color-surface);
 * ============================================================================
 */

:root {
  /* ==========================================================================
   * PRIMARY ROLES (Main interactive brand accents & primary surfaces)
   * ========================================================================== */
`;

  const roleCategories = {
    primary: (r) => r.slug.startsWith('primary') || r.slug.startsWith('on-primary'),
    secondary: (r) => r.slug.startsWith('secondary') || r.slug.startsWith('on-secondary'),
    tertiary: (r) => r.slug.startsWith('tertiary') || r.slug.startsWith('on-tertiary'),
    error: (r) => r.slug.startsWith('error') || r.slug.startsWith('on-error'),
    surface: (r) => r.slug.includes('surface'),
    other: () => true,
  };

  const processedRoles = new Set();

  function renderRoleGroup(title, filterFn) {
    let out = `  /* --------------------------------------------------------------------------\n   * ${title}\n   * -------------------------------------------------------------------------- */\n`;
    let count = 0;
    for (const role of colorRoles) {
      if (processedRoles.has(role.slug)) continue;
      if (filterFn(role)) {
        processedRoles.add(role.slug);
        count++;
        const targetVar = role.targetPrimitiveVar || '';
        const fallback = options.includeFallbacks ? `, ${role.resolvedValue}` : '';
        const varRef = targetVar ? `var(${targetVar}${fallback})` : role.resolvedValue;

        out += `  /* Role: ${role.roleName} -> Maps to: ${role.targetPath} */\n`;
        out += `  ${role.varNameRole}: ${varRef};\n`;
        out += `  ${role.varNameClean}: var(${role.varNameRole});\n\n`;
      }
    }
    return count > 0 ? out : '';
  }

  colorRolesCSS += renderRoleGroup('PRIMARY PALETTE ROLES', roleCategories.primary);
  colorRolesCSS += renderRoleGroup('SECONDARY PALETTE ROLES', roleCategories.secondary);
  colorRolesCSS += renderRoleGroup('TERTIARY PALETTE ROLES', roleCategories.tertiary);
  colorRolesCSS += renderRoleGroup('ERROR & FEEDBACK ROLES', roleCategories.error);
  colorRolesCSS += renderRoleGroup('SURFACE & BACKGROUND ROLES', roleCategories.surface);
  colorRolesCSS += renderRoleGroup('ADDITIONAL / UNMAPPED ROLES', roleCategories.other);

  colorRolesCSS += `}\n`;

  // 3. SPACING MODULE
  let spacingCSS = `/**
 * ============================================================================
 * DESIGN SYSTEM TOKENS: SPACING SCALE
 * ============================================================================
 * 
 * Predictable spacing scale for margins, paddings, gaps, and component sizing.
 * Both descriptive names (--spacing-small) and industry-standard t-shirt sizes
 * (--spacing-sm) are provided for developer ergonomics.
 * ============================================================================
 */

:root {
`;

  for (const item of spacing) {
    spacingCSS += `  /* ${item.name} (${item.rawPx}px) */\n`;
    spacingCSS += `  ${item.varName}: ${item.value};\n`;
    if (item.aliasVarName && item.aliasVarName !== item.varName) {
      spacingCSS += `  ${item.aliasVarName}: var(${item.varName});\n`;
    }
    spacingCSS += `\n`;
  }

  spacingCSS += `}\n`;

  // 4. TYPOGRAPHY MODULE
  let typographyCSS = `/**
 * ============================================================================
 * DESIGN SYSTEM TOKENS: TYPOGRAPHY SYSTEM
 * ============================================================================
 * 
 * Complete typographic hierarchy based on DM Sans.
 * Provides granular variables (size, weight, line-height, letter-spacing),
 * composite shorthand variables, and ready-to-use utility classes.
 * ============================================================================
 */

:root {
`;

  for (const item of typography) {
    typographyCSS += `  /* --------------------------------------------------------------------------\n   * Style: ${item.styleName.toUpperCase()}\n   * -------------------------------------------------------------------------- */\n`;
    typographyCSS += `  ${item.varPrefix}-font-family: ${item.properties.fontFamily};\n`;
    typographyCSS += `  ${item.varPrefix}-font-size: ${item.properties.fontSize};\n`;
    typographyCSS += `  ${item.varPrefix}-font-weight: ${item.properties.fontWeight};\n`;
    typographyCSS += `  ${item.varPrefix}-line-height: ${item.properties.lineHeight};\n`;
    typographyCSS += `  ${item.varPrefix}-letter-spacing: ${item.properties.letterSpacing};\n`;
    typographyCSS += `  ${item.varPrefix}-font-style: ${item.properties.fontStyle};\n`;
    typographyCSS += `  ${item.varPrefix}-text-decoration: ${item.properties.textDecoration};\n`;
    typographyCSS += `  ${item.varPrefix}-text-transform: ${item.properties.textTransform};\n`;
    typographyCSS += `  ${item.varPrefix}-font: ${item.shorthandFont};\n\n`;
  }

  typographyCSS += `}\n`;

  // 5. EFFECTS & ELEVATIONS (SHADOWS)
  let effectsCSS = `/**
 * ============================================================================
 * DESIGN SYSTEM TOKENS: EFFECTS & ELEVATION (SHADOWS)
 * ============================================================================
 * 
 * Multi-layer elevation and shadow variables for cards, modals, dropdowns,
 * and floating UI elements.
 * ============================================================================
 */

:root {
`;

  for (const item of effects) {
    effectsCSS += `  /* ${item.name} */\n`;
    effectsCSS += `  ${item.varName}: ${item.boxShadowValue};\n`;
    effectsCSS += `  ${item.varName}-x: ${item.individual.offsetX};\n`;
    effectsCSS += `  ${item.varName}-y: ${item.individual.offsetY};\n`;
    effectsCSS += `  ${item.varName}-blur: ${item.individual.blur};\n`;
    effectsCSS += `  ${item.varName}-spread: ${item.individual.spread};\n`;
    effectsCSS += `  ${item.varName}-color: ${item.individual.color};\n\n`;
  }

  effectsCSS += `}\n`;

  // 6. UTILITY CLASSES MODULE
  let utilitiesCSS = `/**
 * ============================================================================
 * DESIGN SYSTEM TOKENS: UTILITY CLASSES
 * ============================================================================
 * 
 * Optional helper classes for rapid prototyping and standardized layout styles.
 * ============================================================================
 */

/* Typography Utilities */
`;

  for (const item of typography) {
    utilitiesCSS += `.type-${item.slug},\n.typography-${item.slug} {\n`;
    utilitiesCSS += `  font-family: var(${item.varPrefix}-font-family);\n`;
    utilitiesCSS += `  font-size: var(${item.varPrefix}-font-size);\n`;
    utilitiesCSS += `  font-weight: var(${item.varPrefix}-font-weight);\n`;
    utilitiesCSS += `  line-height: var(${item.varPrefix}-line-height);\n`;
    utilitiesCSS += `  letter-spacing: var(${item.varPrefix}-letter-spacing);\n`;
    utilitiesCSS += `  font-style: var(${item.varPrefix}-font-style);\n`;
    utilitiesCSS += `  text-decoration: var(${item.varPrefix}-text-decoration);\n`;
    utilitiesCSS += `  text-transform: var(${item.varPrefix}-text-transform);\n`;
    utilitiesCSS += `}\n\n`;
  }

  utilitiesCSS += `/* Shadow Utilities */\n`;
  for (const item of effects) {
    utilitiesCSS += `.shadow-${item.slug} {\n`;
    utilitiesCSS += `  box-shadow: var(${item.varName});\n`;
    utilitiesCSS += `}\n\n`;
  }

  // 7. COMBINED BUNDLE
  const combinedCSS = `/**
 * ============================================================================
 * ROTA HEALTH DESIGN SYSTEM - COMPLETE DESIGN TOKENS BUNDLE
 * ============================================================================
 * 
 * Auto-generated from Figma Tokens Studio: design-tokens.tokens.json
 * Generation Date: ${new Date().toISOString()}
 * 
 * ----------------------------------------------------------------------------
 * ARCHITECTURE OVERVIEW:
 * ----------------------------------------------------------------------------
 * 1. PRIMITIVES (Tier 1): Foundational color palette (Key colors, Tonal 0-100).
 *    🛑 DO NOT USE DIRECTLY ON UI COMPONENTS.
 * 
 * 2. COLOR ROLES (Tier 2): Semantic UI tokens (primary, surface, error, etc.).
 *    ✅ USE THESE FOR ALL UI STYLES.
 *    Color roles reference primitives via CSS variables with fallback.
 * 
 * 3. SPACING: Consistent 8-point & 4-point spacing scale.
 * 4. TYPOGRAPHY: Modular type scale with DM Sans typography styles.
 * 5. EFFECTS: Elevation drop-shadow levels (soft, medium, hard).
 * 6. UTILITIES: Ready-to-use CSS classes for typography and shadows.
 * ============================================================================
 */

${primitivesCSS}
${colorRolesCSS}
${spacingCSS}
${typographyCSS}
${effectsCSS}
${utilitiesCSS}
`;

  return {
    combined: combinedCSS,
    modules: {
      'tokens-primitives.css': primitivesCSS,
      'tokens-color-roles.css': colorRolesCSS,
      'tokens-spacing.css': spacingCSS,
      'tokens-typography.css': typographyCSS,
      'tokens-effects.css': effectsCSS,
      'tokens-utilities.css': utilitiesCSS,
    },
  };
}

/**
 * Generates JavaScript and JSON exports for JS-based environments.
 *
 * @param {object} parsedTokens - Parsed token data
 * @returns {{ jsContent: string, jsonContent: string }}
 */
function generateJsExports(parsedTokens) {
  const { primitives, colorRoles, spacing, typography, effects } = parsedTokens;

  const tokenDictionary = {
    metadata: {
      generatedAt: new Date().toISOString(),
      architecture: 'Two-Tier (Primitives Foundation + Semantic Color Roles)',
    },
    primitives: {
      description: 'Foundational palette tokens. DO NOT apply directly to UI components.',
      tokens: primitives.reduce((acc, p) => {
        acc[p.varName] = {
          name: p.tokenName,
          group: p.group,
          value: p.value,
          path: p.path,
        };
        return acc;
      }, {}),
    },
    colorRoles: {
      description: 'Semantic UI tokens. ALWAYS use these for styling UI components.',
      tokens: colorRoles.reduce((acc, r) => {
        acc[r.varNameClean] = {
          roleName: r.roleName,
          cssVarRole: r.varNameRole,
          cssVarClean: r.varNameClean,
          mapsToPrimitiveVar: r.targetPrimitiveVar,
          refString: r.refString,
          resolvedValue: r.resolvedValue,
        };
        return acc;
      }, {}),
    },
    spacing: spacing.reduce((acc, s) => {
      acc[s.varName] = {
        name: s.name,
        value: s.value,
        rawPx: s.rawPx,
        alias: s.aliasVarName,
      };
      return acc;
    }, {}),
    typography: typography.reduce((acc, t) => {
      acc[t.slug] = {
        styleName: t.styleName,
        varPrefix: t.varPrefix,
        properties: t.properties,
        shorthand: t.shorthandFont,
      };
      return acc;
    }, {}),
    effects: effects.reduce((acc, e) => {
      acc[e.slug] = {
        name: e.name,
        varName: e.varName,
        value: e.boxShadowValue,
      };
      return acc;
    }, {}),
  };

  const jsonContent = JSON.stringify(tokenDictionary, null, 2);

  const jsContent = `/**
 * Rota Health Design System Tokens (JavaScript Module)
 * Universal Module Definition (ESM & CommonJS compatible)
 */

export const tokens = ${jsonContent};

export default tokens;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = tokens;
}
`;

  return { jsContent, jsonContent };
}

/**
 * Main conversion execution function.
 *
 * @param {object} customOptions - Custom options overriding defaults
 * @returns {object} Execution summary report
 */
function convertDesignTokens(customOptions = {}) {
  const options = { ...DEFAULT_OPTIONS, ...customOptions };

  const log = (...args) => {
    if (!options.silent) console.log(...args);
  };

  log('\n🚀 Starting Design Tokens Conversion...');
  log(`📄 Input Token File: ${options.inputFile}`);

  // 1. Read input JSON
  const inputAbsPath = path.resolve(process.cwd(), options.inputFile);
  if (!fs.existsSync(inputAbsPath)) {
    throw new Error(`Design tokens file not found at: ${inputAbsPath}`);
  }

  const rawJson = fs.readFileSync(inputAbsPath, 'utf8');
  let tokenData;
  try {
    tokenData = JSON.parse(rawJson);
  } catch (err) {
    throw new Error(`Failed to parse JSON in ${options.inputFile}: ${err.message}`);
  }

  // 2. Process all token domains
  log('⚙️  Processing token categories...');
  const primitives = processPrimitives(tokenData['primitives colors']);
  const colorRoles = processColorRoles(tokenData['color roles'], tokenData);
  const spacing = processSpacing(tokenData['spacing collection'], options);
  const typography = processTypography(tokenData['typography'], options);
  const effects = processEffects(tokenData['effect']);

  const parsedTokens = { primitives, colorRoles, spacing, typography, effects };

  log(`   ✓ Found ${primitives.length} Primitive Colors (Foundational Palettes)`);
  log(`   ✓ Found ${colorRoles.length} Color Roles (Semantic UI Colors)`);
  log(`   ✓ Found ${spacing.length} Spacing Tokens`);
  log(`   ✓ Found ${typography.length} Typography Styles`);
  log(`   ✓ Found ${effects.length} Elevation / Shadow Effects`);

  // 3. Generate CSS code
  log('🎨 Generating CSS variables and stylesheets...');
  const cssResult = generateCSS(parsedTokens, options);

  // 4. Write primary bundle output
  const outputAbsPath = path.resolve(process.cwd(), options.outputFile);
  fs.writeFileSync(outputAbsPath, cssResult.combined, 'utf8');
  log(`   💾 Saved combined stylesheet: ${options.outputFile}`);

  // 5. Write split modules & JS exports if requested
  const writtenFiles = [options.outputFile];

  if (options.splitModules || options.exportJson || options.exportJs) {
    const distAbsDir = path.resolve(process.cwd(), options.outputDir);
    if (!fs.existsSync(distAbsDir)) {
      fs.mkdirSync(distAbsDir, { recursive: true });
    }

    if (options.splitModules) {
      for (const [filename, content] of Object.entries(cssResult.modules)) {
        const filePath = path.join(distAbsDir, filename);
        fs.writeFileSync(filePath, content, 'utf8');
        writtenFiles.push(path.join(options.outputDir, filename));
      }
      log(`   📁 Saved modular CSS files into: ${options.outputDir}/`);
    }

    const { jsContent, jsonContent } = generateJsExports(parsedTokens);

    if (options.exportJson) {
      const jsonPath = path.join(distAbsDir, 'tokens.resolved.json');
      fs.writeFileSync(jsonPath, jsonContent, 'utf8');
      writtenFiles.push(path.join(options.outputDir, 'tokens.resolved.json'));
      log(`   📋 Saved resolved JSON dictionary: ${options.outputDir}/tokens.resolved.json`);
    }

    if (options.exportJs) {
      const jsPath = path.join(distAbsDir, 'tokens.js');
      fs.writeFileSync(jsPath, jsContent, 'utf8');
      writtenFiles.push(path.join(options.outputDir, 'tokens.js'));
      log(`   📦 Saved JavaScript token exports: ${options.outputDir}/tokens.js`);
    }
  }

  log('\n✅ Design Tokens Conversion completed successfully!\n');

  return {
    success: true,
    stats: {
      primitivesCount: primitives.length,
      colorRolesCount: colorRoles.length,
      spacingCount: spacing.length,
      typographyCount: typography.length,
      effectsCount: effects.length,
      totalTokens:
        primitives.length + colorRoles.length + spacing.length + typography.length + effects.length,
      filesGenerated: writtenFiles,
    },
    parsedTokens,
  };
}

/**
 * Parses command-line arguments and runs CLI when executed directly.
 */
function runCLI() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
=============================================================================
ROTA HEALTH DESIGN TOKEN CONVERTER CLI
=============================================================================

Usage:
  node convert-tokens.js [options]

Options:
  -i, --input <path>      Path to tokens JSON file (default: design-tokens.tokens.json)
  -o, --output <path>     Path to output CSS bundle (default: design-tokens.css)
  -d, --dir <path>        Output directory for split modules (default: dist)
  --no-split              Disable generating modular CSS files
  --no-json               Disable generating resolved JSON dictionary
  --no-js                 Disable generating JavaScript token exports
  --rem                   Convert dimension units from px to rem
  --base <number>         Base font size for rem calculations (default: 16)
  --no-fallbacks          Omit raw fallback values in var() references
  -h, --help              Show this help message

Color Architecture Note:
  • Primitives (--primitive-color-*): Foundation palettes. DO NOT use on UI!
  • Color Roles (--color-role-* / --color-*): Semantic tokens. ALWAYS use on UI!
=============================================================================
`);
    process.exit(0);
  }

  const options = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-i' || arg === '--input') {
      options.inputFile = args[++i];
    } else if (arg === '-o' || arg === '--output') {
      options.outputFile = args[++i];
    } else if (arg === '-d' || arg === '--dir') {
      options.outputDir = args[++i];
    } else if (arg === '--no-split') {
      options.splitModules = false;
    } else if (arg === '--no-json') {
      options.exportJson = false;
    } else if (arg === '--no-js') {
      options.exportJs = false;
    } else if (arg === '--rem') {
      options.useRem = true;
    } else if (arg === '--base') {
      options.baseFontSize = parseFloat(args[++i]) || 16;
    } else if (arg === '--no-fallbacks') {
      options.includeFallbacks = false;
    }
  }

  try {
    convertDesignTokens(options);
  } catch (error) {
    console.error(`\n❌ Error during conversion: ${error.message}\n`);
    process.exit(1);
  }
}

// If run directly from Node CLI
if (require.main === module) {
  runCLI();
}

module.exports = {
  convertDesignTokens,
  generateCSS,
  generateJsExports,
  processPrimitives,
  processColorRoles,
  processSpacing,
  processTypography,
  processEffects,
  slugify,
  formatDimension,
  formatColor,
  resolveTokenReference,
  getPrimitiveVarNameFromPath,
};
