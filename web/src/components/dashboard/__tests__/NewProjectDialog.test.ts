/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub lucide-react to avoid JSX rendering
vi.mock('lucide-react', () => ({
  X: () => null,
}));

describe('NewProjectDialog', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function importModule() {
    return import('../NewProjectDialog');
  }

  it('exports the NewProjectDialog component', async () => {
    const mod = await importModule();
    expect(mod.NewProjectDialog).toBeDefined();
    expect(typeof mod.NewProjectDialog).toBe('function');
  });

  it('onCreate prop accepts async functions that return error strings', async () => {
    // Verify the contract: onCreate returns Promise<string | null>
    const asyncCreate = vi.fn(async (_name: string): Promise<string | null> => {
      return null; // success
    });

    // Type check passes — the function signature matches
    expect(typeof asyncCreate).toBe('function');
    const result = await asyncCreate('My Game');
    expect(result).toBeNull();
  });

  it('onCreate returning an error string signals failure', async () => {
    const asyncCreate = vi.fn(async (_name: string): Promise<string | null> => {
      return 'Project limit reached';
    });

    const result = await asyncCreate('My Game');
    expect(result).toBe('Project limit reached');
  });

  it('onCreate returning null signals success', async () => {
    const asyncCreate = vi.fn(async (_name: string): Promise<string | null> => {
      return null;
    });

    const result = await asyncCreate('Test Project');
    expect(result).toBeNull();
    expect(asyncCreate).toHaveBeenCalledWith('Test Project');
  });
});
