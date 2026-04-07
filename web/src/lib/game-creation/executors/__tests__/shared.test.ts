import { describe, it, expect } from 'vitest';
import { makeStepError, failResult, successResult } from '../shared';

describe('game-creation/executors/shared', () => {
  describe('makeStepError', () => {
    it('creates error with all fields', () => {
      const err = makeStepError('ERR_CODE', 'Internal msg', 'User msg', true, { extra: 1 });
      expect(err.code).toBe('ERR_CODE');
      expect(err.message).toBe('Internal msg');
      expect(err.userFacingMessage).toBe('User msg');
      expect(err.retryable).toBe(true);
      expect(err.details).toEqual({ extra: 1 });
    });

    it('defaults retryable to false', () => {
      const err = makeStepError('ERR', 'msg', 'user msg');
      expect(err.retryable).toBe(false);
    });

    it('defaults details to undefined', () => {
      const err = makeStepError('ERR', 'msg', 'user msg', false);
      expect(err.details).toBeUndefined();
    });
  });

  describe('failResult', () => {
    it('returns unsuccessful result with error', () => {
      const err = makeStepError('ERR', 'msg', 'user msg');
      const result = failResult(err);
      expect(result.success).toBe(false);
      expect(result.error).toBe(err);
    });
  });

  describe('successResult', () => {
    it('returns successful result with output', () => {
      const result = successResult({ key: 'value' });
      expect(result.success).toBe(true);
      expect(result.output).toEqual({ key: 'value' });
    });

    it('defaults output to empty object', () => {
      const result = successResult();
      expect(result.success).toBe(true);
      expect(result.output).toEqual({});
    });
  });
});
