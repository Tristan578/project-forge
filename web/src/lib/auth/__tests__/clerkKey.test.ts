/**
 * Guards the Clerk publishable-key shape check for the web app (#9044).
 *
 * The defect this exists for: docs.spawnforge.ai had the whole
 * `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...` assignment pasted in as the
 * VALUE of that variable. Clerk base64-decodes the key to derive its script
 * host, so the malformed value produced an EMPTY host, clerk-js was requested
 * from `https:///npm/...`, and every sign-in was dead — silently, because the
 * app's prefix check read "not a valid key" as "Clerk is not set up here".
 *
 * The web app carried the identical unguarded prefix check inline in
 * `app/layout.tsx`, so the same paste would have taken the paid funnel down the
 * same way. These tests pin the distinction the fix rests on — MISSING is
 * legitimate and silent, MALFORMED fails the build — plus the two call sites,
 * because "this file stopped calling the guard" is the absence of a rule and
 * cannot be asserted by rendering.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  assertClerkPublishableKeyShape,
  clerkPublishableKeyHasSurroundingWhitespace,
  clerkPublishableKeyProblem,
  hasValidClerkKey,
} from "../clerkKey";

/** The exact shape that was live on the docs Vercel project. */
const PASTED_ASSIGNMENT = "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_c3Bhd25mb3JnZS5haSQ";

/** `pk_(test|live)_` + base64 of `<host>$` — the real key shape. */
const keyFor = (host: string, prefix = "pk_test_") =>
  `${prefix}${Buffer.from(`${host}$`, "utf8").toString("base64")}`;

const VALID_LIVE = keyFor("clerk.spawnforge.ai", "pk_live_");
const VALID_TEST = keyFor("sunny-cat-42.clerk.accounts.dev");

const WEB_ROOT = resolve(__dirname, "..", "..", "..", "..");
const read = (...parts: string[]) => readFileSync(join(WEB_ROOT, ...parts), "utf-8");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("clerkPublishableKeyProblem", () => {
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["a valid test key", VALID_TEST],
    ["a valid live key", VALID_LIVE],
  ])("reports no problem for %s", (_label, key) => {
    expect(clerkPublishableKeyProblem(key)).toBeNull();
  });

  it("names the paste-the-whole-assignment mistake specifically", () => {
    const problem = clerkPublishableKeyProblem(PASTED_ASSIGNMENT);
    expect(problem).not.toBeNull();
    // The point of the message is that it says what to fix. A generic
    // "invalid key" would be as useless as the silence it replaces.
    expect(problem).toContain("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...");
    expect(problem).toContain("pasted in as the VALUE");
  });

  it("names a secret key without echoing it", () => {
    const problem = clerkPublishableKeyProblem("sk_live_realsecretvalue");
    expect(problem).toContain("SECRET key");
    expect(problem).not.toContain("realsecretvalue");
  });

  it("reports a genuinely wrong value", () => {
    expect(clerkPublishableKeyProblem("your-key-here")).toContain("which is not");
  });

  // #9558. Surrounding whitespace is NOT a problem: Clerk trims, and rejecting
  // it failed the docs production deploy on a key the live site was running on.
  //
  // The trailing cases are the ones that bit. `clerkFrontendApiHost` extracts
  // the payload with /^pk_(?:test|live)_(.+)$/ — no `s` flag — so `.` cannot
  // cross a newline and the regex matched NOTHING, which surfaced as the
  // misleading "payload does not decode". #9539's suite only covered LEADING
  // whitespace, which fails the prefix check and never reaches the decode path.
  it.each([
    ["a trailing newline (the deploy-breaking case)", `${VALID_LIVE}\n`],
    ["a trailing CRLF", `${VALID_LIVE}\r\n`],
    ["a trailing space", `${VALID_TEST} `],
    ["a trailing tab", `${VALID_TEST}\t`],
    ["a leading space", ` ${VALID_TEST}`],
    ["whitespace on both sides", ` ${VALID_TEST} `],
  ])("accepts an otherwise-valid key with %s", (_label, key) => {
    expect(clerkPublishableKeyProblem(key)).toBeNull();
    expect(hasValidClerkKey(key)).toBe(true);
    expect(() => assertClerkPublishableKeyShape(key)).not.toThrow();
  });

  it("still rejects a whitespace-padded key whose payload is genuinely bad", () => {
    expect(clerkPublishableKeyProblem(" pk_test_xxx \n")).toContain(
      "does not decode to a Clerk Frontend API host",
    );
  });

  // The prefix alone is NOT the contract. Clerk base64-encodes `<host>$` in the
  // payload and derives its script host from it, so a right-prefix key with a
  // junk payload resolves to an EMPTY host — which is precisely how clerk-js
  // came to be fetched from `https:///npm/...`. The same decode feeds the /play
  // CSP, so such a key also drops Clerk from that allowlist.
  it.each([
    ["an empty payload", "pk_test_"],
    ["a payload that is not valid base64", "pk_live_!!!not-base64!!!"],
    ["a payload missing Clerk's $ terminator", `pk_test_${Buffer.from("clerk.example.com", "utf8").toString("base64")}`],
    ["a payload decoding to something that is not a hostname", `pk_test_${Buffer.from("not a host$", "utf8").toString("base64")}`],
    ["a truncated payload", VALID_LIVE.slice(0, VALID_LIVE.length - 6)],
    ["the .env.example placeholder", "pk_test_xxx"],
  ])("rejects %s despite the valid prefix", (_label, key) => {
    const problem = clerkPublishableKeyProblem(key);
    expect(problem, `expected ${key} to be rejected`).not.toBeNull();
    expect(problem).toContain("does not decode to a Clerk Frontend API host");
  });

  it.each([
    ["a development instance key", VALID_TEST],
    ["a production custom-domain key", VALID_LIVE],
  ])("accepts %s, whose payload decodes to a real host", (_label, key) => {
    expect(clerkPublishableKeyProblem(key)).toBeNull();
  });
});

describe("hasValidClerkKey", () => {
  it.each([VALID_TEST, VALID_LIVE])("accepts a well-formed key (%s)", (key) => {
    expect(hasValidClerkKey(key)).toBe(true);
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["a placeholder", "your-key-here"],
    ["a secret key pasted by mistake", "sk_test_deadbeef"],
    ["whitespace-prefixed junk", " pk_test_deadbeef"],
    ["a whitespace-only value", "   "],
    ["the whole KEY=value assignment pasted as the value", PASTED_ASSIGNMENT],
  ])("rejects %s", (_label, key) => {
    expect(hasValidClerkKey(key)).toBe(false);
  });

  it("reads process.env when called with no argument", () => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", VALID_LIVE);
    expect(hasValidClerkKey()).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", PASTED_ASSIGNMENT);
    expect(hasValidClerkKey()).toBe(false);
  });
});

describe("clerkPublishableKeyHasSurroundingWhitespace", () => {
  // Usable-but-untidy is its own state: it must warn, never fail.
  it.each([
    ["a trailing newline", `${VALID_LIVE}\n`],
    ["a leading space", ` ${VALID_TEST}`],
  ])("flags %s", (_label, key) => {
    expect(clerkPublishableKeyHasSurroundingWhitespace(key)).toBe(true);
  });

  it.each([
    ["a clean key", VALID_LIVE],
    ["an absent value", undefined],
    ["an empty value", ""],
    ["a whitespace-only value", "   "],
    ["a padded but genuinely broken key", " pk_test_xxx "],
  ])("does not flag %s", (_label, key) => {
    expect(clerkPublishableKeyHasSurroundingWhitespace(key)).toBe(false);
  });
});

describe("assertClerkPublishableKeyShape", () => {
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["a valid live key", VALID_LIVE],
  ])("does not throw for %s", (_label, key) => {
    // A missing key MUST stay silent: CI E2E builds and local checkouts have
    // none, and turning that into a build failure would be a regression, not a
    // hardening.
    expect(() => assertClerkPublishableKeyShape(key)).not.toThrow();
  });

  it("throws on the production paste error, naming the variable", () => {
    expect(() => assertClerkPublishableKeyShape(PASTED_ASSIGNMENT)).toThrow(
      /NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is set but unusable/,
    );
  });

  it("reads process.env when called with no argument", () => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", PASTED_ASSIGNMENT);
    expect(() => assertClerkPublishableKeyShape()).toThrow(/set but unusable/);
  });
});

describe("call sites", () => {
  it("next.config.ts calls the guard, not merely imports it", () => {
    // A guard nobody calls is not a guard. next.config.ts is evaluated by
    // `next build`, so this call is what makes a bad value a red deploy rather
    // than a silently broken auth surface.
    const config = read("next.config.ts");
    expect(config).toMatch(/from "\.\/src\/lib\/auth\/clerkKey"/);
    expect(
      config,
      "next.config.ts imports assertClerkPublishableKeyShape but never calls it — " +
        "a malformed key would build clean and ship dead auth again (#9044).",
    ).toMatch(/^assertClerkPublishableKeyShape\(\);$/m);
  });

  it("a fresh copy of .env.example still builds", () => {
    // README tells newcomers to `cp web/.env.example web/.env.local`. Because
    // this guard runs in next.config.ts, a placeholder left in that template
    // would fail `next dev` outright — the quick start would exit before
    // serving anything. Every other placeholder in the file is inert; this one
    // is not, so it ships commented out and this test is what keeps it that
    // way.
    const example = read(".env.example");
    const line = example
      .split(/\r?\n/)
      .find((l) => /^\s*NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY\s*=/.test(l));

    if (line === undefined) return; // absent is a supported state

    const value = line.slice(line.indexOf("=") + 1).trim();
    expect(
      () => assertClerkPublishableKeyShape(value),
      `web/.env.example sets NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${value}, which the ` +
        "build rejects. Copying the template would break `npm run dev` for every new " +
        "contributor. Comment the line out, or use a real key.",
    ).not.toThrow();
  });

  it("layout.tsx gates <ClerkProvider> on the shared predicate", () => {
    const layout = read("src", "app", "layout.tsx");
    const code = layout.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

    expect(code).toMatch(/from "@\/lib\/auth\/clerkKey"/);
    expect(
      code,
      "layout.tsx re-implemented the prefix check inline. It must use the shared " +
        "predicate, or the two copies drift and next.config.ts stops guarding what " +
        "the layout actually consults (#9044).",
    ).not.toMatch(/startsWith\("pk_(test|live)_"\)/);
    expect(code).toMatch(/hasValidClerkKey\s*\?\s*\(/);
  });
});
