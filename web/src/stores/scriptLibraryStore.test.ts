/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadScripts,
  saveScript,
  updateScript,
  deleteScript,
  duplicateScript,
  searchScripts,
  getScript,
  exportScript,
  importScript,
} from './scriptLibraryStore';

describe('scriptLibraryStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loadScripts returns empty array when no data', () => {
    expect(loadScripts()).toEqual([]);
  });

  it('saveScript creates and persists a script', () => {
    const script = saveScript('Movement', 'function onUpdate() {}', 'Moves entity', ['movement']);
    expect(script.name).toBe('Movement');
    expect(script.source).toBe('function onUpdate() {}');
    expect(script.description).toBe('Moves entity');
    expect(script.tags).toEqual(['movement']);
    expect(script.id).toMatch(/^script_/);

    const loaded = loadScripts();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe(script.id);
  });

  it('updateScript modifies existing script', () => {
    const script = saveScript('Test', 'code');
    expect(updateScript(script.id, { name: 'Updated', source: 'new code' })).toBe(true);

    const updated = getScript(script.id);
    expect(updated?.name).toBe('Updated');
    expect(updated?.source).toBe('new code');
  });

  it('updateScript returns false for missing ID', () => {
    expect(updateScript('nonexistent', { name: 'X' })).toBe(false);
  });

  it('deleteScript removes a script', () => {
    const script = saveScript('ToDelete', 'code');
    expect(deleteScript(script.id)).toBe(true);
    expect(loadScripts()).toHaveLength(0);
  });

  it('deleteScript returns false for missing ID', () => {
    expect(deleteScript('nonexistent')).toBe(false);
  });

  it('duplicateScript creates a copy', () => {
    const original = saveScript('Original', 'code', 'desc', ['tag1']);
    const copy = duplicateScript(original.id);
    expect(copy).not.toBeNull();
    expect(copy!.name).toBe('Original (copy)');
    expect(copy!.source).toBe('code');
    expect(copy!.tags).toEqual(['tag1']);
    expect(copy!.id).not.toBe(original.id);
    expect(loadScripts()).toHaveLength(2);
  });

  it('duplicateScript returns null for missing ID', () => {
    expect(duplicateScript('nonexistent')).toBeNull();
  });

  it('searchScripts filters by name', () => {
    saveScript('PlayerMovement', 'code1');
    saveScript('EnemyAI', 'code2');
    const results = searchScripts('player');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('PlayerMovement');
  });

  it('searchScripts filters by tags', () => {
    saveScript('Script1', 'code', '', ['physics']);
    saveScript('Script2', 'code', '', ['audio']);
    const results = searchScripts('physics');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Script1');
  });

  it('searchScripts returns all when query is empty', () => {
    saveScript('A', 'code');
    saveScript('B', 'code');
    expect(searchScripts('')).toHaveLength(2);
  });

  it('getScript finds by ID', () => {
    const script = saveScript('FindMe', 'code');
    expect(getScript(script.id)?.name).toBe('FindMe');
  });

  it('getScript finds by name', () => {
    saveScript('FindByName', 'code');
    expect(getScript('FindByName')?.source).toBe('code');
  });

  it('exportScript returns JSON', () => {
    const script = saveScript('Export', 'code');
    const json = exportScript(script.id);
    expect(json).not.toBeNull();
    const parsed = JSON.parse(json!);
    expect(parsed.name).toBe('Export');
  });

  it('exportScript returns null for missing ID', () => {
    expect(exportScript('nonexistent')).toBeNull();
  });

  it('importScript creates from valid JSON', () => {
    const json = JSON.stringify({ name: 'Imported', source: 'code', tags: ['test'] });
    const imported = importScript(json);
    expect(imported).not.toBeNull();
    expect(imported!.name).toBe('Imported');
    expect(loadScripts()).toHaveLength(1);
  });

  it('importScript returns null for invalid JSON', () => {
    expect(importScript('not json')).toBeNull();
  });

  it('importScript returns null for missing required fields', () => {
    expect(importScript(JSON.stringify({ name: 'NoSource' }))).toBeNull();
  });
});
