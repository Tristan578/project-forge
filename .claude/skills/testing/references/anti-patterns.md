# Test Anti-Patterns

## Never Do These

| Anti-Pattern | Why | Do This Instead |
|-------------|-----|-----------------|
| `expect(result).toBeTruthy()` | Doesn't test actual value | `expect(result).toEqual(expected)` |
| Testing implementation details | Breaks on refactor | Test behavior and outputs |
| `any` in test types | Hides type mismatches | Use proper types, mock return types |
| Giant test files (500+ lines) | Hard to find/maintain | Split by behavior group |
| `it.skip` without ticket | Technical debt | Fix or delete, or add `// PF-XXX` |
| Snapshot tests for logic | Opaque, auto-updated | Explicit assertions |
| Testing third-party libs | Not our code | Test our integration points |
| `mockReturnValue` for stateful | Returns same value every call | `mockImplementation(() => ...)` |
| Missing `await` on async | Test passes but doesn't run assertion | Always await promises |
| Mocking too shallow | Missing `.returning()` chain | Read full production call chain |

## Lessons Learned (from 22 agent PR mistakes)

These are real bugs caught in production PRs:

1. **`vi.mock()` paths**: Always use `@/lib/...` alias, never `../../relative`
2. **Dynamic imports**: Use `vi.resetModules()` before `await import()`
3. **Streaming responses**: Always `await res.text()` to drain — undrained streams cause hangs
4. **After `vi.clearAllMocks()`**: Re-mock functions that callers chain `.then()/.catch()` on
5. **Type-only imports**: Only import types you USE in annotations — ESLint catches unused
6. **`Number(undefined) ?? 60`**: Yields `NaN`, not 60. Use `Number.isFinite()` guard
7. **`Math.max(...array)`**: Throws RangeError on 100k+ elements. Use `reduce()`
8. **Config maps**: Read from source-of-truth file, don't infer from context
