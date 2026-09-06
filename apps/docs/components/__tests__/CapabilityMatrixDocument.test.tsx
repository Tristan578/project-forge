/**
 * @vitest-environment jsdom
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { axe, toHaveNoViolations } from 'jest-axe';
import '@testing-library/jest-dom';
import { CapabilityMatrixDocument, Inline } from '../CapabilityMatrixDocument';
import {
  ISSUE_BASE_URL,
  parseCapabilityMatrix,
  readCapabilityMatrix,
} from '../../lib/capabilityMatrix';

expect.extend(toHaveNoViolations);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROBE_SCRIPT = path.resolve(HERE, '../../../../scripts/post-deploy-capability-matrix-check.sh');

const SAMPLE = `# Sample Matrix

> **Measured on:** 2026-09-05. Tracking: [#9720](https://github.com/Tristan578/project-forge/issues/9720).

Intro with \`code\` and a bare #9117 reference.

## Legend

- \`proven\` — verified
- \`excluded\` — by design

| Capability | Human/UI | In-app AI | Scripting | External MCP | Notes |
|---|---|---|---|---|---|
| \`generation:music\` | unavailable (#9522) | unavailable (#9522) | excluded | unavailable (#9722, #9522) | Suno. |
| \`commands:scene\` | proven | implemented-unverified (#9714) | partial (#9284) | unavailable (#9722) | See \`engine-smoke.spec.ts\`. |
`;

describe('Inline', () => {
  it('renders code, bold, links and issue references', () => {
    const { container } = render(
      <Inline text="Run `jq` **now**, see [gate](https://example.test/g) and #42." />,
    );
    expect(container.querySelector('code')).toHaveTextContent('jq');
    expect(container.querySelector('strong')).toHaveTextContent('now');
    expect(screen.getByRole('link', { name: 'gate' })).toHaveAttribute('href', 'https://example.test/g');
    expect(screen.getByRole('link', { name: '#42' })).toHaveAttribute('href', `${ISSUE_BASE_URL}42`);
    expect(container).toHaveTextContent('Run jq now, see gate and #42.');
  });
});

describe('CapabilityMatrixDocument', () => {
  it('renders the title as the page h1 and a ## section as the h2 directly beneath it', () => {
    // No skipped level: the document's `#` is the h1 and `##` is the h2 (axe
    // heading-order). The previous mapping rendered `##` as h3 with no h2
    // anywhere on the page, and the test pinned the defect.
    render(<CapabilityMatrixDocument doc={parseCapabilityMatrix(SAMPLE)} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sample Matrix');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Legend');
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
  });

  it('never mints a second h1 from a stray # in the body', () => {
    render(<CapabilityMatrixDocument doc={parseCapabilityMatrix('# Title\n\n# Stray\n\n### Deep')} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Stray');
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Deep');
  });

  // Both directions of WCAG 1.3.1 for this table, asserted by SCOPE rather than
  // by counting every `th` on the page. The old version counted six and demanded
  // `scope="col"` on all of them, so it could only pass while each row's key was
  // a plain `td` — which is exactly the defect that left every row unnamed to a
  // screen reader. A count is not the property a reader depends on.
  it('scopes the six column headers to their columns', () => {
    const { container } = render(<CapabilityMatrixDocument doc={parseCapabilityMatrix(SAMPLE)} />);
    const colHeaders = [...container.querySelectorAll('thead th')];
    expect(colHeaders).toHaveLength(6);
    for (const th of colHeaders) expect(th).toHaveAttribute('scope', 'col');
  });

  it('scopes each row key to its row, so a screen reader names the capability', () => {
    const { container } = render(<CapabilityMatrixDocument doc={parseCapabilityMatrix(SAMPLE)} />);
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const first = row.firstElementChild;
      expect(first?.tagName).toBe('TH');
      expect(first).toHaveAttribute('scope', 'row');
    }
    // A row key is the row's subject, never a status, so it carries no badge.
    expect(container.querySelector('tbody tr th [data-status]')).toBeNull();
  });

  it('renders the quote, paragraph and list blocks', () => {
    const { container } = render(<CapabilityMatrixDocument doc={parseCapabilityMatrix(SAMPLE)} />);
    expect(container.querySelector('blockquote')).toHaveTextContent('Measured on: 2026-09-05');
    expect(screen.getByRole('link', { name: '#9720' })).toHaveAttribute(
      'href',
      'https://github.com/Tristan578/project-forge/issues/9720',
    );
    expect(screen.getByRole('link', { name: '#9117' })).toHaveAttribute('href', `${ISSUE_BASE_URL}9117`);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('renders status cells as badges with their issue references linked', () => {
    const { container } = render(<CapabilityMatrixDocument doc={parseCapabilityMatrix(SAMPLE)} />);
    const badges = [...container.querySelectorAll('[data-status]')].map((el) => el.getAttribute('data-status'));
    expect(badges).toEqual([
      'unavailable',
      'unavailable',
      'excluded',
      'unavailable',
      'proven',
      'implemented-unverified',
      'partial',
      'unavailable',
    ]);
    // Three cells reference #9522 (two alone, one alongside #9722); every
    // reference links to the issue.
    expect(screen.getAllByRole('link', { name: '#9522' })).toHaveLength(3);
    expect(screen.getAllByRole('link', { name: '#9722' })).toHaveLength(2);
  });

  it('renders non-status cells as inline markdown, not badges', () => {
    const { container } = render(<CapabilityMatrixDocument doc={parseCapabilityMatrix(SAMPLE)} />);
    // The row key lives in the row's `<th scope="row">`, not in a `td` — a
    // `tbody td` selector reaches the first STATUS cell instead and reads a
    // badge, which is what this assertion was doing before the header change.
    const rowKeyCell = container.querySelector('tbody tr th');
    expect(rowKeyCell?.querySelector('[data-status]')).toBeNull();
    expect(rowKeyCell?.querySelector('code')).toHaveTextContent('generation:music');
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Capability',
      'Human/UI',
      'In-app AI',
      'Scripting',
      'External MCP',
      'Notes',
    ]);
  });

  // The shipped document itself is checked in lib/__tests__/capabilityMatrix.test.ts
  // (every row's four entry-point cells carry a status) without a DOM render,
  // which under jsdom + coverage takes longer than the suite's per-test budget.
});

describe('the scrolling table wrapper is keyboard-operable (WCAG 2.1.1)', () => {
  // `Table` forces `minWidth: 48rem` on every table inside an `overflow-x:auto`
  // div, so below ~800px of viewport EVERY table scrolls. A scroll container
  // with no focusable descendant cannot be scrolled by keyboard at all — and
  // the document's FIRST table (the four entry-point definitions) has none: no
  // links, no `#NNNN`, only prose. The whole "Meaning" column, which is the key
  // to reading every badge below it, was unreachable. axe calls this
  // `scrollable-region-focusable` (serious).
  //
  // jsdom performs no layout, so scrollWidth/clientWidth are both 0 and axe's
  // own rule cannot fire here (see the axe block below for what it does cover).
  // These assertions therefore check the fix directly rather than through axe.
  it('gives every table wrapper tabIndex, role=region and a name from its heading', () => {
    const { container } = render(<CapabilityMatrixDocument doc={parseCapabilityMatrix(SAMPLE)} />);
    const tables = [...container.querySelectorAll('table')];
    expect(tables.length, 'the sample rendered no table — the walk below would be vacuous').toBe(1);
    for (const table of tables) {
      const wrapper = table.parentElement;
      expect(wrapper?.tagName).toBe('DIV');
      expect(wrapper).toHaveAttribute('tabindex', '0');
      expect(wrapper).toHaveAttribute('role', 'region');
      expect(wrapper?.getAttribute('aria-label') ?? '').not.toBe('');
    }
    // Named after the section it belongs to, so a screen-reader user landing on
    // one of four regions knows which table it is.
    expect(screen.getByRole('region', { name: /Legend/ })).toBeInTheDocument();
  });

  it('names the first table after the document title when no ## heading precedes it', () => {
    // The real document opens with a table under the `#` title (the four entry
    // points), before any `##`. An empty accessible name would leave the region
    // unnamed, which is its own axe failure.
    const doc = parseCapabilityMatrix('# Entry Points\n\n| Column | Meaning |\n|---|---|\n| A | B |\n');
    render(<CapabilityMatrixDocument doc={doc} />);
    expect(screen.getByRole('region', { name: /Entry Points/ })).toBeInTheDocument();
  });

  it('the wrapper is the ONLY keyboard route into the first table of the real document', () => {
    // If this table ever gains a link, the axe rule would pass incidentally and
    // the wrapper could be removed without anything noticing — which is exactly
    // how the Legend and matrix tables scraped past it. Assert the premise.
    const { container } = render(<CapabilityMatrixDocument doc={readCapabilityMatrix()} />);
    const first = container.querySelector('table');
    expect(first, 'the real document rendered no table').not.toBeNull();
    expect(
      first!.querySelectorAll('a, button, input, select, textarea, [tabindex]').length,
      'the first table now has focusable descendants — re-derive whether the wrapper is still the only keyboard route',
    ).toBe(0);
    expect(first!.parentElement).toHaveAttribute('tabindex', '0');
  });
});

describe('the matrix row-key column is a row header (WCAG 1.3.1)', () => {
  // Every body cell used to be a `<td>`, including the column carrying
  // `generation:music` / `commands:scene`. Navigating a six-column matrix
  // cell-by-cell, a screen-reader user heard "In-app AI, unavailable" with no
  // indication of WHICH capability the row was about — the row identity was
  // conveyed by visual position only.
  it('renders cell 0 of every body row as th[scope=row] and the rest as td', () => {
    const { container } = render(<CapabilityMatrixDocument doc={parseCapabilityMatrix(SAMPLE)} />);
    const bodyRows = [...container.querySelectorAll('tbody tr')];
    expect(bodyRows.length, 'no body rows rendered — the walk below would be vacuous').toBe(2);
    for (const row of bodyRows) {
      const cells = [...row.children];
      expect(cells[0].tagName).toBe('TH');
      expect(cells[0]).toHaveAttribute('scope', 'row');
      for (const cell of cells.slice(1)) expect(cell.tagName).toBe('TD');
    }
    expect(screen.getAllByRole('rowheader').map((th) => th.textContent)).toEqual([
      'generation:music',
      'commands:scene',
    ]);
    // The column headers are unchanged: exactly six, all scope="col".
    const colHeaders = [...container.querySelectorAll('th[scope="col"]')];
    expect(colHeaders.length).toBe(6);
  });
});

describe('axe on the rendered document', () => {
  // The docs app's first substantial data table shipped with three hand-written
  // a11y assertions and no rule engine, so every rule nobody thought to name was
  // unguarded. This is the net for the rules not enumerated by hand.
  //
  // HONEST BOUND, so nobody counts this as more coverage than it is: jsdom does
  // no layout, so anything measuring geometry — `scrollable-region-focusable`,
  // `color-contrast`, target size — is inert here and is asserted directly in
  // the blocks above instead. What this DOES cover is structure: heading order,
  // table markup and header association, region naming, landmark and role
  // validity, duplicate ids, list nesting.
  it('reports no violations for the sample document', async () => {
    const { container } = render(<CapabilityMatrixDocument doc={parseCapabilityMatrix(SAMPLE)} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('the SSR output matches what the post-deploy probe greps for', () => {
  /**
   * `scripts/post-deploy-capability-matrix-check.sh` greps the DEPLOYED page's
   * HTML with two regexes. Until now the only thing in the tree producing that
   * string shape was a fixture the probe's own suite author wrote by hand, and
   * the jsdom tests above assert on the parsed DOM, which normalises away
   * exactly the serialisation the probe depends on. So nothing could disagree
   * with the fixture — lesson #14: a self-authored fixture pins whatever
   * contract you believed, right or wrong.
   *
   * The patterns are EXTRACTED from the script rather than restated, so the
   * coupling breaks here, in CI, instead of in CD. Changing `<td` to `<th` for
   * the row-key column (the WCAG 1.3.1 fix above) is precisely the edit that
   * would otherwise have reddened the deploy.
   */
  const script = fs.readFileSync(PROBE_SCRIPT, 'utf-8');

  const extract = (label: string, re: RegExp): string => {
    const match = script.match(re);
    if (!match?.[1]) {
      throw new Error(
        `could not extract the ${label} pattern from ${PROBE_SCRIPT} — this test would pass vacuously`,
      );
    }
    return match[1];
  };

  const headerPattern = extract('column-header', /grep -q '(<th\[\^>\]\*scope="col")'/);
  const markerPattern = extract('marker-row', /grep -Eq "(<t[hd]\[\^>\]\*><code\[\^>\]\*>\$\{expect\}<\/code>)"/);
  const markerRow = extract('marker-row default', /local expect="\$\{MATRIX_CHECK_EXPECT_ROW:-([^}]+)\}"/);

  const html = renderToStaticMarkup(<CapabilityMatrixDocument doc={readCapabilityMatrix()} />);

  it('extracted real patterns from the probe (never a vacuous pass)', () => {
    expect(headerPattern).toContain('scope="col"');
    expect(markerPattern).toContain('${expect}');
    expect(markerRow.length).toBeGreaterThan(0);
    expect(html.length).toBeGreaterThan(1000);
  });

  it('emits a column header the probe recognises', () => {
    expect(html).toMatch(new RegExp(headerPattern));
  });

  it('emits the marker row the probe looks for, in the element the probe expects', () => {
    expect(html).toMatch(new RegExp(markerPattern.replace('${expect}', markerRow)));
  });
});
