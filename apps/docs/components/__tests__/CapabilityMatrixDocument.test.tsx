/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CapabilityMatrixDocument, Inline } from '../CapabilityMatrixDocument';
import { ISSUE_BASE_URL, parseCapabilityMatrix } from '../../lib/capabilityMatrix';

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
  it('renders the title as the page h1 and section headings one level down', () => {
    render(<CapabilityMatrixDocument doc={parseCapabilityMatrix(SAMPLE)} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sample Matrix');
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Legend');
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
    const firstCell = container.querySelector('tbody td');
    expect(firstCell?.querySelector('[data-status]')).toBeNull();
    expect(firstCell?.querySelector('code')).toHaveTextContent('generation:music');
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
