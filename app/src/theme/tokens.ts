/**
 * Rota Health Design System Tokens
 * Source: DESIGN_SYSTEM_DOCUMENTATION.md & dist/tokens.resolved.json
 * Strictly implements Two-Tier Architecture (Color Roles on UI, Primitives as foundations)
 */

export const colors = {
  // Primary Palette Roles (Interactive & Brand Anchor)
  primary: '#004ed4',
  onPrimary: '#ffffff',
  primaryContainer: '#ccdfff',
  onPrimaryContainer: '#003899',

  // Secondary Palette Roles (Supporting Accents)
  secondary: '#003eaa',
  onSecondary: '#ffffff',
  secondaryContainer: '#d6e5ff',
  onSecondaryContainer: '#003eaa',

  // Tertiary Palette Roles (Accent Highlights)
  tertiary: '#005efe',
  onTertiary: '#ffffff',
  tertiaryContainer: '#ccdfff',
  onTertiaryContainer: '#003999',

  // Error Palette Roles (Destructive / Validation)
  error: '#c51707',
  onError: '#ffffff',
  errorContainer: '#fdd2ce',
  onErrorContainer: '#ad1406',

  // Surface & Neutral Roles
  surface: '#f9fafb',
  onSurface: '#16181d',
  surfaceVariant: '#e5e5e6',
  onSurfaceVariant: '#4b4c4e',

  // Surface Containers (Elevation Tones)
  surfaceContainerLowest: '#ffffff',
  surfaceContainerLow: '#f0f1f4',
  surfaceContainer: '#e8eaef',
  surfaceContainerHigh: '#e2e4e9',
  surfaceContainerHighest: '#dbdee4',

  // Outline / Borders
  outline: '#7d8082',
  outlineVariant: '#c8c8c9',

  // Background
  background: '#f9fafb',
  onBackground: '#16181d',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

export const radii = {
  xs: 4,
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 9999,
} as const;

export const typography = {
  headlineLarge: {
    fontSize: 28,
    fontWeight: '800' as const,
    lineHeight: 34,
    color: colors.onSurface,
  },
  headlineMedium: {
    fontSize: 22,
    fontWeight: '700' as const,
    lineHeight: 28,
    color: colors.onSurface,
  },
  titleMedium: {
    fontSize: 16,
    fontWeight: '600' as const,
    lineHeight: 22,
    color: colors.onSurface,
  },
  bodyLarge: {
    fontSize: 16,
    fontWeight: '400' as const,
    lineHeight: 24,
    color: colors.onSurface,
  },
  bodyMedium: {
    fontSize: 14,
    fontWeight: '400' as const,
    lineHeight: 20,
    color: colors.onSurfaceVariant,
  },
  bodySmall: {
    fontSize: 12,
    fontWeight: '400' as const,
    lineHeight: 16,
    color: colors.onSurfaceVariant,
  },
  labelLarge: {
    fontSize: 14,
    fontWeight: '600' as const,
    lineHeight: 20,
  },
  labelMedium: {
    fontSize: 12,
    fontWeight: '600' as const,
    lineHeight: 16,
  },
  labelSmall: {
    fontSize: 11,
    fontWeight: '700' as const,
    lineHeight: 16,
    letterSpacing: 1.2,
  },
} as const;

