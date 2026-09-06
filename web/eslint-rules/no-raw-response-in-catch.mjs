/**
 * spawnforge/no-raw-response-in-catch — EARLY FEEDBACK, at author time, that a
 * caught error is heading for a client response (#9736).
 *
 * THIS RULE IS NOT THE GUARANTEE. Read that sentence before trusting anything
 * below it.
 *
 * The guarantee is `withEgressGuard` in `src/lib/security/egressGuard.ts`: a
 * runtime wrapper on every App Router handler that redacts the body, every
 * header value, every `Set-Cookie` and the `Location` of every response before
 * it is returned. However the body was assembled — helper, alias, hoisted
 * function, tagged template, stream, a shape nobody has thought of — it passes
 * through one function. `src/app/api/__tests__/egressGuardCoverage.test.ts`
 * names any route that is not wrapped.
 *
 * WHY THE GUARANTEE MOVED. Three adversarial review passes were run against
 * successive versions of this rule. Each pass closed the shapes the previous
 * one found, and each next pass found more. By the third they were one-liners:
 *
 *     const sink = cache; sink.set('last', err.message);   // alias an outer Map
 *     const R = NextResponse; return R.json({ detail });    // alias the ctor
 *     function detail() { return String(err); }             // hoisted decl
 *     sql`UPDATE jobs SET error = ${err.message}`           // tagged template
 *     import * as srv from 'next/server';                   // namespace import
 *
 * The escape check compared NAME scope against reachability, so one `const`
 * defeated it — and the rule's own message ("keep the error inside the catch")
 * is what pushes an author toward writing exactly that line. Every shape listed
 * above is now closed and pinned by a named RuleTester case, and that is
 * precisely the point: three rounds of closing enumerated shapes produced three
 * rounds of new ones. A static analysis over an open-ended language is the
 * wrong primitive for a property that has to hold. It is a very good primitive
 * for telling an author, in their editor, that they are writing the defect.
 *
 * DO NOT restate the earlier claim that "crossing out is a closed set". Pass 3
 * disproved it: `yield`, a tagged template and a hoisted declaration were all
 * outside the enumeration, and the enumeration is what the claim rested on.
 *
 * HOW IT WORKS, so a report is readable. Inside a catch scope the caught
 * binding and every value DERIVED from it are tracked, and the rule reports
 * where that value crosses out of the scope:
 *
 *   - it is RETURNED (a `return`, a `yield`, or a callback's expression body);
 *   - it is WRITTEN into something not declared inside the catch — an
 *     assignment, a destructuring assignment, or a mutating call (including a
 *     tagged template) on a receiver that RESOLVES to an outer binding.
 *     Resolution, not naming: `const h = res.headers` resolves to `res`, so a
 *     write to `h` taints `res`; `const s = cache` resolves to a module
 *     binding, so the write is an escape naming `cache`;
 *   - it is passed to a SANCTIONED response constructor (redaction is a net,
 *     not a licence: upstream text carries internal hostnames, SQL and other
 *     tenants' identifiers that no shape list will match);
 *   - it is passed to any call that is not on the sink allowlist below.
 *
 * Derivations themselves — a member read, a template literal, an object or
 * array, `await`, a string method, a local accumulator — are inert, so they are
 * tracked but never reported. That is what keeps the rule quiet enough to leave
 * enabled.
 *
 * The allowlist of terminal sinks is an OPTION (`errorSinks`, `loggerObjects`,
 * `pureDerivations`), set explicitly in `web/eslint.config.mjs` so a reviewer
 * can audit what is permitted without reading this file.
 *
 * Rule 1 (the site ban) sits alongside the taint model and earns its place: it
 * catches a response built inside a catch whose body carries upstream text the
 * tracker cannot see — `NextResponse.json(await upstream.text())`, where
 * nothing references the caught binding at all. It bans every member of
 * NextResponse/Response, computed or not, through an import rename, a namespace
 * import or a local alias, and it is UNCONDITIONAL: the narrowing exemption
 * cannot suppress it, because a single `typeof err` inside the arguments used
 * to be enough to turn it off.
 *
 * ESCAPE HATCH. An ordinary `// eslint-disable-next-line` with a stated reason.
 * The repo bans blanket disables, so a reviewer sees every one of them.
 *
 * KNOWN LIMITS. Each was reproduced against this rule. None is a claim that the
 * shape is safe — `withEgressGuard` is what covers them at runtime, and that is
 * the whole reason this list is allowed to be non-empty.
 *  - `Promise.allSettled` hands a rejection reason back with no catch clause
 *    anywhere: `rs.filter((r) => r.status === 'rejected').map((r) => r.reason.message)`
 *    has no caught binding to track and is NOT analysed.
 *  - Taint is not propagated into CALLBACK PARAMETERS, so higher-order
 *    iteration launders it: `String(err).split('\n').forEach((line) => outer.push(line))`
 *    reports nothing, while the `for...of` spelling of the same code does.
 *  - A call whose RECEIVER carries the taint but whose arguments do not is not
 *    classified: `err.response.body.pipeTo(writable)`.
 *  - The NON-THROWING path is out of scope by construction. `const r = await
 *    fetch(u); if (!r.ok) return apiError(502, await r.text());` puts the
 *    upstream body in a client response with no catch clause.
 *  - A response constructed inside a helper function that the catch merely
 *    calls is not seen as a construction. It is an unknown-sink call if the
 *    caught value reaches it, and a `catchValueReturned` if its result is
 *    returned.
 *  - Scope tracking is lexical NAME tracking, not scope resolution.
 *    `declaredWithin` walks the whole catch subtree including nested function
 *    bodies, so a local declared in a nested arrow puts its name in the
 *    declared set and disarms the outer-write check for an unrelated outer
 *    binding of the same name.
 *  - The taint fixpoint is capped at 12 passes rather than iterated to
 *    stability, so a reverse-ordered derivation chain longer than that loses
 *    the taint.
 */

/**
 * Response constructors that perform no redaction. Every member call on these,
 * and every `new` of them, is banned inside a catch scope.
 */
const RAW_RESPONSE_OBJECTS = new Set(['NextResponse', 'Response']);

/** Modules whose imports may alias a raw response constructor. */
const RESPONSE_MODULES = new Set(['next/server', 'next/dist/server/web/spec-extension/response']);

const DEFAULT_RESPONSE_HELPERS = [
  'apiError',
  'createErrorResponse',
  'redactedJson',
  'apiErrorResponse',
  'badRequest',
  'unauthorized',
  'paymentRequired',
  'forbidden',
  'notFound',
  'conflict',
  'validationError',
  'internalError',
  'serviceUnavailable',
];

/**
 * Terminal sinks the caught error MAY reach. A call to one of these consumes
 * the value: nothing downstream is tainted, and nothing is reported.
 *
 * This is the whole allowlist. It is short on purpose — every entry is a place
 * the error is meant to go (our telemetry, our logs, or back up the stack).
 * Bare names match an identifier callee; dotted names match a member path.
 */
const DEFAULT_ERROR_SINKS = [
  'captureException',
  'captureMessage',
  'sampledCaptureException',
  'captureGenerationError',
  'reportError',
  'Promise.reject',
];

/**
 * Receivers whose every method is a log sink. `logger.error({ err }, 'failed')`
 * and `console.warn(err)` are the two shapes this codebase actually uses, and
 * enumerating their method names would be another open-ended list.
 */
const DEFAULT_LOGGER_OBJECTS = ['console', 'logger', 'log', 'Sentry', 'sentry', 'sentryLogger'];

/**
 * Calls that merely RESHAPE a value. Their result stays tainted and must still
 * cross out somewhere to be reported; listing them only avoids reporting the
 * reshaping itself as an unknown sink. `Error` and friends are here so
 * `throw new Error(String(err))` — a rethrow, not an egress — stays quiet.
 */
const DEFAULT_PURE_DERIVATIONS = [
  'String', 'Number', 'Boolean', 'Symbol',
  'Error', 'TypeError', 'RangeError', 'AggregateError', 'URL', 'URLSearchParams',
  'encodeURIComponent', 'encodeURI', 'decodeURIComponent', 'decodeURI',
  'JSON.stringify', 'JSON.parse',
  'Object.keys', 'Object.values', 'Object.entries',
  'Array.from', 'Array.isArray',
  'Promise.resolve',
];

/**
 * Properties an `instanceof`-narrowed client-safe error may expose. The
 * exemption used to cover the whole narrowed branch, so `err.cause.body` —
 * raw upstream text reached THROUGH a client-safe error — inherited it. The
 * justification for the exemption is that the error's MESSAGE is ours; these
 * are the fields that claim covers.
 */
const DEFAULT_CLIENT_SAFE_PROPERTIES = ['message', 'code', 'status', 'statusCode', 'reason', 'name'];

/** Wrappers that keep an expression in the same boolean-test position. */
const TEST_TRANSPARENT = new Set([
  'UnaryExpression', 'LogicalExpression', 'ChainExpression', 'AwaitExpression', 'TSNonNullExpression',
]);

/**
 * True when `node` is evaluated purely to decide a branch. A predicate such as
 * `if (isClerk404(err))` hands the caught value to a helper, but its RESULT is
 * one bit consumed by control flow — it is not a channel a response body,
 * header or redirect URL can travel down, which is the egress this rule is
 * about. Without this, every type-guard in the linted files reports.
 */
function isTestPosition(node, ancestors) {
  let child = node;
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    const parent = ancestors[i];
    if (
      parent.type === 'IfStatement'
      || parent.type === 'ConditionalExpression'
      || parent.type === 'WhileStatement'
      || parent.type === 'DoWhileStatement'
      || parent.type === 'ForStatement'
    ) {
      return parent.test === child;
    }
    if (parent.type === 'SwitchStatement') return parent.discriminant === child;
    if (!TEST_TRANSPARENT.has(parent.type)) return false;
    child = parent;
  }
  return false;
}

/** Calls whose FIRST argument is the mutated target rather than the receiver. */
const TARGET_IS_FIRST_ARG = new Set([
  'Object.assign', 'Object.defineProperty', 'Object.defineProperties',
  'Reflect.set', 'Reflect.defineProperty',
]);

const NON_AST_KEYS = new Set(['parent', 'loc', 'range', 'start', 'end', 'tokens', 'comments']);

/** AST positions that hold a NAME rather than a value reference. */
const REF_SKIP_KEYS = new Set([
  'typeAnnotation', 'returnType', 'typeParameters', 'typeArguments', 'superTypeArguments',
]);

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression',
]);

/** Depth-first walk that yields each node together with its ancestor stack. */
function walk(node, visit, ancestors = []) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, ancestors);
  ancestors.push(node);
  for (const key of Object.keys(node)) {
    if (NON_AST_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object' && typeof item.type === 'string') {
          walk(item, visit, ancestors);
        }
      }
    } else if (value && typeof value === 'object' && typeof value.type === 'string') {
      walk(value, visit, ancestors);
    }
  }
  ancestors.pop();
}

/**
 * Every identifier in the subtree that READS one of `names`, paired with its
 * parent node.
 *
 * Deliberately "reads", not "mentions": an identifier sitting in a non-computed
 * property key (`{ error: 'Failed' }`), a non-computed member (`res.error`) or
 * a type annotation is a NAME, not a reference to the binding. Counting those
 * made every `catch (error) { ... { error: 'Failed' } ... }` report — the
 * single most common shape in this codebase — which would have taught everyone
 * to disable the rule rather than to fix anything.
 */
function taintedReads(node, names, out = [], stack = []) {
  if (!node || names.size === 0) return out;
  if (node.type === 'Identifier') {
    if (names.has(node.name)) out.push({ id: node, parent: stack[stack.length - 1] ?? null, stack: [...stack] });
    return out;
  }
  const descend = (child) => taintedReads(child, names, out, [...stack, node]);
  if (node.type === 'MemberExpression') {
    descend(node.object);
    if (node.computed) descend(node.property);
    return out;
  }
  if (node.type === 'Property' || node.type === 'PropertyDefinition' || node.type === 'MethodDefinition') {
    if (node.computed) descend(node.key);
    descend(node.value);
    return out;
  }
  for (const key of Object.keys(node)) {
    if (NON_AST_KEYS.has(key) || REF_SKIP_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object' && typeof item.type === 'string') descend(item);
      }
    } else if (value && typeof value === 'object' && typeof value.type === 'string') {
      descend(value);
    }
  }
  return out;
}

function referencesAny(node, names) {
  return taintedReads(node, names).length > 0;
}

/** The identifier names a binding pattern introduces. */
function patternNames(node, into = new Set()) {
  if (!node) return into;
  switch (node.type) {
    case 'Identifier':
      into.add(node.name);
      break;
    case 'ObjectPattern':
      for (const prop of node.properties) {
        patternNames(prop.type === 'RestElement' ? prop.argument : prop.value, into);
      }
      break;
    case 'ArrayPattern':
      for (const el of node.elements) patternNames(el, into);
      break;
    case 'AssignmentPattern':
      patternNames(node.left, into);
      break;
    case 'RestElement':
      patternNames(node.argument, into);
      break;
    case 'MemberExpression': {
      const root = rootIdentifier(node);
      if (root) into.add(root.name);
      break;
    }
    default:
      break;
  }
  return into;
}

/**
 * The root identifier of a member chain: `a.b.c[d]` -> `a`. Returns null the
 * moment the chain passes through anything that is not a member read, which is
 * how `db.update(x).set(...)` is distinguished from `res.headers.set(...)`.
 */
function rootIdentifier(node) {
  let current = node;
  while (current && current.type === 'MemberExpression') current = current.object;
  return current && current.type === 'Identifier' ? current : null;
}

/** The dotted path of a callee when it is a plain chain of names, else null. */
function calleePath(callee) {
  if (!callee) return null;
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') {
    const objectPath = calleePath(callee.object);
    return objectPath ? `${objectPath}.${callee.property.name}` : null;
  }
  return null;
}

/** The name a call expression's callee resolves to, for helper matching. */
function calleeName(callee) {
  if (!callee) return null;
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') {
    return callee.property.name;
  }
  return null;
}

/**
 * Collect the names `test` narrows to a client-safe error class. `negated`
 * flips the sense, so the `else` of `if (!(e instanceof X))` counts.
 */
function collectNarrowed(test, tainted, clientSafe, negated, into) {
  if (!test) return into;
  if (test.type === 'UnaryExpression' && test.operator === '!') {
    return collectNarrowed(test.argument, tainted, clientSafe, !negated, into);
  }
  if (test.type === 'LogicalExpression') {
    // `a && b` narrows in the consequent; `!(a || b)` narrows in the alternate.
    const positive = test.operator === '&&' && !negated;
    const negative = test.operator === '||' && negated;
    if (positive || negative) {
      collectNarrowed(test.left, tainted, clientSafe, negated, into);
      collectNarrowed(test.right, tainted, clientSafe, negated, into);
    }
    return into;
  }
  if (negated) return into;
  if (test.type !== 'BinaryExpression' || test.operator !== 'instanceof') return into;
  const { left, right } = test;
  if (
    left.type === 'Identifier'
    && tainted.has(left.name)
    && right.type === 'Identifier'
    && clientSafe.has(right.name)
  ) {
    into.add(left.name);
  }
  return into;
}

/** True when `stmt` cannot fall through (an early-return narrowing guard). */
function alwaysExits(stmt) {
  if (!stmt) return false;
  if (stmt.type === 'ThrowStatement' || stmt.type === 'ReturnStatement') return true;
  if (stmt.type === 'BlockStatement') {
    return stmt.body.length > 0 && alwaysExits(stmt.body[stmt.body.length - 1]);
  }
  return false;
}

/**
 * The names narrowed to a client-safe error at this position. Two forms are
 * recognised, and the exemption is scoped to the narrowed BRANCH rather than to
 * a window of nearby characters, which is how the original text detector
 * silently exempted the fall-through after a narrowing `if`:
 *
 *   if (e instanceof Safe) { ...here... }
 *   if (!(e instanceof Safe)) throw e;  ...here...
 */
function clientSafeNarrowings(ancestors, tainted, clientSafe) {
  const narrowed = new Set();
  for (let i = 0; i < ancestors.length - 1; i += 1) {
    const parent = ancestors[i];
    const child = ancestors[i + 1];
    if (parent.type === 'IfStatement' || parent.type === 'ConditionalExpression') {
      if (child === parent.consequent) {
        collectNarrowed(parent.test, tainted, clientSafe, false, narrowed);
      } else if (child === parent.alternate) {
        collectNarrowed(parent.test, tainted, clientSafe, true, narrowed);
      }
    }
    if (parent.type === 'BlockStatement' || parent.type === 'Program') {
      const index = parent.body.indexOf(child);
      if (index > 0) {
        for (let j = 0; j < index; j += 1) {
          const prior = parent.body[j];
          if (prior.type === 'IfStatement' && !prior.alternate && alwaysExits(prior.consequent)) {
            collectNarrowed(prior.test, tainted, clientSafe, true, narrowed);
          }
        }
      }
    }
  }
  return narrowed;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Keep the caught error inside the catch scope, and require catch-path API responses to be built by a redacting constructor (#9736)',
    },
    schema: [
      {
        type: 'object',
        properties: {
          /** Error classes whose `message` is authored here for the user. */
          clientSafeErrors: { type: 'array', items: { type: 'string' } },
          /** Properties of a narrowed client-safe error that may be sent. */
          clientSafeProperties: { type: 'array', items: { type: 'string' } },
          /** Sanctioned redacting constructors. */
          responseHelpers: { type: 'array', items: { type: 'string' } },
          /** Terminal sinks the caught error may reach (bare or dotted names). */
          errorSinks: { type: 'array', items: { type: 'string' } },
          /** Receivers whose every method is a log sink. */
          loggerObjects: { type: 'array', items: { type: 'string' } },
          /** Calls that reshape rather than consume; their result stays tainted. */
          pureDerivations: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      rawResponseInCatch:
        'Do not construct a response inside a catch. `{{name}}` performs no redaction, and a body — or a redirect URL — assembled here can carry upstream provider text (#9736). Use a redacting constructor from @/lib/api/errors ({{helpers}}), or move the construction out of the catch.',
      catchValueEscapes:
        'The caught error escapes this catch into `{{name}}`, which is not declared inside it — anything built later from `{{name}}` is beyond the reach of this rule (#9736). Keep the error inside the catch: send it to a log or telemetry sink, then respond with a fixed message.',
      catchValueInResponseHelper:
        'A value derived from the caught error is passed to `{{helper}}`. Redaction is a net, not a licence: upstream text carries internal hostnames, SQL and other tenants\' identifiers that no shape list will match (#9736). Send a fixed message, or narrow with `instanceof` to an error class whose message is ours.',
      catchValueReturned:
        'A value derived from the caught error is returned from this catch. Whatever the caller does with it — a response body, a header, a redirect URL — is outside this rule\'s reach (#9736). Return a fixed message and send the error to a log or telemetry sink instead.',
      catchValueToUnknownSink:
        'A value derived from the caught error is passed to `{{name}}`, which is not an allowlisted sink (#9736). Only the telemetry and logging sinks in this rule\'s `errorSinks`/`loggerObjects` options may consume the caught error; anything else is an egress channel this rule cannot follow.',
    },
  },

  create(context) {
    const options = context.options[0] ?? {};
    const clientSafe = new Set(options.clientSafeErrors ?? []);
    const clientSafeProperties = new Set(options.clientSafeProperties ?? DEFAULT_CLIENT_SAFE_PROPERTIES);
    const responseHelpers = new Set(options.responseHelpers ?? DEFAULT_RESPONSE_HELPERS);
    const errorSinks = new Set(options.errorSinks ?? DEFAULT_ERROR_SINKS);
    const loggerObjects = new Set(options.loggerObjects ?? DEFAULT_LOGGER_OBJECTS);
    const pureDerivations = new Set(options.pureDerivations ?? DEFAULT_PURE_DERIVATIONS);
    const helperList = [...responseHelpers].slice(0, 3).join(', ');

    /**
     * Local names that alias a raw response constructor or a sanctioned helper.
     * Matching the bare identifier disabled the rule for a whole file behind a
     * single `import { NextResponse as NR }`.
     */
    const rawResponseNames = new Set(RAW_RESPONSE_OBJECTS);
    const helperNames = new Set(responseHelpers);
    /** `import * as srv from 'next/server'` — `srv.NextResponse.json` is a site. */
    const responseNamespaces = new Set();
    for (const statement of context.sourceCode.ast.body) {
      if (statement.type !== 'ImportDeclaration') continue;
      const source = typeof statement.source.value === 'string' ? statement.source.value : '';
      for (const specifier of statement.specifiers) {
        if (specifier.type === 'ImportNamespaceSpecifier' && RESPONSE_MODULES.has(source)) {
          responseNamespaces.add(specifier.local.name);
          continue;
        }
        if (specifier.type !== 'ImportSpecifier' || specifier.imported.type !== 'Identifier') continue;
        const imported = specifier.imported.name;
        if (RAW_RESPONSE_OBJECTS.has(imported) && RESPONSE_MODULES.has(source)) {
          rawResponseNames.add(specifier.local.name);
        }
        if (responseHelpers.has(imported)) helperNames.add(specifier.local.name);
      }
    }

    // A LOCAL alias of a constructor is neither an import rename nor a
    // cross-file call, so it was the cheapest evasion of the one rule meant to
    // be independent of taint tracking: `const R = NextResponse;` then
    // `R.json({ detail })`. Resolved to a fixpoint so a chain of aliases does
    // not reopen it.
    for (let pass = 0; pass < 4; pass += 1) {
      const before = rawResponseNames.size + helperNames.size;
      walk(context.sourceCode.ast, (n) => {
        if (n.type !== 'VariableDeclarator' || n.id.type !== 'Identifier') return;
        if (!n.init || n.init.type !== 'Identifier') return;
        if (rawResponseNames.has(n.init.name)) rawResponseNames.add(n.id.name);
        if (helperNames.has(n.init.name)) helperNames.add(n.id.name);
      });
      if (rawResponseNames.size + helperNames.size === before) break;
    }

    // A catch nested inside a catch is analysed by both, so dedupe reports; and
    // suppress an inner report already covered by an enclosing one, so a single
    // egress site produces a single, most-specific message.
    const reported = new Set();
    const reportedRanges = [];

    function alreadyCovered(node) {
      const range = node.range ?? [0, 0];
      return reportedRanges.some(([start, end]) => start <= range[0] && range[1] <= end);
    }

    function report(node, messageId, data) {
      const range = node.range ?? [0, 0];
      const key = `${range[0]}:${range[1]}:${messageId}`;
      if (reported.has(key)) return;
      if (alreadyCovered(node)) return;
      reported.add(key);
      reportedRanges.push(range);
      context.report({ node, messageId, data });
    }

    /**
     * Names declared lexically within the catch scope. Anything else an
     * assignment targets is, by definition, outer.
     */
    function declaredWithin(root) {
      const declared = new Set();
      walk(root, (n) => {
        if (n.type === 'VariableDeclarator') patternNames(n.id, declared);
        else if (n.type === 'FunctionDeclaration' && n.id) declared.add(n.id.name);
        else if (n.type === 'ClassDeclaration' && n.id) declared.add(n.id.name);
        else if (FUNCTION_TYPES.has(n.type)) {
          for (const param of n.params) patternNames(param, declared);
        } else if (n.type === 'CatchClause' && n.param) patternNames(n.param, declared);
      });
      return declared;
    }

    /**
     * Catch-declared bindings that merely ALIAS something built outside the
     * catch, mapped to the outer root they reach.
     *
     * `declared` is a set of NAMES, and the escape check treated "named here"
     * as "cannot outlive this scope". One `const` falsifies that:
     * `const sink = cache; sink.set('last', err.message)` writes into a
     * module-scoped Map read by a later request, and every escape the board had
     * pinned went quiet the moment an alias line was added — including the
     * rule's own named test cases. Worse, the rule's message ("keep the error
     * inside the catch") is what pushes an author toward writing that line.
     *
     * So a receiver counts as local only when the binding its initializer
     * chains back to was declared here — a fresh object, `new`, or call result.
     * `const h = res.headers` resolves to `res`, which is local, so writing to
     * `h` taints `res` and the eventual `return res` reports; `const s = cache`
     * resolves to a module binding, so the write is an escape naming `cache`.
     */
    function aliasRootsWithin(root) {
      const roots = new Map();
      const chainRoot = (init) => {
        let current = init;
        while (current && (current.type === 'MemberExpression' || current.type === 'TSNonNullExpression')) {
          current = current.object ?? current.expression;
        }
        return current && current.type === 'Identifier' ? current.name : null;
      };
      walk(root, (n) => {
        if (n.type !== 'VariableDeclarator' || !n.init) return;
        const from = chainRoot(n.init);
        if (!from) return;
        for (const name of patternNames(n.id)) if (name !== from) roots.set(name, from);
      });
      return roots;
    }

    /** True when a member chain reaches a plain identifier without a call. */
    function staticReceiverRoot(node) {
      let current = node;
      while (current && current.type === 'MemberExpression') current = current.object;
      if (current && current.type === 'Identifier') return current.name;
      return null;
    }

    /**
     * Names holding something derived from the caught error, to a fixpoint.
     *
     * Every derivation is followed, which is what makes the rule indifferent to
     * how the value was built: `const { message } = err`, `const m = err.message`,
     * `let s; s = String(err)`, `({ message } = err)`, `[m] = [String(err)]`,
     * `for (const line of String(err).split('\n'))`, `const parts = [err.message]`,
     * `parts.push(err.message)` on a local array, and `res.headers.set(k, err.message)`
     * on a locally-built response all land here.
     */
    function taintedWithin(root, bindings, declared, isLocal, resolveRoot) {
      const tainted = new Set(bindings);
      if (tainted.size === 0) return tainted;
      for (let pass = 0; pass < 12; pass += 1) {
        const before = tainted.size;
        walk(root, (n) => {
          if (n.type === 'VariableDeclarator' && n.init && referencesAny(n.init, tainted)) {
            patternNames(n.id, tainted);
            return;
          }
          if (
            (n.type === 'ForOfStatement' || n.type === 'ForInStatement')
            && referencesAny(n.right, tainted)
          ) {
            // A for-of declarator has a null `init`, so the declarator branch
            // above never sees it. `for (const line of String(err).split('\n'))`
            // was a clean bypass of the whole rule for exactly this reason.
            if (n.left.type === 'VariableDeclaration') {
              for (const decl of n.left.declarations) patternNames(decl.id, tainted);
            } else {
              patternNames(n.left, tainted);
            }
            return;
          }
          if (n.type === 'AssignmentExpression' && referencesAny(n.right, tainted)) {
            patternNames(n.left, tainted);
            return;
          }
          if (
            (n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration')
            && n.id
            && referencesAny(n.body, tainted)
          ) {
            // The compensating half of "a return inside a nested function is not
            // reported" only ever worked for function EXPRESSIONS bound by a
            // declarator. A hoisted `function detail() { return String(err); }`
            // had no tainted binding at all, so `apiError(500, detail())`
            // reproduced the original defect lint-clean.
            tainted.add(n.id.name);
            return;
          }
          if (n.type !== 'CallExpression' || !n.arguments.some((a) => referencesAny(a, tainted))) return;
          // A mutating call on a LOCAL binding accumulates into it rather than
          // escaping: the binding becomes tainted and is caught when it crosses
          // out. `res.headers.set('X-Detail', err.message); return res;` is the
          // header channel, and it is closed by the `return`, not by a list of
          // mutator names.
          const path = calleePath(n.callee);
          if (path && TARGET_IS_FIRST_ARG.has(path)) {
            const target = n.arguments[0];
            const targetRoot = target ? staticReceiverRoot(target) : null;
            if (targetRoot && isLocal(targetRoot)) {
              tainted.add(targetRoot);
              tainted.add(resolveRoot(targetRoot));
            }
            return;
          }
          if (n.callee.type !== 'MemberExpression') return;
          const receiverRoot = staticReceiverRoot(n.callee.object);
          if (receiverRoot && isLocal(receiverRoot)) {
            // Taint what the receiver RESOLVES to as well: `const h = res.headers;
            // h.set('X-Detail', err.message); return res;` is the header channel,
            // and it is closed only if the write reaches `res`.
            tainted.add(receiverRoot);
            tainted.add(resolveRoot(receiverRoot));
          }
        });
        if (tainted.size === before) break;
      }
      return tainted;
    }

    function analyse(root, bindings, isExpressionBody) {
      // NOT guarded on a non-empty binding set: `catch { return NextResponse.json(...) }`
      // has nothing to track and still must not build a raw response.
      if (!root) return;
      const declared = declaredWithin(root);
      for (const name of bindings) declared.add(name);
      const aliasRoots = aliasRootsWithin(root);
      /** Follow an alias chain to the binding it actually reaches. */
      const resolveRoot = (name) => {
        let current = name;
        for (let hop = 0; hop < 8 && aliasRoots.has(current); hop += 1) {
          const next = aliasRoots.get(current);
          if (next === current) break;
          current = next;
        }
        return current;
      };
      /** A receiver is local only when what it RESOLVES to was declared here. */
      const isLocal = (name) => declared.has(resolveRoot(name));
      /** Report the binding an alias actually reaches, not the alias. */
      const outerNameFor = (name) => resolveRoot(name);
      const tainted = taintedWithin(root, bindings, declared, isLocal, resolveRoot);

      /**
       * `ancestors` is the chain ABOVE `node`, exclusive of it.
       *
       * True when every tainted read inside `node` is either a type test
       * (`err instanceof X`, `typeof err`) or a read of a narrowed client-safe
       * error's own message-shaped property.
       *
       * The exemption is evaluated PER READ, at that read's own position. The
       * previous version asked one question of the whole branch, so
       * `apiError(402, err.cause.body)` inside `if (err instanceof ApiKeyError)`
       * inherited it — raw upstream text reached THROUGH the client-safe error.
       * Per-read is also what lets `err instanceof X ? apiError(402, err.message)
       * : apiError(500, 'x')` stay clean while the `err.cause` form reports.
       */
      function isExempt(node, ancestors) {
        const reads = taintedReads(node, tainted);
        if (reads.length === 0) return false;
        return reads.every(({ id, parent, stack }) => {
          // A type test reads the binding but sends nothing anywhere.
          if (parent && parent.type === 'BinaryExpression' && parent.operator === 'instanceof' && parent.left === id) {
            return true;
          }
          if (parent && parent.type === 'UnaryExpression' && parent.operator === 'typeof') return true;
          if (
            !parent
            || parent.type !== 'MemberExpression'
            || parent.computed
            || parent.object !== id
            || parent.property.type !== 'Identifier'
            || !clientSafeProperties.has(parent.property.name)
          ) {
            return false;
          }
          // `stack` starts AT `node`, so `ancestors` must exclude it.
          const narrowed = clientSafeNarrowings([...ancestors, ...stack], tainted, clientSafe);
          return narrowed.has(id.name);
        });
      }

      /** A raw response construction site, whatever member is used. */
      function rawResponseSite(node) {
        // `srv.NextResponse.json(...)` after `import * as srv from 'next/server'`.
        if (
          node.type === 'CallExpression'
          && node.callee.type === 'MemberExpression'
          && node.callee.object.type === 'MemberExpression'
          && node.callee.object.object.type === 'Identifier'
          && responseNamespaces.has(node.callee.object.object.name)
          && node.callee.object.property.type === 'Identifier'
          && RAW_RESPONSE_OBJECTS.has(node.callee.object.property.name)
        ) {
          const property = node.callee.property.type === 'Identifier' ? node.callee.property.name : '…';
          return `${node.callee.object.property.name}.${property}`;
        }
        if (
          node.type === 'CallExpression'
          && node.callee.type === 'MemberExpression'
          && node.callee.object.type === 'Identifier'
          && rawResponseNames.has(node.callee.object.name)
        ) {
          const property = node.callee.computed
            ? (node.callee.property.type === 'Literal' ? String(node.callee.property.value) : '…')
            : (node.callee.property.type === 'Identifier' ? node.callee.property.name : '…');
          return `${node.callee.object.name}.${property}`;
        }
        if (
          node.type === 'NewExpression'
          && node.callee.type === 'Identifier'
          && rawResponseNames.has(node.callee.name)
        ) {
          return `new ${node.callee.name}`;
        }
        return null;
      }

      /**
       * What a call carrying the caught value does with it.
       *
       * Three outcomes, and the distinction between the last two matters:
       *  - a verdict object: report it;
       *  - `'sink'`: an allowlisted sink CONSUMES the value, so its result is
       *    not tainted and returning that result is not an egress;
       *  - `null`: a derivation — quiet here, but the result stays tainted and
       *    is still reported wherever it crosses out.
       */
      function classifyCall(node, ancestors = []) {
        const site = rawResponseSite(node);
        if (site) return { messageId: 'rawResponseInCatch', data: { name: site, helpers: helperList } };

        const carriesInArgs = node.arguments.some((a) => referencesAny(a, tainted));
        if (!carriesInArgs) return null;

        const path = calleePath(node.callee);
        const name = calleeName(node.callee);

        // Allowlisted terminal sinks: telemetry, logs, and a rethrow.
        if (path && errorSinks.has(path)) return 'sink';
        if (name && errorSinks.has(name)) return 'sink';
        if (node.callee.type === 'MemberExpression') {
          const root = staticReceiverRoot(node.callee.object);
          if (root && loggerObjects.has(root)) return 'sink';
        }

        // Sanctioned response constructors: allowed to be called, not allowed
        // to be handed the caught error.
        if (name && helperNames.has(name)) {
          return { messageId: 'catchValueInResponseHelper', data: { helper: name } };
        }

        // Reshaping calls. The result stays tainted; only the reshaping is quiet.
        if (path && pureDerivations.has(path)) return null;
        if (node.callee.type === 'MemberExpression' && referencesAny(node.callee.object, tainted)) {
          // `err.toString()`, `String(err).split('\n')`, `parts.join(' ')`.
          return null;
        }

        if (path && TARGET_IS_FIRST_ARG.has(path)) {
          const target = node.arguments[0];
          const targetRoot = target ? staticReceiverRoot(target) : null;
          if (targetRoot && isLocal(targetRoot)) return null;
          return {
            messageId: 'catchValueEscapes',
            data: { name: targetRoot ? outerNameFor(targetRoot) : context.sourceCode.getText(node.callee) },
          };
        }

        if (node.callee.type === 'MemberExpression') {
          const root = staticReceiverRoot(node.callee.object);
          if (root && isLocal(root)) return null; // local accumulation
          return {
            messageId: 'catchValueEscapes',
            // A receiver rooted in a CALL (`db.update(x).set(...)`,
            // `new TextEncoder().encode(...)`) has no root identifier at all,
            // which is why the previous rule was silently inert for the repo's
            // universal DB-write idiom.
            data: { name: root ? outerNameFor(root) : context.sourceCode.getText(node.callee).slice(0, 60) },
          };
        }

        if (isTestPosition(node, ancestors)) return null;
        return { messageId: 'catchValueToUnknownSink', data: { name: name ?? 'a call' } };
      }

      function reportReturnLike(node, argument, ancestors) {
        if (!argument || !referencesAny(argument, tainted)) return;
        if (isExempt(argument, [...ancestors, node])) return;
        if (argument.type === 'CallExpression' || argument.type === 'NewExpression') {
          const verdict = classifyCall(argument, [...ancestors, node]);
          // An allowlisted sink consumes the value; its result carries nothing.
          // `.catch((err) => sampledCaptureException('x', err))` is the shape.
          if (verdict === 'sink') return;
          // Prefer the specific message: when the returned expression is itself
          // a reportable call, let that call report instead of the bare return.
          if (verdict) return;
        }
        report(node, 'catchValueReturned', {});
      }

      walk(root, (node, ancestors) => {
        if (node.type === 'CallExpression' || node.type === 'NewExpression') {
          const verdict = classifyCall(node, ancestors);
          if (!verdict || verdict === 'sink') return;
          // The SITE ban is unconditional. `isExempt` asks whether every tainted
          // READ in the expression is a narrowing test, and a single `typeof err`
          // anywhere in a raw response's arguments made that true — suppressing
          // the one verdict that is supposed to hold whether or not the tracker
          // can see what the body carries.
          if (verdict.messageId === 'rawResponseInCatch' || !isExempt(node, ancestors)) {
            report(node, verdict.messageId, verdict.data);
          }
          return;
        }

        // A tagged template is a call the walk never classified, so
        // `neonSql`UPDATE jobs SET error = ${err.message}`` — this repo's
        // documented DB-write idiom — was a silent store-and-forward channel.
        if (node.type === 'TaggedTemplateExpression') {
          const asCall = {
            type: 'CallExpression',
            callee: node.tag,
            arguments: node.quasi.expressions,
            range: node.range,
          };
          const verdict = classifyCall(asCall, ancestors);
          if (verdict && verdict !== 'sink' && !isExempt(node, ancestors)) {
            report(node, verdict.messageId, verdict.data);
          }
          return;
        }

        if (node.type === 'AssignmentExpression' && referencesAny(node.right, tainted)) {
          if (isExempt(node, ancestors)) return;
          for (const target of patternNames(node.left)) {
            if (!isLocal(target)) {
              report(node, 'catchValueEscapes', { name: outerNameFor(target) });
              return;
            }
          }
          return;
        }

        // `yield` is a fifth way out, and a Next.js streaming route body is
        // idiomatically an async generator.
        if (node.type === 'YieldExpression') {
          const nested = ancestors.some((a) => FUNCTION_TYPES.has(a.type));
          if (!nested) reportReturnLike(node, node.argument, ancestors);
          return;
        }

        if (node.type === 'ReturnStatement') {
          // A `return` inside a function nested in the catch belongs to that
          // function, not to the catch; the function's binding is tainted by
          // the fixpoint instead, so the value is still caught when its RESULT
          // crosses out.
          const nested = ancestors.some((a) => FUNCTION_TYPES.has(a.type));
          if (!nested) reportReturnLike(node, node.argument, ancestors);
        }
      });

      // A callback with an expression body returns without a ReturnStatement:
      // `.catch((e) => (e instanceof Error ? e.message : String(e)))` is the
      // single most idiomatic spelling of the defect, and it was invisible.
      if (isExpressionBody) reportReturnLike(root, root, []);
    }

    /** Every name a catch-like parameter introduces, not just the first. */
    function paramBindings(param) {
      return param ? patternNames(param) : new Set();
    }

    function analyseCallback(callback) {
      if (!callback || !FUNCTION_TYPES.has(callback.type)) return;
      const bindings = paramBindings(callback.params[0]);
      const isExpressionBody = callback.body.type !== 'BlockStatement';
      analyse(callback.body, bindings, isExpressionBody);
    }

    return {
      // `:exit` is not required — the walk below builds its own ancestor stack
      // rather than relying on `node.parent`, which ESLint has not yet assigned
      // on descendants when the CatchClause visitor runs.
      CatchClause(node) {
        // Every name the pattern introduces. Taking only the first meant
        // `catch ({ name, message })` tracked `name` and let `message` through,
        // while the single-property form was caught — the rule LOOKED like it
        // handled destructured params.
        analyse(node.body, paramBindings(node.param), false);
      },
      CallExpression(node) {
        // A promise rejection handler is a catch scope too, in both spellings.
        // The `.then(onFulfilled, onRejected)` half was never scanned.
        if (
          node.callee.type !== 'MemberExpression'
          || node.callee.computed
          || node.callee.property.type !== 'Identifier'
        ) {
          return;
        }
        const method = node.callee.property.name;
        if (method === 'catch') analyseCallback(node.arguments[0]);
        else if (method === 'then') analyseCallback(node.arguments[1]);
      },
    };
  },
};

export default rule;
export {
  DEFAULT_RESPONSE_HELPERS,
  DEFAULT_ERROR_SINKS,
  DEFAULT_LOGGER_OBJECTS,
  DEFAULT_PURE_DERIVATIONS,
  DEFAULT_CLIENT_SAFE_PROPERTIES,
};
