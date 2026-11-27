"use client";

/**
 * Primary navigation. A client component only so the current section can be
 * marked - there is no other interactivity here.
 *
 * On a phone it is a single horizontally scrollable row with momentum
 * scrolling, which keeps all six destinations reachable without a hamburger
 * menu and without a second tap.
 *
 * Hidden on /login, where there is nothing to navigate to yet.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/practice", label: "Practise" },
  { href: "/history", label: "History" },
  { href: "/progress", label: "Progress" },
  { href: "/mistakes", label: "Mistakes" },
  { href: "/vocab", label: "Vocabulary" },
  { href: "/weekly", label: "Weekly" },
] as const;

export default function Nav() {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  return (
    <nav className="nav" aria-label="Main">
      <Link className="nav__brand" href="/">
        Coach
      </Link>
      <ul className="nav__list">
        {LINKS.map((link) => {
          const active =
            pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <li key={link.href}>
              <Link
                className={`nav__link${active ? " nav__link--active" : ""}`}
                href={link.href}
                aria-current={active ? "page" : undefined}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
