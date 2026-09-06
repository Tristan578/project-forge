/**
 * spawnforge/no-raw-response-in-catch — the caught error must not leave a catch
 * scope, and API error responses built on the catch path must go through a
 * redacting constructor (#9736).
 *
 * WHY THIS IS AN ALLOWLIST AND NOT A LIST OF FORBIDDEN SINKS.
 *
 * Two earlier designs were defeated by a review board, each in one sitting.
 *
 * The first was a regex detector that looked for a caught binding flowing into
 * a response body. Eleven ordinary shapes walked through it — `err.toString()`,
 * `err.response.data`, `const { message } = err`, `NextResponse.json(build(err))`,
 * a header set after construction, an assignment to an outer `let`,
 * `parts.push(err.message)` then `join`, a promise `.catch((e) => ...)`, and so
 * on. A detector that enumerates how a body was ASSEMBLED can always be written
 * around, because the space of ways to build a string is unbounded.
 *
 * The second — the AST rule this replaces — fixed assembly by forbidding the
 * SITE, then enumerated the sites: `.json`, an assignment to an outer binding,
 * an argument to a sanctioned constructor. The board found three more sinks in
 * an afternoon, all lint-clean: the RETURN VALUE of the catch scope
 * (`.catch((e) => e.message)` and a body built at the call site), a response
 * HEADER set on a sanctioned constructor's result, and a `redirect` whose URL
 * carries the text. The sink space is open-ended too, so enumerating it has the
 * same shape of failure as enumerating assembly (lessons-learned #1: a gate
 * that checks a property adjacent to the one that matters).
 *
 * So the model is inverted. Inside a catch scope, the caught binding and every
 * value DERIVED from it are tracked, and the rule reports wherever that value
 * CROSSES OUT of the scope. Crossing out is a closed set, unlike the set of
 * sinks:
 *
 *   - it is RETURNED (a `return`, or a callback's expression body);
 *   - it is WRITTEN into something not declared inside the catch — an
 *     assignment, a destructuring assignment, or a mutating call on an outer or
 *     freshly-constructed receiver (`outer.push`, `db.update(x).set(...)`,
 *     `controller.enqueue(...)`, `Object.assign(outerBody, ...)`);
 *   - it is passed to a SANCTIONED response constructor (redaction is a net,
 *     not a licence: upstream text carries internal hostnames, SQL and other
 *     tenants' identifiers that no shape list will match);
 *   - it is passed to any call that is not on the sink allowlist below.
 *
 * Every sink named in the board's three passes is one of those four, and so is
 * every sink nobody has thought of yet: a value that never leaves the scope
 * cannot reach a client. Derivations themselves — a member read, a template
 * literal, an object or array, `await`, a string method, a local accumulator —
 * are inert, so they are tracked but never reported. That is what keeps the
 * rule quiet enough to leave enabled.
 *
 * The allowlist of terminal sinks is an OPTION (`errorSinks`, `loggerObjects`,
 * `pureDerivations`), set explicitly in `web/eslint.config.mjs` so a reviewer
 * can audit what is permitted without reading this file.
 *
 * Rule 1 (the site ban) is kept alongside the taint model rather than folded
 * into it, and it earns its place: it catches a response built inside a catch
 * whose body carries upstream text the taint tracker cannot see — the classic
 * `NextResponse.json(await upstream.text())` inside a catch, where nothing
 * references the caught binding at all. It now bans EVERY member of
 * NextResponse/Response (`json`, `redirect`, `rewrite`, `next`, `error`),
 * computed or not, because a redirect URL is a client-visible egress channel
 * exactly like a body.
 *
 * ESCAPE HATCH. An ordinary `// eslint-disable-next-line` with a stated reason.
 * The repo bans blanket disables, so a reviewer sees every one of them.
 *
 * KNOWN LIMITS, stated rather than implied. Each was reproduced against this
 * rule; none is a claim that the shape is safe.
 *  - `Promise.allSettled` hands a rejection reason back with no catch clause
 *    anywhere: `rs.filter((r) => r.status === 'rejected').map((r) => r.reason.message)`
 *    has no caught binding to track and is NOT analysed.
 *  - The NON-THROWING path is out of scope by construction. `const r = await
 *    fetch(u); if (!r.ok) return apiError(502, await r.text());` puts the
 *    upstream body in a client response with no catch clause; this rule cannot
 *    see it. `redactSecrets` inside the sanctioned constructor is the only
 *    control there.
 *  - A response constructed inside a helper function that the catch merely
 *    calls is not seen as a construction. It is, however, an unknown-sink call
 *    if the caught value reaches it, and a `catchValueReturned` if its result is
 *    returned — so the laundering path is closed even though the site is not.
 *  - Scope tracking is lexical name tracking, not full scope resolution: a
 *    catch that shadows an outer name is treated as declaring it. Import
 *    RENAMES are resolved (`NextResponse as NR`), shadowing is not.
 *  - A `return` inside a function nested in the catch is not itself reported;
 *    the nested function's binding is tainted instead, so the value is caught
 *    when the function's RESULT crosses out.
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
    for (const statement of context.sourceCode.ast.body) {
      if (statement.type !== 'ImportDeclaration') continue;
      const source = typeof statement.source.value === 'string' ? statement.source.value : '';
      for (const specifier of statement.specifiers) {
        if (specifier.type !== 'ImportSpecifier' || specifier.imported.type !== 'Identifier') continue;
        const imported = specifier.imported.name;
        if (RAW_RESPONSE_OBJECTS.has(imported) && RESPONSE_MODULES.has(source)) {
          rawResponseNames.add(specifier.local.name);
        }
        if (responseHelpers.has(imported)) helperNames.add(specifier.local.name);
      }
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
    function taintedWithin(root, bindings, declared) {
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
            if (targetRoot && declared.has(targetRoot)) tainted.add(targetRoot);
            return;
          }
          if (n.callee.type !== 'MemberExpression') return;
          const receiverRoot = staticReceiverRoot(n.callee.object);
          if (receiverRoot && declared.has(receiverRoot)) tainted.add(receiverRoot);
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
      const tainted = taintedWithin(root, bindings, declared);

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
          if (targetRoot && declared.has(targetRoot)) return null;
          return {
            messageId: 'catchValueEscapes',
            data: { name: targetRoot ?? context.sourceCode.getText(node.callee) },
          };
        }

        if (node.callee.type === 'MemberExpression') {
          const root = staticReceiverRoot(node.callee.object);
          if (root && declared.has(root)) return null; // local accumulation
          return {
            messageId: 'catchValueEscapes',
            // A receiver rooted in a CALL (`db.update(x).set(...)`,
            // `new TextEncoder().encode(...)`) has no root identifier at all,
            // which is why the previous rule was silently inert for the repo's
            // universal DB-write idiom.
            data: { name: root ?? context.sourceCode.getText(node.callee).slice(0, 60) },
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
          if (verdict && verdict !== 'sink' && !isExempt(node, ancestors)) {
            report(node, verdict.messageId, verdict.data);
          }
          return;
        }

        if (node.type === 'AssignmentExpression' && referencesAny(node.right, tainted)) {
          if (isExempt(node, ancestors)) return;
          for (const target of patternNames(node.left)) {
            if (!declared.has(target)) {
              report(node, 'catchValueEscapes', { name: target });
              return;
            }
          }
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
