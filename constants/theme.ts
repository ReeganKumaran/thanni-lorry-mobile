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
  /**
   * Large text and non-text marks only.
   *
   * #8A8A84 measures 3.47:1 on `surface`, 3.24:1 on `background` and 3.04:1 on
   * `surfaceMuted` — over the 3:1 floor WCAG 2.2 sets for a graphic or a border,
   * under the 4.5:1 one it sets for text below 24px (or 18.66px bold). Every
   * label in this app is 13px or 16px, so reach for `textSecondary` (5.1-5.8:1)
   * for anything the traveller has to read.
   */
  textMuted: "#8A8A84",

  statusSafe: "#2E7D5B",
  /**
   * Borders, dots, markers and large text — not body copy.
   *
   * #A66A00 is 4.48:1 on `surface` and 3.93:1 on `surfaceMuted`, just under the
   * 4.5:1 text floor. Where amber carries a meaning, put the hue on the shape
   * and leave the words `colors.text`, the way `NavigationBanner` does; colour
   * is the redundant cue there, never the one carrying the fact (rule 6).
   */
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

/**
 * Motion durations (AURA_DESIGN.md section 23).
 *
 * Two values, because the app only has two kinds of movement: confirming a
 * touch, and a component moving between states. Anything longer would be
 * narrative, and section 24 is explicit that a safety transition is immediate —
 * the status surface changes, the screen never flashes.
 */
export const motion = {
  micro: 150,
  component: 220,
} as const;

/**
 * The one derived colour in the file.
 *
 * `statusRisk` darkened, used for the last phase of the SOS hold where the
 * control itself becomes the alarm. It lives here rather than inline in
 * `HoldButton` so the palette stays reviewable in one place; it is not a new
 * status colour and nothing else may use it.
 */
export const derived = {
  statusRiskDeep: "#8C1A12",
} as const;
