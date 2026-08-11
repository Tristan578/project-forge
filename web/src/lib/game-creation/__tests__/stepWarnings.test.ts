import { describe, it, expect } from 'vitest';
import { collectStepWarnings } from '../stepWarnings';

describe('collectStepWarnings', () => {
  it('reads the singular string form', () => {
    expect(
      collectStepWarnings({
        cameraMode: 'sideScroller',
        applied: true,
        warning: 'Camera set to sideScroller but nothing was given for it to follow.',
      }),
    ).toEqual(['Camera set to sideScroller but nothing was given for it to follow.']);
  });

  it('reads the plural array form', () => {
    // `verifyExecutor` already emits `warnings: string[]`. Normalizing both
    // spellings here is what lets the executors keep the contracts their own
    // tests were written against.
    expect(
      collectStepWarnings({ passed: false, warnings: ['Scene has no entities', 'No camera entity found in scene'] }),
    ).toEqual(['Scene has no entities', 'No camera entity found in scene']);
  });

  it('reads both when a step carries both', () => {
    expect(collectStepWarnings({ warning: 'one', warnings: ['two'] })).toEqual(['one', 'two']);
  });

  it('says nothing for a step that applied cleanly', () => {
    expect(collectStepWarnings({ cameraMode: 'topDown', applied: true })).toEqual([]);
    expect(collectStepWarnings(undefined)).toEqual([]);
  });

  it('drops blank notes rather than rendering an empty warning box', () => {
    expect(collectStepWarnings({ warning: '   ' })).toEqual([]);
    expect(collectStepWarnings({ warnings: ['', '  ', 'real'] })).toEqual(['real']);
  });

  it('trims and de-duplicates', () => {
    // Two executors reporting the same missing player should read as one problem.
    expect(collectStepWarnings({ warning: ' padded ', warnings: ['padded'] })).toEqual(['padded']);
  });

  it('ignores non-string entries instead of rendering them', () => {
    // `String(value)` here would put `[object Object]` in front of the user.
    expect(collectStepWarnings({ warning: { text: 'nope' } })).toEqual([]);
    expect(collectStepWarnings({ warnings: [42, null, 'kept', { a: 1 }] })).toEqual(['kept']);
  });

  it('ignores a `warnings` value that is not an array', () => {
    expect(collectStepWarnings({ warnings: 'not an array' })).toEqual([]);
  });

  it('ignores inherited keys', () => {
    // The note is rendered to the user; a `warning` off the prototype is not
    // something the step reported about itself.
    expect(collectStepWarnings(Object.create({ warning: 'inherited' }))).toEqual([]);
    expect(collectStepWarnings(Object.create({ warnings: ['inherited'] }))).toEqual([]);
  });

  it.each([[null], ['string'], [42], [[]]])('returns [] for the non-output value %s', (raw) => {
    expect(collectStepWarnings(raw as never)).toEqual([]);
  });
});
