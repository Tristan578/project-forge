# Zustand Patterns Reference

Conventions for Zustand 5.x store slices in `web/src/stores/`.

## Store Architecture

The editor store is composed from domain slices in `web/src/stores/slices/`:

```
editorStore.ts          — composition root (create<EditorState> + all slices)
stores/slices/
  selectionSlice.ts
  transformSlice.ts
  materialSlice.ts
  ... (one file per domain — `ls` for the live list)
  index.ts              — re-exports all slice creators
```

Each file exports one `StateCreator` factory. `editorStore.ts` combines them.

## Slice Template

```ts
// web/src/stores/slices/myDomainSlice.ts
import { StateCreator } from 'zustand';

export interface MyDomainSlice {
  myDataMap: Record<string, MyData>;
  setMyData: (entityId: string, data: MyData) => void;
  clearMyData: (entityId: string) => void;
}

export const createMyDomainSlice: StateCreator<MyDomainSlice, [], [], MyDomainSlice> =
  (set) => ({
    myDataMap: {},

    setMyData: (entityId, data) =>
      set((state) => ({
        myDataMap: { ...state.myDataMap, [entityId]: data },
      })),

    clearMyData: (entityId) =>
      set((state) => {
        const { [entityId]: _removed, ...rest } = state.myDataMap;
        return { myDataMap: rest };
      }),
  });
```

Then add to `editorStore.ts`:
```ts
import { createMyDomainSlice, MyDomainSlice } from './slices/myDomainSlice';

export type EditorState = SelectionSlice & TransformSlice & ... & MyDomainSlice;

export const useEditorStore = create<EditorState>()((...args) => ({
  ...createSelectionSlice(...args),
  ...createMyDomainSlice(...args),
}));
```

And re-export from `stores/slices/index.ts`.

## Testing Slices

Use `createSliceStore` from `sliceTestTemplate.ts`:

```ts
import { createSliceStore, createMockDispatch } from '@/stores/slices/__tests__/sliceTestTemplate';

describe('myDomainSlice', () => {
  it('sets data', () => {
    const store = createSliceStore(createMyDomainSlice);
    store.getState().setMyData('e1', { value: 42 });
    expect(store.getState().myDataMap['e1']).toEqual({ value: 42 });
  });
});
```

## Selector Patterns

Prefer granular selectors to minimise re-renders:

```ts
// CORRECT — component only re-renders when myDataMap['e1'] changes
const data = useEditorStore(s => s.myDataMap[entityId]);

// WRONG — component re-renders on any store change
const store = useEditorStore();
const data = store.myDataMap[entityId];
```

For multiple fields from the same entity, use `useShallow`:

```ts
import { useShallow } from 'zustand/react/shallow';

const { position, rotation } = useEditorStore(
  useShallow(s => ({
    position: s.transformMap[entityId]?.position,
    rotation: s.transformMap[entityId]?.rotation,
  }))
);
```

## Immer for Nested Updates

For deeply nested mutations, use immer via the `immer` middleware or `produce`:

```ts
import { produce } from 'immer';

set((state) =>
  produce(state, (draft) => {
    draft.myDataMap[entityId].nested.value = newValue;
  })
);
```

## Dispatching Engine Commands from Slices

Slice actions may forward to the engine through an injected dispatcher (a module-level
`dispatchCommand` set via the slice's `set*Dispatcher()` — see `materialSlice.ts`).
Components that dispatch directly get the dispatcher with `getCommandDispatcher()`:

```ts
import { getCommandDispatcher } from '@/stores/editorStore';

const handleChange = useCallback((value: number) => {
  setMyData(entityId, { value });                                    // optimistic UI update
  getCommandDispatcher()?.('set_my_data', { entityId, value });      // engine sync
}, [entityId, setMyData]);
```

## File Naming Convention

- Slice file: `myDomainSlice.ts`
- Interface: `MyDomainSlice`
- Factory: `createMyDomainSlice`
- Data type: `MyData` (defined in the same file or imported from `types.ts`)
