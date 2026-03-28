import { describe, it, expect } from 'vitest';
import { escapeHtml, escapeScriptContent, validateCssColor } from './exportUtils';

describe('escapeHtml', () => {
  it('escapes ampersand', () => {
    expect(escapeHtml('A & B')).toBe('A &amp; B');
  });

  it('escapes less-than', () => {
    expect(escapeHtml('1 < 2')).toBe('1 &lt; 2');
  });

  it('escapes greater-than', () => {
    expect(escapeHtml('2 > 1')).toBe('2 &gt; 1');
  });

  it('escapes double quotes', () => {
    expect(escapeHtml('say "hello"')).toBe('say &quot;hello&quot;');
  });

  it('escapes single quotes', () => {
    expect(escapeHtml("it's fine")).toBe('it&#039;s fine');
  });

  it('escapes all special chars in a single string', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
    );
  });

  it('returns empty string unchanged', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('leaves already-escaped text as-is (double-escape is expected)', () => {
    // escapeHtml is not idempotent — the & in &amp; gets re-escaped
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });

  it('leaves plain text unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });
});

describe('escapeScriptContent', () => {
  it('escapes </script> to prevent early tag termination', () => {
    expect(escapeScriptContent('var x = "</script>";')).toBe('var x = "<\\/script>";');
  });

  it('escapes <!-- to prevent HTML comment interpretation', () => {
    expect(escapeScriptContent('<!-- comment -->')).toBe('\\x3C!-- comment -->');
  });

  it('handles nested </script> sequences', () => {
    const input = 'a = "</script><script>evil()</script>";';
    const result = escapeScriptContent(input);
    expect(result).not.toContain('</script>');
    expect(result).toContain('<\\/script>');
  });

  it('is case-insensitive for </script> (normalises to lowercase tag)', () => {
    // The replacement string is always '<\/script' (lowercase), regardless of original case
    expect(escapeScriptContent('</Script>')).toBe('<\\/script>');
    expect(escapeScriptContent('</SCRIPT>')).toBe('<\\/script>');
  });

  it('handles multiple occurrences', () => {
    const input = '<!-- a --> </script> <!-- b --> </script>';
    const result = escapeScriptContent(input);
    expect(result).not.toContain('<!--');
    expect(result).not.toContain('</script>');
    expect(result.match(/\\x3C!--/g)?.length).toBe(2);
    expect(result.match(/<\\\/script/g)?.length).toBe(2);
  });

  it('returns empty string unchanged', () => {
    expect(escapeScriptContent('')).toBe('');
  });

  it('leaves safe content unchanged', () => {
    const safe = 'var x = 1; console.log(x);';
    expect(escapeScriptContent(safe)).toBe(safe);
  });

  it('escapes </script> inside a JSON string value', () => {
    const json = JSON.stringify({ name: '</script><img onerror=alert(1)>' });
    const escaped = escapeScriptContent(json);
    expect(escaped).not.toContain('</script>');
  });
});

describe('validateCssColor', () => {
  describe('valid hex colors', () => {
    it('accepts 3-digit hex', () => {
      expect(validateCssColor('#abc')).toBe('#abc');
    });

    it('accepts 4-digit hex (CSS4 #rgba shorthand)', () => {
      expect(validateCssColor('#f00a')).toBe('#f00a');
    });

    it('accepts 6-digit hex', () => {
      expect(validateCssColor('#aabbcc')).toBe('#aabbcc');
    });

    it('accepts 8-digit hex (with alpha)', () => {
      expect(validateCssColor('#aabbccdd')).toBe('#aabbccdd');
    });

    it('accepts uppercase hex', () => {
      expect(validateCssColor('#FFFFFF')).toBe('#FFFFFF');
    });

    it('accepts mixed-case hex', () => {
      expect(validateCssColor('#1A2b3C')).toBe('#1A2b3C');
    });

    it('accepts #000000', () => {
      expect(validateCssColor('#000000')).toBe('#000000');
    });

    it('accepts #ffffff', () => {
      expect(validateCssColor('#ffffff')).toBe('#ffffff');
    });
  });

  describe('valid rgb/rgba colors', () => {
    it('accepts rgb()', () => {
      expect(validateCssColor('rgb(255, 128, 0)')).toBe('rgb(255, 128, 0)');
    });

    it('accepts rgba()', () => {
      expect(validateCssColor('rgba(255, 128, 0, 0.5)')).toBe('rgba(255, 128, 0, 0.5)');
    });

    it('accepts rgba() with integer alpha', () => {
      expect(validateCssColor('rgba(0, 0, 0, 1)')).toBe('rgba(0, 0, 0, 1)');
    });
  });

  describe('valid hsl/hsla colors', () => {
    it('accepts hsl()', () => {
      expect(validateCssColor('hsl(120, 50%, 50%)')).toBe('hsl(120, 50%, 50%)');
    });

    it('accepts hsla()', () => {
      expect(validateCssColor('hsla(120, 50%, 50%, 0.8)')).toBe('hsla(120, 50%, 50%, 0.8)');
    });
  });

  describe('invalid inputs fall back to #000000', () => {
    it('rejects CSS injection payload with semicolons', () => {
      expect(validateCssColor('red; } body { display: none')).toBe('#000000');
    });

    it('rejects script injection via </style>', () => {
      expect(validateCssColor('</style><script>alert(1)</script>')).toBe('#000000');
    });

    it('rejects plain color name', () => {
      expect(validateCssColor('red')).toBe('#000000');
    });

    it('rejects hex without hash', () => {
      expect(validateCssColor('ff0000')).toBe('#000000');
    });

    it('rejects empty string', () => {
      expect(validateCssColor('')).toBe('#000000');
    });

    it('rejects hex with too few digits', () => {
      expect(validateCssColor('#ab')).toBe('#000000');
    });

    it('rejects hex with invalid characters', () => {
      expect(validateCssColor('#xyz123')).toBe('#000000');
    });

    it('rejects arbitrary text', () => {
      expect(validateCssColor('not a color')).toBe('#000000');
    });

    it('rejects url() injection', () => {
      expect(validateCssColor('url(javascript:alert(1))')).toBe('#000000');
    });
  });
});
