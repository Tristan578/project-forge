# Component & Store Patterns

## Data Flow
```
User Action → Zustand action → dispatchCommand() → WASM handle_command()
Engine Event → JS callback → useEngineEvents → domain handler → set() → React re-render
```

## Inspector Panel Pattern
```tsx
export function MyInspector({ entityId }: { entityId: string }) {
  const data = useEditorStore(s => s.myDataMap[entityId]);
  const dispatch = useEditorStore(s => s.dispatchCommand);

  if (!data) return null;

  return (
    <div className="space-y-3 p-3">
      <h3 className="text-xs font-semibold uppercase text-zinc-400">My Component</h3>
      {/* Fields with labels and inputs */}
    </div>
  );
}
```

## Store Slice Pattern
```tsx
// Follow @web/src/stores/slices/__tests__/sliceTestTemplate.ts
export interface MySlice {
  myDataMap: Record<string, MyData>;
  setMyData: (entityId: string, data: MyData) => void;
}

export const createMySlice: StateCreator<EditorStore, [], [], MySlice> = (set) => ({
  myDataMap: {},
  setMyData: (entityId, data) => set(state => ({
    myDataMap: { ...state.myDataMap, [entityId]: data },
  })),
});
```

## Zustand Selector Rules
- Select **primitive values**, not functions: `useStore(s => s.level)` not `useStore(s => s.getLevel)`
- Granular selectors prevent full-editor re-renders
- Test with `createSliceStore()` + `createMockDispatch()` from the slice test template

## Event Handler Pattern
```tsx
// In hooks/events/<domain>Events.ts
export function handleMyEvent(event: EngineEvent, store: EditorStore) {
  const { entityId, data } = event.payload;
  store.setMyData(entityId, data);
}
```

## Next.js Constraints
- **Import boundary**: Cannot import outside `web/`. Shared data goes in `web/src/data/`.
- **MCP manifest**: Source at @mcp-server/manifest/commands.json, copy at @web/src/data/commands.json — ALWAYS keep in sync.
- **Turbopack**: Default for builds. Dev uses `--webpack` for compatibility.
- **Proxy file**: Next.js 16 renames `middleware.ts` → `proxy.ts`. Export `proxy` function, not `middleware`.
- **Root layout**: Has `export const dynamic = "force-dynamic"` for CI without Clerk keys.
