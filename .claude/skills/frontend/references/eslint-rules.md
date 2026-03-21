# ESLint Rules (Zero Tolerance — Zero Warnings)

Enforced in CI with `npx eslint --max-warnings 0`. Never leave warnings for later.

| Rule | Fix |
|------|-----|
| `@typescript-eslint/no-unused-vars` | Remove it, or prefix with `_` if intentional (`argsIgnorePattern: ^_`, `varsIgnorePattern: ^_`, `destructuredArrayIgnorePattern: ^_`) |
| `react-hooks/purity` | No `Date.now()`, `performance.now()`, `Math.random()` during render. Move to `useEffect`/`useMemo`/event handler |
| `react-hooks/refs` | No `useRef.current` during render. Use useState prev-value pattern |
| `react-hooks/set-state-in-effect` | No synchronous `setState` in effect bodies. Use `useMemo` or prev-value |
| `react-hooks/exhaustive-deps` | List all deps. Wrap handlers in `useCallback` for stability |
| `@next/next/no-img-element` | Use `next/image`. Exception: dynamic data URLs with inline `eslint-disable-next-line` |
| `jsx-a11y/alt-text` | Lucide `Image` icon: import as `ImageIcon` to avoid false positive |

## The useState Prev-Value Pattern

```tsx
// CORRECT: derived state without useEffect
const [prev, setPrev] = useState(prop);
if (prev !== prop) {
  setPrev(prop);
  setDerived(compute(prop));
}

// WRONG: useRef during render (ESLint error)
const ref = useRef(prop);
if (ref.current !== prop) { ... }

// WRONG: setState in effects
useEffect(() => {
  setDerived(compute(prop)); // Triggers extra render
}, [prop]);
```

## When You See Warnings

1. Unused imports/variables → remove them
2. Unused function params → prefix with `_`
3. Missing effect deps → add them (wrap handlers in `useCallback`)
4. Impure render → move to `useEffect`/`useMemo`/event handler
5. Never add blanket `eslint-disable` at file level. Use `eslint-disable-next-line` on specific lines only
