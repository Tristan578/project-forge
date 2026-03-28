/**
 * Loop guard injection for the script sandbox (PF-511, PF-524, PF-589).
 *
 * Transforms user script source by inserting per-loop iteration counters that
 * throw an "Infinite loop detected" error when a single loop exceeds the
 * configured limit. Each loop gets its own counter variable (__lg0, __lg1, ...)
 * so unrelated loops don't interfere with each other.
 *
 * PF-589: Returns guardVarNames alongside the transformed source so callers can
 * generate a __resetGuards() function, ensuring counters are reset to 0 at each
 * script entry-point call (onStart/onUpdate/onDestroy). This prevents legitimate
 * loops with moderate iteration counts from accumulating across frames and
 * falsely triggering the guard after extended play time.
 */

export interface LoopGuardResult {
  source: string;
  guardVarNames: string[];
}

export function injectLoopGuards(source: string): LoopGuardResult {
  // PF-524: Each loop gets its own counter variable (__lg0, __lg1, ...)
  // declared immediately before the loop statement so the counter resets
  // each time control reaches the loop. The guard check increments the
  // counter on every iteration and throws when the limit is exceeded.
  //
  // PF-589: guardVarNames is returned so callers can emit a reset snippet
  // that sets all counters back to 0 at each script entry-point call,
  // preventing legitimate loops from accumulating iterations across frames.
  //
  // For do-while loops, the trailing `while(cond)` must not be treated as
  // a standalone while-loop. We track open do-body braces to detect this.
  let loopIndex = 0;
  const guardVarNames: string[] = [];
  let result = '';
  let i = 0;
  const src = source;
  const len = src.length;
  // Stack of brace depths where do-while bodies start.
  // When we see `do {`, we push the current brace depth.
  // When the depth returns to that level, the next `while` is the do-while
  // condition and must be emitted verbatim (no guard injection).
  let braceDepth = 0;
  const doBodyStartDepths: number[] = [];
  let skipNextWhile = false;
  while (i < len) {
    // Track brace depth for do-while detection
    if (src[i] === '{') braceDepth++;
    if (src[i] === '}') {
      braceDepth--;
      // If we just closed a do-while body, flag to skip the next `while`
      if (doBodyStartDepths.length > 0 && braceDepth === doBodyStartDepths[doBodyStartDepths.length - 1]) {
        doBodyStartDepths.pop();
        skipNextWhile = true;
      }
    }
    if (src[i] === '"' || src[i] === "'" || src[i] === '`') {
      // KNOWN LIMITATION: Template literals with ${...} expressions are scanned
      // with a simple quote-matching loop that does NOT track expression depth.
      // A template literal containing a nested loop — e.g. `${[1,2].forEach(i=>{for(;;){}})}` —
      // will have the loop scanner skip the inner loop body because it's inside the
      // string range delimited by the backtick pair. This means loop guards are NOT
      // injected into loops inside template literal expressions.
      // Mitigation: the worker runs with a per-frame iteration budget (onUpdate timeout)
      // so such loops will eventually be killed by the frame watchdog even without guards.
      // TODO(PF): Implement a proper JS tokenizer (or use acorn) to correctly handle
      // nested expressions in template literals.
      const quote = src[i];
      result += src[i++];
      while (i < len && src[i] !== quote) {
        if (src[i] === '\\') { result += src[i++]; }
        if (i < len) { result += src[i++]; }
      }
      if (i < len) result += src[i++];
      continue;
    }
    if (src[i] === '/' && i + 1 < len && src[i + 1] === '/') {
      while (i < len && src[i] !== '\n') result += src[i++];
      continue;
    }
    if (src[i] === '/' && i + 1 < len && src[i + 1] === '*') {
      result += src[i++]; result += src[i++];
      while (i < len && !(src[i] === '*' && i + 1 < len && src[i + 1] === '/')) result += src[i++];
      if (i < len) { result += src[i++]; result += src[i++]; }
      continue;
    }
    const remaining = src.slice(i);
    if (/^while\b/.test(remaining) && (i === 0 || !/\w/.test(src[i - 1]))) {
      if (skipNextWhile) {
        // This is the condition part of a do-while — emit verbatim
        skipNextWhile = false;
        result += src[i++];
        continue;
      }
      const gv = '__lg' + loopIndex++;
      guardVarNames.push(gv);
      const gd = 'let ' + gv + '=0;';
      const gc = 'if(++' + gv + '>__loopLimit)throw new Error("Infinite loop detected: exceeded "+__loopLimit+" iterations");';
      result += gd + 'while';
      i += 5;
      while (i < len && /\s/.test(src[i])) result += src[i++];
      if (i < len && src[i] === '(') {
        let depth = 0;
        do { if (src[i] === '(') depth++; else if (src[i] === ')') depth--; result += src[i++]; } while (i < len && depth > 0);
        while (i < len && /\s/.test(src[i])) result += src[i++];
        if (i < len && src[i] === '{') { result += '{' + gc; braceDepth++; i++; }
        else { result += '{' + gc; while (i < len && src[i] !== ';' && src[i] !== '\n') result += src[i++]; if (i < len && src[i] === ';') result += src[i++]; result += '}'; }
      }
      continue;
    }
    if (/^for\b/.test(remaining) && (i === 0 || !/\w/.test(src[i - 1]))) {
      const gv = '__lg' + loopIndex++;
      guardVarNames.push(gv);
      const gd = 'let ' + gv + '=0;';
      const gc = 'if(++' + gv + '>__loopLimit)throw new Error("Infinite loop detected: exceeded "+__loopLimit+" iterations");';
      result += gd + 'for';
      i += 3;
      while (i < len && /\s/.test(src[i])) result += src[i++];
      if (i < len && src[i] === '(') {
        let depth = 0;
        do { if (src[i] === '(') depth++; else if (src[i] === ')') depth--; result += src[i++]; } while (i < len && depth > 0);
        while (i < len && /\s/.test(src[i])) result += src[i++];
        if (i < len && src[i] === '{') { result += '{' + gc; braceDepth++; i++; }
        else { result += '{' + gc; while (i < len && src[i] !== ';' && src[i] !== '\n') result += src[i++]; if (i < len && src[i] === ';') result += src[i++]; result += '}'; }
      }
      continue;
    }
    if (/^do\b/.test(remaining) && (i === 0 || !/\w/.test(src[i - 1]))) {
      const gv = '__lg' + loopIndex++;
      guardVarNames.push(gv);
      const gd = 'let ' + gv + '=0;';
      const gc = 'if(++' + gv + '>__loopLimit)throw new Error("Infinite loop detected: exceeded "+__loopLimit+" iterations");';
      result += gd + 'do';
      i += 2;
      while (i < len && /\s/.test(src[i])) result += src[i++];
      if (i < len && src[i] === '{') {
        // Record the depth BEFORE opening the brace so we can detect
        // when this do-body closes.
        doBodyStartDepths.push(braceDepth);
        result += '{' + gc;
        braceDepth++;
        i++;
      } else {
        // Braceless do-while: wrap the single statement in braces with guard
        result += '{' + gc;
        while (i < len && src[i] !== ';' && src[i] !== '\n') result += src[i++];
        if (i < len && src[i] === ';') result += src[i++];
        result += '}';
        skipNextWhile = true;
      }
      continue;
    }
    result += src[i++];
  }
  return { source: result, guardVarNames };
}
