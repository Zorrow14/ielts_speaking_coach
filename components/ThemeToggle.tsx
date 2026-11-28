"use client";

/**
 * System / Light / Dark.
 *
 * Built from real radio inputs inside a fieldset, so arrow keys move between
 * the options and a screen reader announces "Theme, Dark, selected, 3 of 3"
 * without any ARIA written by hand.
 *
 * A change does two things and makes no network request:
 *   1. sets or removes data-theme on <html>, so the page changes immediately;
 *   2. writes the `theme` cookie, so the server renders the same choice on the
 *      next full page load (see lib/theme.ts for why a cookie).
 *
 * Controlled: the value and setter come from useThemeChoice() in the nav,
 * whose initial value the server read from the cookie, so the control and
 * the page agree on the first render.
 */
import { useState } from "react";
import Icon, { type IconName } from "./Icon";
import {
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  themeAttribute,
  type ThemeChoice,
} from "@/lib/theme";

const OPTIONS: Array<{ value: ThemeChoice; label: string; icon: IconName }> = [
  { value: "system", label: "System", icon: "monitor" },
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
];

function persist(choice: ThemeChoice) {
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  // "system" is no choice at all: delete the cookie rather than store a word.
  document.cookie =
    choice === "system"
      ? `${THEME_COOKIE}=; path=/; max-age=0; samesite=lax${secure}`
      : `${THEME_COOKIE}=${choice}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax${secure}`;
}

function apply(choice: ThemeChoice) {
  const attribute = themeAttribute(choice);
  if (attribute) document.documentElement.setAttribute("data-theme", attribute);
  else document.documentElement.removeAttribute("data-theme");
}

/**
 * The choice, plus a setter that applies and persists it. Owned by the nav,
 * which renders the control twice (sidebar and phone sheet) - one source of
 * truth keeps the two copies from disagreeing.
 */
export function useThemeChoice(
  initial: ThemeChoice,
): [ThemeChoice, (next: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(initial);
  function choose(next: ThemeChoice) {
    setChoice(next);
    apply(next);
    persist(next);
  }
  return [choice, choose];
}

export default function ThemeToggle({
  value,
  onChange,
  idPrefix,
}: {
  value: ThemeChoice;
  onChange: (next: ThemeChoice) => void;
  /** Two toggles can be on the page (sidebar and sheet); ids must differ. */
  idPrefix: string;
}) {
  return (
    <fieldset className="segmented">
      <legend className="visually-hidden">Theme</legend>
      {OPTIONS.map((option) => {
        const id = `${idPrefix}-theme-${option.value}`;
        return (
          <label key={option.value} className="segmented__option" htmlFor={id}>
            <input
              id={id}
              type="radio"
              name={`${idPrefix}-theme`}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>
              <Icon name={option.icon} />
              {option.label}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
