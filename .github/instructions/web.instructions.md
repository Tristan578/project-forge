---
applyTo: "web/**"
---

# Web Editor Instructions

This is the Next.js 16 (React) editor frontend. TypeScript strict mode is enforced with zero ESLint warnings.

## Hard Rules

- Never use `any` type. If you need a type assertion, use Zod validation instead of `as` casts.
- All chat handler arguments MUST be validated with Zod schemas. Never trust `args` directly:
  ```typescript
  // BAD
  store.updateTransform(entityId, args.position as [number, number, number]);

  // GOOD
  const schema = z.object({
    entityId: z.string().uuid(),
    position: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])
  });
  const validated = schema.parse(args);
  store.updateTransform(validated.entityId, validated.position);
  ```
- All user-facing text input must pass through `sanitizeChatInput()` before reaching the AI API. Never bypass the sanitizer.
- Never expose API keys, tokens, or secrets in client-side code. Check that `process.env` variables used in components are prefixed with `NEXT_PUBLIC_` only when intentionally client-exposed.
- ESLint must pass with `--max-warnings 0`. Do not add eslint-disable comments without a documented reason.

## State Management (Zustand)

- Each domain has its own store slice: editor, chat, user, collaboration, publish, generation, etc.
- Use selectors to subscribe to specific fields. Never subscribe to an entire store:
  ```typescript
  // BAD
  const store = useEditorStore();

  // GOOD
  const selectedEntity = useEditorStore(s => s.selectedEntity);
  ```
- Mutations go through store actions, never direct state assignment.
- Test stores independently with `vitest`. Mock WASM bridge interactions.

## WASM Integration

- The `useEngine` hook in `src/hooks/useEngine.ts` manages the WASM lifecycle. All WASM calls go through this hook.
- Never import WASM modules directly in components. Use the hook's command interface.
- Handle WASM loading states (loading, ready, error) gracefully in the UI.

## Chat System

- Handlers live in `src/lib/chat/handlers/` organized by domain (transform, shader, material, animation, etc.).
- Each handler file exports functions that map AI tool calls to engine commands.
- The sanitizer in `src/lib/chat/sanitizer.ts` detects prompt injection and throws on detection. Callers must handle the error.
- When adding new handlers, follow the existing pattern: Zod schema → validate → execute → return result.

## API Routes

- All API routes must enforce auth via `requireAuth()` from `src/lib/api-auth.ts`.
- Use Clerk for session management. Never roll custom auth.
- Return proper HTTP status codes: 400 for validation errors, 401 for unauthed, 403 for forbidden, 500 for server errors.

## Testing

- Test files live alongside source: `foo.ts` → `foo.test.ts`
- Framework: vitest with React Testing Library for component tests.
- Mock the WASM bridge — do not load real engine in web tests.
- Run: `npx vitest run` from the `web/` directory.
