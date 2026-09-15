import { describe, expect, it } from 'vitest';

import { buildUnmappedReport, scan, type ScanConfig } from '../scan.ts';

const emptyScope = { covered: [], notYetCovered: [] };

function sectionLines(report: string, heading: string): string[] {
  const section = report.split(`## ${heading}\n`)[1];
  expect(section).toBeDefined();
  return section.split('\n## ')[0].split('\n').filter((line) => line.length > 0);
}

function tableSeparators(line: string): number {
  // Escaped punctuation is literal content, including an escaped backslash.
  return line.replace(/\\./g, '').split('|').length - 1;
}

describe('buildUnmappedReport — untrusted report text', () => {
  it('keeps excluded filenames and reasons in one three-column row', () => {
    const filename = 'generated/asset|`draft`\r\n## Forged heading.txt';
    const reason = '<img src=x onerror=alert(1)> &copy; [read](javascript:alert(1)) ' +
      '**bold** _italic_ ~~strike~~ | `code`\n| forged | row |\t\u0001\u007f';
    const result = scan({
      files: [filename],
      rules: [],
      coveredScopes: ['generated/'],
      exclusions: [{ category: 'generated', reason, patterns: [filename] }],
    });
    expect(result.excluded).toEqual([{ path: filename, category: 'generated', reason }]);

    const report = buildUnmappedReport(result, emptyScope);
    const rows = sectionLines(report, 'Excluded files (reasoned)');
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(tableSeparators(row)).toBe(4);
    expect(rows[2]).toContain('generated/asset\\|\\`draft\\`');
    expect(rows[2]).toContain('&lt;img');
    expect(rows[2]).toContain('&gt;');
    expect(rows[2]).toContain('&amp;copy;');
    expect(rows[2]).toContain('\\[read\\]');
    expect(rows[2]).toContain('\\*\\*bold\\*\\*');
    expect(rows[2]).toContain('\\_italic\\_');
    expect(rows[2]).toContain('\\~\\~strike\\~\\~');
    expect(report).not.toContain('<img');
    expect(report).not.toContain('\n## Forged heading');
    expect(report).not.toContain('\n| forged | row |');
    for (const visible of ['\\r', '\\n', '\\t', '\\u0001', '\\u007f']) {
      expect(rows[2]).toContain(visible);
    }
    for (const control of ['\r', '\t', '\u0001', '\u007f']) {
      expect(report).not.toContain(control);
    }
    // Escaping is a presentation concern; the inventory retains exact paths.
    expect(result.excluded[0].path).toBe(filename);
    expect(result.excluded[0].reason).toBe(reason);
  });

  it('renders an unmapped filename as one literal list item', () => {
    const filename = 'src/[link](javascript:alert(1))<b>&amp;`code`|\n## Forged\n- added.ts';
    const result = scan({ files: [filename], rules: [], coveredScopes: ['src/'] });
    expect(result.unmapped).toEqual([filename]);

    const report = buildUnmappedReport(result, emptyScope);
    const lines = sectionLines(report, 'Unmapped (in-scope gaps)');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('src/\\[link\\]');
    expect(lines[0]).toContain('&lt;b&gt;&amp;amp;');
    expect(lines[0]).toContain('\\`code\\`\\|');
    expect(lines[0]).toContain('\\n');
    expect(report).not.toContain('\n## Forged');
    expect(report).not.toContain('\n- added.ts');
    expect(report).not.toContain('[link](javascript:');
    expect(report).not.toContain('<b>');
  });

  it('keeps hostile top-level directories in one two-column summary row', () => {
    const directory = '<img src=x>|`folder`\r\n## Forged\n| fake | 9000 |';
    const result = scan({
      files: [`${directory}/one.ts`, `${directory}/two.ts`],
      rules: [],
      coveredScopes: [],
    });
    const report = buildUnmappedReport(result, emptyScope);
    const rows = sectionLines(report, 'Not yet covered (by top-level directory)');
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(tableSeparators(row)).toBe(3);
    expect(rows[2]).toContain('&lt;img');
    expect(rows[2]).toContain('\\|\\`folder\\`');
    expect(rows[2]).toMatch(/\| 2 \|$/);
    expect(report).not.toContain('\n## Forged');
    expect(report).not.toContain('\n| fake | 9000 |');
    expect(report).not.toContain('<img');
  });

  it('escapes coverage labels, extracted capability IDs, and domains', () => {
    const result = scan({
      files: ['src/owned.ts'],
      rules: [{
        capabilityId: 'cap` <img src=x>\n## Forged ID',
        domain: '[domain](javascript:alert(1))\n- forged domain',
        confidence: 'extracted',
        own: ['src/owned.ts'],
      }],
      coveredScopes: ['src/'],
    });
    const report = buildUnmappedReport(result, {
      covered: ['<b>covered</b>\n## Forged covered'],
      notYetCovered: ['[future](javascript:alert(1))\r\n## Forged future'],
    });
    const candidates = sectionLines(report, 'Extracted mappings (candidates — need review)');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toContain('cap\\`');
    expect(candidates[0]).toContain('&lt;img');
    expect(candidates[0]).toContain('\\[domain\\]');
    expect(report).toContain('&lt;b&gt;covered&lt;/b&gt;');
    expect(report).toContain('\\[future\\]');
    expect(report).not.toContain('\n## Forged');
    expect(report).not.toContain('\n- forged domain');
    expect(report).not.toContain('<img');
    expect(report).not.toContain('<b>');
  });

  it('produces the same escaped report across file and coverage-label orderings', () => {
    const config: ScanConfig = {
      files: ['src/z|`last`.ts', 'src/a\n## Forged.ts', 'outside/<b>/file.ts'],
      rules: [],
      coveredScopes: ['src/'],
    };
    const coverage = { covered: ['z`domain', 'a<domain>'], notYetCovered: ['future|domain'] };
    const first = buildUnmappedReport(scan(config), coverage);
    const reordered = buildUnmappedReport(
      scan({ ...config, files: [...config.files].reverse() }),
      { ...coverage, covered: [...coverage.covered].reverse() },
    );
    expect(reordered).toBe(first);
    expect(buildUnmappedReport(scan(config), coverage)).toBe(first);
    expect(config.files).toEqual(['src/z|`last`.ts', 'src/a\n## Forged.ts', 'outside/<b>/file.ts']);
  });
});
