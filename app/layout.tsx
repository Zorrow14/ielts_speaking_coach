import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Source_Serif_4 } from "next/font/google";
import { cookies } from "next/headers";
import Nav from "@/components/Nav";
import {
  THEME_COLORS,
  THEME_COOKIE,
  parseThemeChoice,
  themeAttribute,
} from "@/lib/theme";
import "./globals.css";

/*
 * Fonts. next/font downloads these at BUILD time and serves them from
 * /_next/static/media, so the browser never contacts Google and the CSP's
 * `font-src 'self'` needs no loosening.
 *
 *   Source Serif 4  page titles and question text - the exam-booklet voice
 *   Geist           everything else
 *   Geist Mono      clocks and bands, with tabular figures so digits do not
 *                   jitter as a timer counts
 */
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

/*
 * One static weight, not the variable font. Every serif use is semibold
 * (titles, question text, cue card, part numbers), and the variable file
 * cost 50.7 KB against the redesign's page-weight budget. Measured, not
 * guessed - see the Stage 1 commit.
 */
const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  weight: "600",
  style: "normal",
  display: "swap",
});

export const metadata: Metadata = {
  title: "IELTS Speaking Coach",
  description:
    "Practise IELTS Speaking Parts 1-3 and get criterion-based feedback estimates.",
};

/**
 * viewport-fit=cover lets the layout reach under the iOS notch and home
 * indicator; the shell then pads itself back with env(safe-area-inset-*).
 *
 * theme-color follows the manual choice when there is one, otherwise the
 * system, so the phone's toolbar always matches the page behind it.
 */
export async function generateViewport(): Promise<Viewport> {
  const choice = parseThemeChoice((await cookies()).get(THEME_COOKIE)?.value);
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor:
      choice === "system"
        ? [
            { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
            { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
          ]
        : THEME_COLORS[choice],
  };
}

/**
 * The theme is read from a cookie HERE, on the server, and rendered straight
 * into <html data-theme>. That is what lets the first paint be correct
 * without an inline script (which the CSP and the project rules both keep
 * out). The cost, accepted deliberately: reading a cookie in the root layout
 * makes every route render dynamically, including /login.
 */
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const choice = parseThemeChoice((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html
      lang="en"
      data-theme={themeAttribute(choice)}
      className={`${geistSans.variable} ${geistMono.variable} ${sourceSerif.variable}`}
    >
      <body>
        <div className="app">
          <Nav initialTheme={choice} />
          <div className="app__content">{children}</div>
        </div>
      </body>
    </html>
  );
}
