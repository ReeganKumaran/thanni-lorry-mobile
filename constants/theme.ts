/**
 * AURA design tokens for mobile.
 * Values come straight from AURA_DESIGN.md sections 03 (color), 04 (typography),
 * 05 (spacing) and 06 (radius). Do not scatter arbitrary values across components.
 */

export const colors = {
  background: "#F7F7F5",
  surface: "#FFFFFF",
  surfaceMuted: "#F0F0ED",
  border: "#DEDED9",

  text: "#171717",
  textSecondary: "#666661",
  textMuted: "#8A8A84",

  statusSafe: "#2E7D5B",
  statusAttention: "#A66A00",
  statusRisk: "#B42318",
  statusInfo: "#2856A3",

  /** Solid neutral/dark primary button (AURA_DESIGN.md section 28). */
  actionPrimary: "#171717",
  onActionPrimary: "#FFFFFF",
} as const;

export const space = {
  micro: 4,
  tight: 8,
  compact: 12,
  default: 16,
  section: 24,
  large: 32,
  major: 48,
  page: 64,
} as const;

export const radius = {
  /** Small controls. */
  sm: 8,
  /** Cards. */
  md: 12,
  /** Large surfaces. */
  lg: 16,
} as const;

export const fontSize = {
  display: 48,
  pageTitle: 32,
  section: 22,
  cardTitle: 17,
  body: 16,
  meta: 13,
} as const;

export const fontWeight = {
  regular: "400",
  medium: "500",
  semibold: "600",
} as const;

/**
 * Minimum touch target is 44x44 (AURA_DESIGN.md section 30); primary safety
 * actions are deliberately much larger.
 */
export const touchTarget = {
  min: 44,
  comfortable: 64,
  safetyAction: 96,
} as const;

export const border = {
  width: 1,
  color: colors.border,
} as const;
