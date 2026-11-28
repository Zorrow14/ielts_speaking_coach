/**
 * The manual theme choice.
 *
 * Stored in a first-party cookie, not localStorage: the server reads it in
 * app/layout.tsx and renders `data-theme` on <html> directly, so the very
 * first paint is in the right theme with no inline script and no flash. The
 * project rules forbid localStorage and sessionStorage, and a database column
 * would be a schema change for a display preference.
 *
 * "system" is the absence of a choice: the cookie is deleted and the CSS
 * follows prefers-color-scheme.
 *
 * The cookie holds one of three fixed words and nothing else. It is not a
 * secret, not an identifier, and not used for anything but this attribute.
 */

export const THEME_COOKIE = "theme";

export type ThemeChoice = "system" | "light" | "dark";

/** One year. A display preference has no reason to expire sooner. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * The browser toolbar colour on phones (<meta name="theme-color">).
 *
 * MUST equal --color-bg in app/styles/tokens.css for each theme. The design
 * token test reads both files and fails if they drift, because a toolbar one
 * shade off the page is exactly the kind of thing nobody notices until it
 * looks broken.
 */
export const THEME_COLORS = {
  light: "#f7f5f0",
  dark: "#14171a",
} as const;

/** Anything unexpected becomes "system", so a tampered cookie is harmless. */
export function parseThemeChoice(value: string | undefined | null): ThemeChoice {
  return value === "light" || value === "dark" ? value : "system";
}

/** The value for <html data-theme>, or undefined to follow the system. */
export function themeAttribute(choice: ThemeChoice): "light" | "dark" | undefined {
  return choice === "system" ? undefined : choice;
}
