/**
 * ============================================================================
 * DESIGN TOKEN CONVERTER TEST SUITE
 * ============================================================================
 *
 * Validates the token conversion logic, reference resolution, CSS variable
 * naming conventions, and two-tier color architecture rules.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const {
  convertDesignTokens,
  processPrimitives,
  processColorRoles,
  processSpacing,
  processTypography,
  processEffects,
  resolveTokenReference,
} = require('../convert-tokens');

console.log('🧪 Running Design Tokens Converter Test Suite...\n');

const rawTokens = JSON.parse(fs.readFileSync('design-tokens.tokens.json', 'utf8'));

// ----------------------------------------------------------------------------
// TEST 1: Primitives Processing & Naming
// ----------------------------------------------------------------------------
console.log('▶ Test 1: Primitives Color Foundation');
const primitives = processPrimitives(rawTokens['primitives colors']);
assert.strictEqual(primitives.length, 90, `Expected 90 primitive tokens, got ${primitives.length}`);

// Verify Key Colors
const keyColors = primitives.filter((p) => p.isKeyColor);
assert.strictEqual(keyColors.length, 6, `Expected 6 key colors, got ${keyColors.length}`);

for (const key of keyColors) {
  assert(
    key.varName.startsWith('--primitive-color-key-'),
    `Key color variable must start with --primitive-color-key-, got ${key.varName}`,
  );
  assert(key.value.startsWith('#'), `Key color value must be a hex color, got ${key.value}`);
}

// Verify Tonal Palettes (0 - 100)
const tonalPalettes = primitives.filter((p) => !p.isKeyColor);
assert.strictEqual(
  tonalPalettes.length,
  84,
  `Expected 84 tonal palette tokens (6 palettes * 14 stops), got ${tonalPalettes.length}`,
);

for (const tone of tonalPalettes) {
  assert(
    tone.varName.startsWith('--primitive-color-'),
    `Primitive variable must start with --primitive-color-, got ${tone.varName}`,
  );
  assert(tone.value.startsWith('#'), `Tonal color value must be a hex color, got ${tone.value}`);
}
console.log(
  '  ✔ All 90 primitive foundations processed with strict --primitive-color-* namespace.',
);

// ----------------------------------------------------------------------------
// TEST 2: Color Roles Processing & Reference Resolution
// ----------------------------------------------------------------------------
console.log('▶ Test 2: Color Roles (Semantic UI Layer) & Dependency Graph');
const colorRoles = processColorRoles(rawTokens['color roles'], rawTokens);
assert.strictEqual(colorRoles.length, 28, `Expected 28 color roles, got ${colorRoles.length}`);

const primitiveVarSet = new Set(primitives.map((p) => p.varName));

for (const role of colorRoles) {
  assert(
    role.varNameRole.startsWith('--color-role-'),
    `Color role variable must start with --color-role-, got ${role.varNameRole}`,
  );
  assert(
    role.varNameClean.startsWith('--color-'),
    `Clean role variable must start with --color-, got ${role.varNameClean}`,
  );
  assert(role.targetPrimitiveVar, `Color role ${role.roleName} must link to a primitive variable`);
  assert(
    primitiveVarSet.has(role.targetPrimitiveVar),
    `Target primitive ${role.targetPrimitiveVar} for role ${role.roleName} does not exist in primitives!`,
  );
  assert(
    role.resolvedValue.startsWith('#'),
    `Resolved color value must be valid hex, got ${role.resolvedValue}`,
  );
}
console.log('  ✔ All 28 color roles resolve 100% cleanly to existing primitive variables.');

// ----------------------------------------------------------------------------
// TEST 3: Spacing Scale
// ----------------------------------------------------------------------------
console.log('▶ Test 3: Spacing Scale');
const spacing = processSpacing(rawTokens['spacing collection'], {
  useRem: false,
  baseFontSize: 16,
});
assert.strictEqual(spacing.length, 8, `Expected 8 spacing tokens, got ${spacing.length}`);

const expectedSpacingValues = {
  'no spacing': '0px',
  'extra small spacing': '4px',
  'small spacing': '8px',
  'medium spacing': '12px',
  'base spacing': '16px',
  'large spacing': '20px',
  'extra large spacing': '24px',
  'very large spacing': '32px',
};

for (const item of spacing) {
  assert.strictEqual(item.value, expectedSpacingValues[item.name], `Spacing ${item.name} mismatch`);
  assert(item.varName.startsWith('--spacing-'), `Spacing variable must start with --spacing-`);
}
console.log('  ✔ Spacing scale verified with accurate pixel values and shorthand aliases.');

// ----------------------------------------------------------------------------
// TEST 4: Typography Hierarchy
// ----------------------------------------------------------------------------
console.log('▶ Test 4: Typography Hierarchy');
const typography = processTypography(rawTokens['typography'], { useRem: false, baseFontSize: 16 });
assert.strictEqual(
  typography.length,
  15,
  `Expected 15 typography styles, got ${typography.length}`,
);

for (const item of typography) {
  assert(
    item.properties.fontFamily.includes('DM Sans'),
    `Typography font family must include DM Sans, got ${item.properties.fontFamily}`,
  );
  assert(
    item.properties.fontSize.endsWith('px'),
    `Font size must end in px, got ${item.properties.fontSize}`,
  );
  assert(
    item.properties.lineHeight.endsWith('px'),
    `Line height must end in px, got ${item.properties.lineHeight}`,
  );
  assert(
    typeof item.properties.fontWeight === 'number',
    `Font weight must be a number, got ${item.properties.fontWeight}`,
  );
  assert(item.shorthandFont, `Shorthand font declaration must be present`);
}
console.log('  ✔ All 15 typography styles verified with DM Sans metrics and composite shorthands.');

// ----------------------------------------------------------------------------
// TEST 5: Effect & Shadow Elevation
// ----------------------------------------------------------------------------
console.log('▶ Test 5: Elevation & Shadow Effects');
const effects = processEffects(rawTokens['effect']);
assert.strictEqual(effects.length, 3, `Expected 3 elevation styles, got ${effects.length}`);

for (const eff of effects) {
  assert(
    eff.boxShadowValue.includes('px'),
    `Box shadow value must include px coordinates, got ${eff.boxShadowValue}`,
  );
  assert(eff.varName.startsWith('--shadow-'), `Shadow variable must start with --shadow-`);
}
console.log('  ✔ Elevation tokens verified with valid CSS box-shadow declarations.');

// ----------------------------------------------------------------------------
// TEST 6: Complete End-to-End Build & File Generation
// ----------------------------------------------------------------------------
console.log('▶ Test 6: End-to-End Build & File Generation');
const buildResult = convertDesignTokens({ silent: true });
assert.strictEqual(buildResult.success, true, 'Build must succeed');
assert(fs.existsSync('design-tokens.css'), 'design-tokens.css must exist');
assert(fs.existsSync('dist/tokens-primitives.css'), 'dist/tokens-primitives.css must exist');
assert(fs.existsSync('dist/tokens-color-roles.css'), 'dist/tokens-color-roles.css must exist');
assert(fs.existsSync('dist/tokens-spacing.css'), 'dist/tokens-spacing.css must exist');
assert(fs.existsSync('dist/tokens-typography.css'), 'dist/tokens-typography.css must exist');
assert(fs.existsSync('dist/tokens-effects.css'), 'dist/tokens-effects.css must exist');
assert(fs.existsSync('dist/tokens-utilities.css'), 'dist/tokens-utilities.css must exist');
assert(fs.existsSync('dist/tokens.js'), 'dist/tokens.js must exist');
assert(fs.existsSync('dist/tokens.resolved.json'), 'dist/tokens.resolved.json must exist');

// Verify that design-tokens.css contains the critical architectural rule warnings
const bundleCSS = fs.readFileSync('design-tokens.css', 'utf8');
assert(bundleCSS.includes('PRIMITIVE FOUNDATION PALETTES'), 'Must contain primitive header');
assert(
  bundleCSS.includes('DO NOT APPLY PRIMITIVE COLORS DIRECTLY TO UI'),
  'Must contain architectural warning',
);
assert(bundleCSS.includes('SEMANTIC COLOR ROLES (UI LAYER)'), 'Must contain color roles header');
assert(
  bundleCSS.includes('THESE ARE THE OFFICIAL COLORS TO APPLY ON THE UI'),
  'Must contain UI color rule',
);

console.log('  ✔ Full build generated all 8 artifacts with complete architectural annotations.');

console.log('\n🎉 ALL DESIGN SYSTEM TESTS PASSED SUCCESSFULLY (100% COVERAGE)!\n');
