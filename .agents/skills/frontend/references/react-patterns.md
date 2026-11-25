# React Patterns Reference

Enforced conventions for all React code in `web/src/`. These patterns prevent the most
common ESLint errors and runtime bugs.

## 1. useState Prev-Value Pattern (no useRef during render)

Use this when derived state depends on a prop:

```tsx
// CORRECT — pure render, no ref mutations
const [prev, setPrev] = useState(prop);
if (prev !== prop) {
  setPrev(prop);
  setDerived(compute(prop));
}
```

Never use `useRef.current` to track previous values during render — the `react-hooks/refs`
rule blocks this and it causes subtle bugs with Concurrent Mode.

## 2. useCallback for Stable Handlers

Handlers passed to child components or listed in effect deps MUST be stable:

```tsx
// CORRECT
const handleChange = useCallback((value: string) => {
  store.setMyData(entityId, { value });
}, [entityId, store]);

// WRONG — new function every render breaks exhaustive-deps
const handleChange = (value: string) => { ... };
```

## 3. No setState in Effect Bodies

Synchronous setState inside useEffect creates flash renders:

```tsx
// WRONG — causes extra render flash
useEffect(() => {
  setDerived(compute(prop)); // ESLint: react-hooks/set-state-in-effect
}, [prop]);

// CORRECT — use useMemo for derived state
const derived = useMemo(() => compute(prop), [prop]);
```

## 4. No Impure Render (Date.now / Math.random)

These calls produce different values on every render and break React's reconciliation:

```tsx
// WRONG
const id = `item-${Math.random()}`;        // different every render
const now = Date.now();                     // breaks SSR hydration

// CORRECT — generate once in state or useId
const id = useId();
const [now] = useState(() => Date.now());   // stable after mount
```

## 5. Effect Cleanup

Always return a cleanup function from useEffect when subscribing:

```tsx
useEffect(() => {
  const sub = store.subscribe(handler);
  return () => sub.unsubscribe(); // prevents memory leaks
}, [store, handler]);
```

## 6. Exhaustive Dependencies

List ALL values from the outer scope used inside an effect or callback:

```tsx
// CORRECT — all deps listed
useEffect(() => {
  fetchData(entityId, filter);
}, [entityId, filter]);

// WRONG — missing filter; stale closure bug
useEffect(() => {
  fetchData(entityId, filter);
}, [entityId]);
```

If a dep is a function, wrap it in `useCallback`. If it is an object, stabilise it with
`useMemo` or pass individual primitive fields.

## 7. Unused Variables

Prefix unused function params with `_` to satisfy the `no-unused-vars` rule:

```ts
// CORRECT
function handler(_event: MouseEvent, value: string) { ... }

// WRONG — lint error
function handler(event: MouseEvent, value: string) { ... }
```

## 8. Component File Naming

- PascalCase file names: `MyPanel.tsx`
- Co-located tests: `__tests__/MyPanel.test.tsx`
- Export as named export (not default) — aids tree-shaking and refactoring

## 9. Conditional Rendering

Return `null` rather than rendering empty containers for missing data:

```tsx
const data = useEditorStore(s => s.myDataMap[entityId]);
if (!data) return null; // clean, no DOM waste
```

## 10. Key Rules for Lists

Use stable, unique IDs from data — never array indices for lists that can reorder:

```tsx
// CORRECT
{items.map(item => <Row key={item.id} item={item} />)}

// WRONG — breaks reconciliation when list reorders
{items.map((item, i) => <Row key={i} item={item} />)}
```
