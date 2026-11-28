"use client";

/**
 * Primary navigation.
 *
 *   Phones (< 48rem): a bottom tab bar - Home, Practise, History, Progress,
 *   More. Thumbs reach the bottom of the screen, not the top. "More" opens a
 *   sheet with Mistakes, Vocabulary, Weekly, the theme switch and sign-out.
 *
 *   Wider screens: a left sidebar with every destination, the theme switch
 *   and sign-out.
 *
 * One <nav> landmark holds both layouts and CSS shows exactly one, so the
 * hidden one is display:none and a screen reader never hears the links twice.
 *
 * The sheet is a native <dialog> opened with showModal(): focus is trapped
 * inside it, Escape closes it, and focus returns to the More button on close,
 * all from the browser rather than hand-written code.
 *
 * Hidden on /login, where there is nothing to navigate to yet.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { signOutAction } from "@/app/actions";
import type { ThemeChoice } from "@/lib/theme";
import Icon, { type IconName } from "./Icon";
import ThemeToggle, { useThemeChoice } from "./ThemeToggle";

type Destination = { href: string; label: string; icon: IconName };

const HOME: Destination = { href: "/", label: "Home", icon: "home" };
const PRACTISE: Destination = { href: "/practice", label: "Practise", icon: "mic" };
const HISTORY: Destination = { href: "/history", label: "History", icon: "history" };
const PROGRESS: Destination = { href: "/progress", label: "Progress", icon: "chart" };
const MISTAKES: Destination = { href: "/mistakes", label: "Mistakes", icon: "target" };
const VOCAB: Destination = { href: "/vocab", label: "Vocabulary", icon: "book" };
const WEEKLY: Destination = { href: "/weekly", label: "Weekly report", icon: "calendar" };

/** What the "More" sheet holds; the More tab is active on any of these. */
const MORE = [MISTAKES, VOCAB, WEEKLY];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Nav({ initialTheme }: { initialTheme: ThemeChoice }) {
  const pathname = usePathname();
  const sheetRef = useRef<HTMLDialogElement>(null);
  const [theme, setTheme] = useThemeChoice(initialTheme);

  // Navigating anywhere closes the sheet. Calling close() is not a state
  // update, so this is a plain effect with nothing to re-render.
  useEffect(() => {
    sheetRef.current?.close();
  }, [pathname]);

  if (pathname === "/login") return null;

  const moreActive = MORE.some((item) => isActive(pathname, item.href));

  const link = (item: Destination) => {
    const active = isActive(pathname, item.href);
    return (
      <li key={item.href}>
        <Link
          className="nav__link"
          href={item.href}
          aria-current={active ? "page" : undefined}
        >
          <Icon name={item.icon} />
          {item.label}
        </Link>
      </li>
    );
  };

  const tab = (item: Destination) => {
    const active = isActive(pathname, item.href);
    return (
      <li key={item.href}>
        <Link
          className="nav__tab"
          href={item.href}
          aria-current={active ? "page" : undefined}
        >
          <Icon name={item.icon} />
          {item.label}
        </Link>
      </li>
    );
  };

  const signOut = (
    <form action={signOutAction}>
      <button type="submit" className="nav__link nav__signout">
        <Icon name="logout" />
        Sign out
      </button>
    </form>
  );

  return (
    <nav className="nav" aria-label="Main">
      {/* ---- Sidebar: 48rem and wider ---- */}
      <div className="nav__sidebar">
        <Link className="nav__brand" href="/">
          <Icon name="brand" />
          Speaking Coach
        </Link>

        <ul className="nav__list">{[HOME, PRACTISE].map(link)}</ul>

        <div>
          <p className="nav__group-label">Review</p>
          <ul className="nav__list">
            {[HISTORY, PROGRESS, MISTAKES, VOCAB, WEEKLY].map(link)}
          </ul>
        </div>

        <div className="nav__footer">
          <ThemeToggle value={theme} onChange={setTheme} idPrefix="sidebar" />
          {signOut}
        </div>
      </div>

      {/* ---- Bottom tab bar: phones ---- */}
      <ul className="nav__tabs">
        {[HOME, PRACTISE, HISTORY, PROGRESS].map(tab)}
        <li>
          <button
            type="button"
            className={`nav__tab${moreActive ? " nav__tab--active" : ""}`}
            aria-haspopup="dialog"
            aria-controls="more-sheet"
            onClick={() => sheetRef.current?.showModal()}
          >
            <Icon name="more" />
            More
          </button>
        </li>
      </ul>

      <dialog
        id="more-sheet"
        ref={sheetRef}
        className="dialog dialog--sheet"
        aria-labelledby="more-sheet-title"
        // A tap on the backdrop (the dialog element itself, outside its body)
        // closes the sheet, as people expect from a bottom sheet.
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <div className="dialog__body">
          <div className="dialog__header">
            <h2 id="more-sheet-title">More</h2>
            <button
              type="button"
              className="icon-button"
              aria-label="Close"
              onClick={() => sheetRef.current?.close()}
            >
              <Icon name="close" />
            </button>
          </div>

          <ul className="more-sheet__list">{MORE.map(link)}</ul>

          <div className="more-sheet__section">
            <p className="nav__group-label">Theme</p>
            <ThemeToggle value={theme} onChange={setTheme} idPrefix="sheet" />
          </div>

          <div className="more-sheet__section">{signOut}</div>
        </div>
      </dialog>
    </nav>
  );
}
