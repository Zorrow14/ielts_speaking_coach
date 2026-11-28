/**
 * The design system's rules, enforced.
 *
 * Written after the redesign audit found two bugs that had been shipping:
 *
 *   - Feature A's CSS used five custom properties (--accent, --surface-2,
 *     --text, --border, --muted) that were never defined. The retry banner
 *     and comparison borders rendered invisibly, and nothing complained.
 *   - A bullet rule contained an invisible control character followed by a
 *     literal "2", so every bullet in the app showed "2".
 *
 * Both are the kind of thing a person never spots and a test spots
 * instantly. These checks read the stylesheets and assert the properties the
 * token system depends on.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = process.cwd();
const STYLES = join(ROOT, "app", "styles");

const files = readdirSync(STYLES)
  .filter((name) => name.endsWith(".css"))
  .map((name) => ({ name, source: readFileSync(join(STYLES, name), "utf8") }));

const tokens = files.find((file) => file.name === "tokens.css")!.source;

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Font variables are defined by next/font in app/layout.tsx, not in CSS. */
const DEFINED_BY_NEXT_FONT = new Set([
  "--font-geist-sans",
  "--font-geist-mono",
  "--font-source-serif",
]);

describe("every custom property that is used is defined", () => {
  const defined = new Set<string>(DEFINED_BY_NEXT_FONT);
  for (const { source } of files) {
    for (const match of stripComments(source).matchAll(/(--[a-z0-9-]+)\s*:/g)) {
      defined.add(match[1]);
    }
  }

  for (const { name, source } of files) {
    it(`${name} uses only defined tokens`, () => {
      const used = [...stripComments(source).matchAll(/var\(\s*(--[a-z0-9-]+)/g)];
      for (const [, property] of used) {
        assert.ok(
          defined.has(property),
          `${name} uses ${property}, which is never defined. An undefined custom property silently becomes "unset" - this is exactly how the feature A borders vanished.`,
        );
      }
    });
  }
});

describe("raw colours live in tokens.css and nowhere else", () => {
  const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/;

  for (const { name, source } of files) {
    if (name === "tokens.css") continue;
    it(`${name} contains no raw colour values`, () => {
      const lines = stripComments(source).split("\n");
      lines.forEach((line, index) => {
        assert.ok(
          !COLOUR.test(line),
          `${name}:${index + 1} has a raw colour: "${line.trim()}". Add a token to tokens.css and use var() instead.`,
        );
      });
    });
  }
});

describe("dark mode cannot drift between its two definitions", () => {
  /** The custom properties set inside the first block matching `opener`. */
  function block(opener: RegExp): Map<string, string> {
    const css = stripComments(tokens);
    const start = css.search(opener);
    assert.notEqual(start, -1, `could not find ${opener}`);
    const open = css.indexOf("{", start);
    let depth = 0;
    let end = open;
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const body = css.slice(open + 1, end);
    const values = new Map<string, string>();
    for (const match of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      values.set(match[1], match[2].trim().toLowerCase());
    }
    return values;
  }

  it("the manual and system dark blocks define identical values", () => {
    const manual = block(/:root\[data-theme="dark"\]\s*\{/);
    const system = block(/:root:not\(\[data-theme="light"\]\)\s*\{/);

    assert.ok(manual.size >= 15, `manual dark block only has ${manual.size} tokens`);
    assert.deepEqual(
      [...system.entries()].sort(),
      [...manual.entries()].sort(),
      "the two dark-mode blocks in tokens.css have drifted apart",
    );
  });

  it("every colour token has a dark value", () => {
    const light = block(/:root\s*\{/);
    const dark = block(/:root\[data-theme="dark"\]\s*\{/);
    const colourTokens = [...light.keys()].filter(
      (key) => key.startsWith("--color-") || key === "--shadow-color",
    );
    assert.ok(colourTokens.length >= 15);
    for (const key of colourTokens) {
      assert.ok(
        dark.has(key),
        `${key} has a light value but no dark one, so dark mode would show the light colour`,
      );
    }
  });
});

describe("the browser toolbar colour matches the page", () => {
  it("THEME_COLORS in lib/theme.ts equals --color-bg in each theme", () => {
    const theme = readFileSync(join(ROOT, "lib", "theme.ts"), "utf8");
    const light = /light:\s*"(#[0-9a-f]{6})"/i.exec(theme)?.[1]?.toLowerCase();
    const dark = /dark:\s*"(#[0-9a-f]{6})"/i.exec(theme)?.[1]?.toLowerCase();

    const css = stripComments(tokens);
    const bgLight = /:root\s*\{[\s\S]*?--color-bg:\s*(#[0-9a-f]{6})/i.exec(css)?.[1];
    const bgDark = /:root\[data-theme="dark"\]\s*\{[\s\S]*?--color-bg:\s*(#[0-9a-f]{6})/i.exec(css)?.[1];

    assert.equal(light, bgLight?.toLowerCase(), "light theme-color differs from --color-bg");
    assert.equal(dark, bgDark?.toLowerCase(), "dark theme-color differs from --color-bg");
  });
});

describe("the cascade order is explicit", () => {
  const globals = readFileSync(join(ROOT, "app", "globals.css"), "utf8");
  const layers = files.find((file) => file.name === "layers.css")!.source;

  it("layers.css declares the order", () => {
    assert.match(
      stripComments(layers),
      /@layer\s+reset,\s*tokens,\s*base,\s*components,\s*shell,\s*pages,\s*utilities;/,
    );
  });

  it("globals.css imports layers.css before anything else", () => {
    // Imported first, or the bundler emits it after the other files and the
    // order silently falls back to import order. This happened.
    const imports = [...stripComments(globals).matchAll(/@import\s+"([^"]+)"/g)].map(
      (match) => match[1],
    );
    assert.equal(imports[0], "./styles/layers.css");
  });

  it("globals.css imports every stylesheet in app/styles", () => {
    for (const { name } of files) {
      assert.ok(
        globals.includes(`./styles/${name}`),
        `app/styles/${name} exists but globals.css never imports it`,
      );
    }
  });

  for (const { name, source } of files) {
    if (name === "layers.css") continue;
    it(`${name} puts every rule inside a declared layer`, () => {
      // An unlayered rule beats every layered rule regardless of specificity,
      // so a single one quietly overrides the whole system.
      const css = stripComments(source).trim();
      let depth = 0;
      let index = 0;
      while (index < css.length) {
        const char = css[index];
        if (char === "{") {
          if (depth === 0) {
            const prelude = css.slice(0, index).split("}").pop()!.trim();
            assert.match(
              prelude,
              /^@layer\s+(reset|tokens|base|components|shell|pages|utilities)$/,
              `${name} has a top-level rule outside a layer: "${prelude.slice(0, 60)}"`,
            );
          }
          depth += 1;
        } else if (char === "}") {
          depth -= 1;
        }
        index += 1;
      }
    });
  }
});

describe("no shorthand silently cancels a longhand written before it", () => {
  /*
   * A shorthand resets every property it covers, so writing it AFTER one of
   * its own longhands in the same rule throws the longhand away. That is how
   * the sidebar stopped sticking: `top: 0; inset: auto;` reset top to auto,
   * and a sticky element with no offset scrolls away with the page. Nothing
   * complains - the rule is valid CSS - so it needs a test.
   */
  const COVERS: Record<string, RegExp> = {
    inset: /^(top|right|bottom|left|inset-(block|inline)(-start|-end)?)$/,
    padding: /^padding-/,
    margin: /^margin-/,
    border: /^border-(top|right|bottom|left|width|style|color)(-width|-style|-color)?$/,
    font: /^(font-(size|weight|family|style|variant|stretch)|line-height)$/,
    background: /^background-(color|image|position|size|repeat|attachment|origin|clip)$/,
    gap: /^(row-gap|column-gap)$/,
    flex: /^flex-(grow|shrink|basis)$/,
    overflow: /^overflow-(x|y)$/,
    outline: /^outline-(width|style|color)$/,
    transition: /^transition-/,
    animation: /^animation-/,
    "list-style": /^list-style-/,
    "text-decoration": /^text-decoration-(line|color|style|thickness)$/,
  };

  for (const { name, source } of files) {
    it(`${name} has no shorthand after its own longhand`, () => {
      const css = stripComments(source);
      // Innermost declaration blocks: braces that contain no further braces.
      for (const block of css.matchAll(/\{([^{}]*)\}/g)) {
        const properties = [...block[1].matchAll(/(?:^|;)\s*([a-z-]+)\s*:/g)].map(
          (match) => match[1],
        );
        properties.forEach((property, index) => {
          const covers = COVERS[property];
          if (!covers) return;
          const earlier = properties.slice(0, index).find((p) => covers.test(p));
          assert.equal(
            earlier,
            undefined,
            `${name}: "${property}" comes after "${earlier}" in the same rule and silently resets it. Put the shorthand first.`,
          );
        });
      }
    });
  }
});

describe("no invisible characters hide in the stylesheets", () => {
  for (const { name, source } of files) {
    it(`${name} is free of control characters`, () => {
      // U+0080-U+009F are C1 control codes: invisible in an editor, and how
      // the bullet rule came to render a literal "2".
      const offender = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u0080-\u009F]/.exec(source);
      assert.equal(
        offender,
        null,
        `${name} contains an invisible control character (U+${offender?.[0]
          .charCodeAt(0)
          .toString(16)
          .toUpperCase()
          .padStart(4, "0")})`,
      );
    });
  }
});
