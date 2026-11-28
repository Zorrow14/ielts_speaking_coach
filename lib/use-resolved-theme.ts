"use client";

/**
 * Which theme is actually on screen right now: "light" or "dark".
 *
 * Two inputs decide it - a manual choice in <html data-theme>, which wins,
 * and otherwise the operating system's prefers-color-scheme. Both can change
 * while the page is open, so this subscribes to both: a MutationObserver on
 * the attribute (the theme switch writes it directly) and the media query.
 *
 * Exists for the one place CSS cannot reach: Chart.js draws onto a canvas
 * with colours passed in from JavaScript, so the progress charts need to know
 * the theme to pick their dark-mode series steps.
 *
 * useSyncExternalStore rather than useEffect + useState, so there is no
 * render with a stale theme and no setState-in-effect.
 */
import { useSyncExternalStore } from "react";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener("change", onChange);

  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  return () => {
    media.removeEventListener("change", onChange);
    observer.disconnect();
  };
}

function getSnapshot(): "light" | "dark" {
  const manual = document.documentElement.getAttribute("data-theme");
  if (manual === "light" || manual === "dark") return manual;
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

/** The server cannot know; light is the neutral default for the first pass. */
function getServerSnapshot(): "light" | "dark" {
  return "light";
}

export function useResolvedTheme(): "light" | "dark" {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
