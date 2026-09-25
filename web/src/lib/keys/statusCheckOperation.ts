/**
 * The `operation` a STATUS POLL passes to `resolveApiKey`, always with
 * `tokenCost` 0. The callers are every `/api/generate/<type>/status` route
 * that resolves a key (all of them except `music/status`, which never calls
 * the resolver: it returns a static terminal `failed` response) and the
 * durable QStash `webhooks/generation-complete` callback. Only that
 * pair (zero cost AND this operation) makes the resolver skip its tier and
 * balance checks, because the polled job was paid for when it was created
 * (#7715).
 *
 * Every caller and the resolver import it from here, never as a literal, so
 * the two sides cannot drift apart. It sits in a module of its own, with no
 * imports, so a test that replaces `@/lib/keys/resolver` with a factory mock
 * still gets the real value without loading the resolver's dependencies.
 */
export const STATUS_CHECK_OPERATION = 'status_check';
