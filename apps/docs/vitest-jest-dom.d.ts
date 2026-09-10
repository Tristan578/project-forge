/// <reference types="@testing-library/jest-dom/vitest" />

// vitest 5 changed the shape of `Assertion`, so `@testing-library/jest-dom`'s
// own augmentation (written against the jest/`expect` shape) no longer lands on
// it: `toHaveTextContent`, `toHaveAttribute` and `toBeInTheDocument` type-error
// even though they work at runtime. The `/vitest` entry carries the
// vitest-shaped augmentation, and this file is how it reaches the project —
// `tsconfig.json` includes `**/*.ts`, so no config change is needed.
//
// `web/vitest-jest-dom.d.ts` is the same file for the same reason; this is the
// docs app catching up because it had no component test using these matchers
// until now.
