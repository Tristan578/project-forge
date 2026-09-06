/**
 * spawnforge/no-raw-response-in-catch — API error responses built on the catch
 * path must go through a redacting response constructor (#9736).
 *
 * WHY THIS IS AN AST RULE AND NOT A SOURCE SCAN.
 *
 * The first attempt at this control was a regex detector that looked for a
 * caught binding flowing into a response body. A review board defeated it with
 * eleven ordinary shapes in one sitting — `err.toString()`, `err.response.data`,
 * an `if` instead of a ternary, `const { message } = err`,
 * `NextResponse.json(buildBody(err))`, `new NextResponse(JSON.stringify(...))`,
 * a header set after construction, an assignment to an outer `let`,
 * `parts.push(err.message)` then `join`, a promise `.catch((e) => ...)`
 * callback, and a plain `new Response(String(err))`. Each is the natural way a
 * developer writes the same thing. A detector that enumerates how a body was
 * ASSEMBLED can always be written around, because the space of ways to build a
 * string is unbounded.
 *
 * So this rule does not look at assembly at all. It forbids the SITE:
 *
 *   1. No raw response construction anywhere inside a catch scope.
 *      `NextResponse.json`, `Response.json`, `new NextResponse`, `new Response`
 *      are all banned there; the sanctioned redacting constructors from
 *      `@/lib/api/errors` must be used instead. It no longer matters how the
 *      body was built, so all eleven shapes above collapse into one report.
 *
 *      This also puts redaction genuinely ON the path rather than adjacent to
 *      it. The previous design claimed `redactSecrets` as a second layer, but
 *      it lived inside two constructors that the API surface barely used: 89 of
 *      101 route files built error bodies with a raw `NextResponse.json`, so
 *      the "net" covered none of the routes that had the defect.
 *
 *   2. The caught value must not ESCAPE the catch scope into a binding declared
 *      outside it, because a response constructed after the try/catch would sit
 *      outside rule 1's reach. This is the `let message` / `parts.push` class.
 *
 *   3. Inside a catch scope, a value derived from the caught error must not be
 *      passed to a sanctioned constructor either — redaction is a net, not a
 *      licence, and upstream text carries plenty that is sensitive without
 *      being a credential (internal hostnames, SQL, another tenant's ids).
 *      The one exemption is a value narrowed with `instanceof` to an error
 *      class whose message is OURS, and the exemption is scoped to the narrowed
 *      BRANCH — not to a window of nearby characters, which is how the previous
 *      detector silently exempted the fall-through after a narrowing `if`.
 *
 * ESCAPE HATCH. An ordinary `// eslint-disable-next-line` with a stated reason.
 * The repo bans blanket disables, so a reviewer sees every one of them.
 *
 * KNOWN LIMITS, stated rather than implied:
 *  - A response constructed inside a helper function that the catch merely
 *    calls is not seen. Rule 1 makes that a deliberate act (you must move the
 *    construction out of the catch), not an accident.
 *  - Narrowing by early return (`if (!(e instanceof X)) throw e`) is not
 *    recognised as a narrowing for rule 3; write the `instanceof` branch or
 *    disable with a reason.
 *  - Scope tracking is lexical name tracking, not full scope resolution: a
 *    catch that shadows an outer name is treated as declaring it.
 */

/** Response constructors that perform no redaction. Banned inside a catch scope. */
const RAW_RESPONSE_OBJECTS = new Set(['NextResponse', 'Response']);

/**
 * Members that mutate their receiver. Used by rule 2: a call of one of these on
 * a binding declared OUTSIDE the catch, carrying the caught value, is the same
 * escape as an assignment. `assign` is here so `Object.assign(body, { detail:
 * err.message })` is covered; `Object` is never declared inside a catch, so the
 * outer-binding test holds for it.
 *
 * Telemetry calls need no allowlist precisely because this set is a list of
 * mutators: `console.error(err)`, `Sentry.captureException(err)` and
 * `captureException(err)` are not mutations and never match.
 */
const MUTATING_MEMBERS = new Set([
  'push', 'unshift', 'splice', 'set', 'add', 'append', 'assign', 'write', 'fill',
]);

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

const NON_AST_KEYS = new Set(['parent', 'loc', 'range', 'start', 'end', 'tokens', 'comments']);

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

/** AST positions that hold a NAME rather than a value reference. */
const REF_SKIP_KEYS = new Set([
  'typeAnnotation', 'returnType', 'typeParameters', 'typeArguments', 'superTypeArguments',
]);

/**
 * True when the subtree READS any of `names`.
 *
 * Deliberately "reads", not "mentions": an identifier sitting in a non-computed
 * property key (`{ error: 'Failed' }`), a non-computed member (`res.error`) or
 * a type annotation is a NAME, not a reference to the binding. Counting those
 * made every `catch (error) { ... { error: 'Failed' } ... }` report — the
 * single most common shape in this codebase — which would have taught everyone
 * to disable the rule rather than to fix anything.
 */
function referencesAny(node, names) {
  if (!node || names.size === 0) return false;
  let found = false;
  const visit = (n) => {
    if (found || !n || typeof n.type !== 'string') return;
    if (n.type === 'Identifier') {
      if (names.has(n.name)) found = true;
      return;
    }
    if (n.type === 'MemberExpression') {
      visit(n.object);
      if (n.computed) visit(n.property);
      return;
    }
    if (n.type === 'Property' || n.type === 'PropertyDefinition' || n.type === 'MethodDefinition') {
      if (n.computed) visit(n.key);
      visit(n.value);
      return;
    }
    for (const key of Object.keys(n)) {
      if (NON_AST_KEYS.has(key) || REF_SKIP_KEYS.has(key)) continue;
      const value = n[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object' && typeof item.type === 'string') visit(item);
        }
      } else if (value && typeof value === 'object' && typeof value.type === 'string') {
        visit(value);
      }
    }
  };
  visit(node);
  return found;
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
    default:
      break;
  }
  return into;
}

/** The root identifier of a member chain: `a.b.c[d]` -> `a`. */
function rootIdentifier(node) {
  let current = node;
  while (current && current.type === 'MemberExpression') current = current.object;
  return current && current.type === 'Identifier' ? current : null;
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
 * True when `test` narrows one of `tainted` to a client-safe error class.
 * `negated` flips the sense, so the `else` of `if (!(e instanceof X))` counts.
 */
function narrowsToClientSafe(test, tainted, clientSafe, negated) {
  if (!test) return false;
  if (test.type === 'UnaryExpression' && test.operator === '!') {
    return narrowsToClientSafe(test.argument, tainted, clientSafe, !negated);
  }
  if (test.type === 'LogicalExpression' && test.operator === '&&' && !negated) {
    return (
      narrowsToClientSafe(test.left, tainted, clientSafe, negated)
      || narrowsToClientSafe(test.right, tainted, clientSafe, negated)
    );
  }
  if (negated) return false;
  if (test.type !== 'BinaryExpression' || test.operator !== 'instanceof') return false;
  const left = test.left;
  const right = test.right;
  return (
    left.type === 'Identifier'
    && tainted.has(left.name)
    && right.type === 'Identifier'
    && clientSafe.has(right.name)
  );
}

/**
 * True when `ancestors` places the node inside a branch narrowed by
 * `instanceof` to a client-safe error. The exemption is scoped to the BRANCH,
 * which is the whole point: the previous text detector exempted anything within
 * 400 characters of a narrowing `if`, so the fall-through response after that
 * `if` inherited the exemption and leaked silently.
 */
function insideClientSafeBranch(ancestors, tainted, clientSafe) {
  for (let i = 0; i < ancestors.length - 1; i += 1) {
    const parent = ancestors[i];
    const child = ancestors[i + 1];
    if (parent.type === 'IfStatement' || parent.type === 'ConditionalExpression') {
      if (child === parent.consequent && narrowsToClientSafe(parent.test, tainted, clientSafe, false)) {
        return true;
      }
      if (child === parent.alternate && narrowsToClientSafe(parent.test, tainted, clientSafe, true)) {
        return true;
      }
    }
  }
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require catch-path API responses to be built by a redacting constructor, and keep the caught error out of them (#9736)',
    },
    schema: [
      {
        type: 'object',
        properties: {
          /** Error classes whose `message` is authored here for the user. */
          clientSafeErrors: { type: 'array', items: { type: 'string' } },
          /** Sanctioned redacting constructors. */
          responseHelpers: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      rawResponseInCatch:
        'Do not construct a response inside a catch. `{{name}}` performs no redaction, and a body assembled here can carry upstream provider text (#9736). Use a redacting constructor from @/lib/api/errors ({{helpers}}), or move the construction out of the catch.',
      catchValueEscapes:
        'The caught error escapes this catch into `{{name}}`, which is declared outside it — a response built later from `{{name}}` is beyond the reach of this rule (#9736). Keep the error inside the catch: log it, then respond with a fixed message.',
      catchValueInResponseHelper:
        'A value derived from the caught error is passed to `{{helper}}`. Redaction is a net, not a licence: upstream text carries internal hostnames, SQL and other tenants\' identifiers that no shape list will match (#9736). Send a fixed message, or narrow with `instanceof` to an error class whose message is ours.',
    },
  },

  create(context) {
    const options = context.options[0] ?? {};
    const clientSafe = new Set(options.clientSafeErrors ?? []);
    const responseHelpers = new Set(options.responseHelpers ?? DEFAULT_RESPONSE_HELPERS);
    const helperList = [...responseHelpers].slice(0, 3).join(', ');
    // A catch nested inside a catch is analysed by both, so dedupe reports.
    const reported = new Set();

    function report(node, messageId, data) {
      const key = `${node.range?.[0] ?? 0}:${node.range?.[1] ?? 0}:${messageId}`;
      if (reported.has(key)) return;
      reported.add(key);
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
        else if (
          n.type === 'FunctionDeclaration'
          || n.type === 'FunctionExpression'
          || n.type === 'ArrowFunctionExpression'
        ) {
          for (const param of n.params) patternNames(param, declared);
        } else if (n.type === 'CatchClause' && n.param) patternNames(n.param, declared);
      });
      return declared;
    }

    /**
     * Names holding something derived from the caught error, to a fixpoint.
     * `const { message } = err`, `const m = err.message`, `let s; s = String(err)`
     * and `const parts = [err.message]` all land here — which is why rule 3 does
     * not care whether the developer used `.message`, `.toString()`,
     * `.response.data`, a destructure or a helper call.
     */
    function taintedWithin(root, binding) {
      const tainted = new Set(binding ? [binding] : []);
      if (!binding) return tainted;
      for (let pass = 0; pass < 8; pass += 1) {
        const before = tainted.size;
        walk(root, (n) => {
          if (n.type === 'VariableDeclarator' && n.init && referencesAny(n.init, tainted)) {
            patternNames(n.id, tainted);
          } else if (n.type === 'AssignmentExpression' && referencesAny(n.right, tainted)) {
            const target = rootIdentifier(n.left);
            if (target) tainted.add(target.name);
          }
        });
        if (tainted.size === before) break;
      }
      return tainted;
    }

    function analyse(root, binding) {
      if (!root) return;
      const declared = declaredWithin(root);
      if (binding) declared.add(binding);
      const tainted = taintedWithin(root, binding);

      walk(root, (node, ancestors) => {
        // --- Rule 1: no raw response construction on the catch path. --------
        if (
          node.type === 'CallExpression'
          && node.callee.type === 'MemberExpression'
          && !node.callee.computed
          && node.callee.object.type === 'Identifier'
          && RAW_RESPONSE_OBJECTS.has(node.callee.object.name)
          && node.callee.property.type === 'Identifier'
          && node.callee.property.name === 'json'
        ) {
          report(node, 'rawResponseInCatch', {
            name: `${node.callee.object.name}.json`,
            helpers: helperList,
          });
          return;
        }
        if (
          node.type === 'NewExpression'
          && node.callee.type === 'Identifier'
          && RAW_RESPONSE_OBJECTS.has(node.callee.name)
        ) {
          report(node, 'rawResponseInCatch', {
            name: `new ${node.callee.name}`,
            helpers: helperList,
          });
          return;
        }

        // --- Rule 2: the caught value must not escape into an outer binding. -
        if (node.type === 'AssignmentExpression' && referencesAny(node.right, tainted)) {
          const target = rootIdentifier(node.left);
          if (target && !declared.has(target.name)) {
            report(node, 'catchValueEscapes', { name: target.name });
            return;
          }
        }
        if (
          node.type === 'CallExpression'
          && node.callee.type === 'MemberExpression'
          && !node.callee.computed
          && node.callee.property.type === 'Identifier'
          && MUTATING_MEMBERS.has(node.callee.property.name)
        ) {
          const receiver = rootIdentifier(node.callee.object);
          const carriesTaint = node.arguments.some((arg) => referencesAny(arg, tainted));
          if (receiver && carriesTaint && !declared.has(receiver.name)) {
            report(node, 'catchValueEscapes', { name: receiver.name });
            return;
          }
        }

        // --- Rule 3: the caught value must not reach a sanctioned helper. ---
        if (node.type === 'CallExpression' || node.type === 'NewExpression') {
          const name = calleeName(node.callee);
          if (name && responseHelpers.has(name) && node.arguments.some((a) => referencesAny(a, tainted))) {
            if (!insideClientSafeBranch([...ancestors, node], tainted, clientSafe)) {
              report(node, 'catchValueInResponseHelper', { helper: name });
            }
          }
        }
      });
    }

    return {
      // `:exit` is not required — the walk below builds its own ancestor stack
      // rather than relying on `node.parent`, which ESLint has not yet assigned
      // on descendants when the CatchClause visitor runs.
      CatchClause(node) {
        const binding = node.param ? [...patternNames(node.param)][0] ?? null : null;
        analyse(node.body, binding);
      },
      CallExpression(node) {
        // Promise `.catch(cb)` is a catch scope too. The previous detector's
        // binding regex could not match this form at all, so an entire class of
        // error handling was never scanned.
        if (
          node.callee.type !== 'MemberExpression'
          || node.callee.computed
          || node.callee.property.type !== 'Identifier'
          || node.callee.property.name !== 'catch'
        ) {
          return;
        }
        const callback = node.arguments[0];
        if (
          !callback
          || (callback.type !== 'ArrowFunctionExpression' && callback.type !== 'FunctionExpression')
        ) {
          return;
        }
        const param = callback.params[0];
        const binding = param ? [...patternNames(param)][0] ?? null : null;
        analyse(callback.body, binding);
      },
    };
  },
};

export default rule;
export { DEFAULT_RESPONSE_HELPERS };
