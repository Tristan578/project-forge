/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { downloadBlob } from './exportEngine';

describe('exportEngine', () => {
  describe('downloadBlob', () => {
    let createObjectURLSpy: ReturnType<typeof vi.fn>;
    let revokeObjectURLSpy: ReturnType<typeof vi.fn>;
    let appendChildSpy: ReturnType<typeof vi.fn>;
    let removeChildSpy: ReturnType<typeof vi.fn>;
    let clickSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      // Mock URL.createObjectURL and URL.revokeObjectURL
      createObjectURLSpy = vi.fn(() => 'blob:mock-url') as ReturnType<typeof vi.fn>;
      revokeObjectURLSpy = vi.fn() as ReturnType<typeof vi.fn>;
      global.URL.createObjectURL = createObjectURLSpy as unknown as (obj: Blob | MediaSource) => string;
      global.URL.revokeObjectURL = revokeObjectURLSpy as unknown as (url: string) => void;

      // Mock document.body methods
      appendChildSpy = vi.spyOn(document.body, 'appendChild') as ReturnType<typeof vi.fn>;
      removeChildSpy = vi.spyOn(document.body, 'removeChild') as ReturnType<typeof vi.fn>;

      // Mock HTMLAnchorElement.click
      clickSpy = vi.fn() as ReturnType<typeof vi.fn>;
      HTMLAnchorElement.prototype.click = clickSpy as unknown as () => void;
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('creates object URL for blob', () => {
      const blob = new Blob(['test content'], { type: 'text/plain' });
      downloadBlob(blob, 'test.txt');

      expect(createObjectURLSpy).toHaveBeenCalledWith(blob);
    });

    it('creates anchor element with correct href', () => {
      const blob = new Blob(['test'], { type: 'text/plain' });
      downloadBlob(blob, 'test.txt');

      expect(appendChildSpy).toHaveBeenCalledTimes(1);
      const anchor = appendChildSpy.mock.calls[0][0] as HTMLAnchorElement;
      expect(anchor.tagName).toBe('A');
      expect(anchor.href).toBe('blob:mock-url');
    });

    it('sets download attribute to filename', () => {
      const blob = new Blob(['test'], { type: 'text/plain' });
      downloadBlob(blob, 'my-game.html');

      const anchor = appendChildSpy.mock.calls[0][0] as HTMLAnchorElement;
      expect(anchor.download).toBe('my-game.html');
    });

    it('appends anchor to document body', () => {
      const blob = new Blob(['test'], { type: 'text/plain' });
      downloadBlob(blob, 'test.txt');

      expect(appendChildSpy).toHaveBeenCalledTimes(1);
      const anchor = appendChildSpy.mock.calls[0][0];
      expect(anchor).toBeInstanceOf(HTMLAnchorElement);
    });

    it('triggers click on anchor', () => {
      const blob = new Blob(['test'], { type: 'text/plain' });
      downloadBlob(blob, 'test.txt');

      expect(clickSpy).toHaveBeenCalledTimes(1);
    });

    it('removes anchor from document body after click', () => {
      const blob = new Blob(['test'], { type: 'text/plain' });
      downloadBlob(blob, 'test.txt');

      expect(removeChildSpy).toHaveBeenCalledTimes(1);
      const removedAnchor = removeChildSpy.mock.calls[0][0];
      const addedAnchor = appendChildSpy.mock.calls[0][0];
      expect(removedAnchor).toBe(addedAnchor);
    });

    it('revokes object URL after download', () => {
      const blob = new Blob(['test'], { type: 'text/plain' });
      downloadBlob(blob, 'test.txt');

      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');
    });

    it('executes operations in correct order', () => {
      const blob = new Blob(['test'], { type: 'text/plain' });
      const callOrder: string[] = [];

      createObjectURLSpy.mockImplementation(() => {
        callOrder.push('createObjectURL');
        return 'blob:mock-url';
      });
      appendChildSpy.mockImplementation(() => {
        callOrder.push('appendChild');
        return undefined as unknown as Node;
      });
      clickSpy.mockImplementation(() => {
        callOrder.push('click');
      });
      removeChildSpy.mockImplementation(() => {
        callOrder.push('removeChild');
        return undefined as unknown as Node;
      });
      revokeObjectURLSpy.mockImplementation(() => {
        callOrder.push('revokeObjectURL');
      });

      downloadBlob(blob, 'test.txt');

      expect(callOrder).toEqual([
        'createObjectURL',
        'appendChild',
        'click',
        'removeChild',
        'revokeObjectURL',
      ]);
    });
  });
});
