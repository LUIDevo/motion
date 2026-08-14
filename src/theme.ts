import { useSyncExternalStore } from "react";

/**
 * Theme state. The palette lives in styles.css — two Catppuccin flavours,
 * Latte (light) and Mocha (dark), selected by a `data-theme` attribute on
 * <html>. This module just decides which one is active.
 *
 * An explicit choice is remembered in localStorage; otherwise we follow the
 * OS. The same decision is made in an inline script in index.html before
 * first paint, so the app never flashes the wrong palette.
 */

export type Theme = "light" | "dark";

const KEY = "motion.theme";
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  emit();
}

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function storedTheme(): Theme | null {
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" ? v : null;
}

export function setTheme(theme: Theme) {
  localStorage.setItem(KEY, theme);
  apply(theme);
}

/** Flip the current theme and remember the choice. */
export function toggleTheme(): Theme {
  const next = currentTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}

/** React hook that re-renders on theme changes. */
export function useTheme(): Theme {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    currentTheme,
  );
}

/**
 * Resolve a CSS custom property to a concrete colour, cached per theme.
 * Canvas drawing (the target ring on the preview) can't use var() the way
 * DOM styles can, so it asks for the resolved value instead.
 */
const colorCache = new Map<string, Map<Theme, string>>();
export function cssVar(name: string, fallback = ""): string {
  const theme = currentTheme();
  let byTheme = colorCache.get(name);
  if (!byTheme || !byTheme.has(theme)) {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    byTheme = byTheme ?? new Map();
    byTheme.set(theme, value || fallback);
    colorCache.set(name, byTheme);
  }
  return byTheme.get(theme)!;
}

/** Apply the saved preference, or follow the OS when none is saved. */
export function initTheme() {
  const stored = storedTheme();
  apply(stored ?? systemTheme());
  if (stored) return;

  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = (e: MediaQueryListEvent) => apply(e.matches ? "dark" : "light");
  mq.addEventListener("change", onChange);
}
