# Zustand Patterns Reference

Conventions for Zustand 5.x store slices in `web/src/stores/`.

## Store Architecture

The editor store is composed from domain slices in `web/src/stores/slices/`:

```
editorStore.ts          — composition root (createSliceStore + all slices)
stores/slices/
  selectionSlice.ts
  transformSlice.ts
  materialSlice.ts
  ... (16 domain files)
  index.ts              — re-exports all slice creators
```

Each file exports one `StateCreator` factory. `editorStore.ts` combines them.

## Slice Template

```ts
// web/src/stores/slices/myDomainSlice.ts
import { StateCreator } from 'zustand';
import { EditorStore } from '../editorStore';

export interface MyDomainSlice {
  myDataMap: Record<string, MyData>;
  setMyData: (entityId: string, data: MyData) => void;
  clearMyData: (entityId: string) => void;
}

export const createMyDomainSlice: StateCreator<EditorStore, [], [], MyDomainSlice> =
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

type EditorStore = SelectionSlice & TransformSlice & ... & MyDomainSlice;

export const useEditorStore = create<EditorStore>()((...args) => ({
  ...createSelectionSlice(...args),
  ...createMyDomainSlice(...args),
}));
```

And re-export from `stores/slices/index.ts`.

## Testing Slices

Use `createSliceStore` from `sliceTestTemplate.ts`:

```ts
import { createSliceStore, createMockDispatch } from '@/stores/slices/sliceTestTemplate';

describe('myDomainSlice', () => {
  it('sets data', () => {
    const store = createSliceStore();
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

Slices do NOT call `dispatchCommand` directly. Actions update local state optimistically
and separately trigger engine commands from React event handlers:

```ts
// In the component's event handler (not the slice action)
const handleChange = useCallback((value: number) => {
  setMyData(entityId, { value });          // optimistic UI update
  dispatchCommand('set_my_data', {         // engine sync
    entityId,
    value,
  });
}, [entityId, setMyData, dispatchCommand]);
```

## File Naming Convention

- Slice file: `myDomainSlice.ts`
- Interface: `MyDomainSlice`
- Factory: `createMyDomainSlice`
- Data type: `MyData` (defined in the same file or imported from `types.ts`)
