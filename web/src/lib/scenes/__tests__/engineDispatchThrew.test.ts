/**
 * The typed engine-throw error and the one reload sentence every surface
 * imports (#10202 review, M3 / m6).
 *
 * The class is what lets a `catch` tell "the engine threw and saving is
 * locked" apart from "a `localStorage` write was refused": only the first
 * carries the lockout claim. The sentence is pinned byte-for-byte because it
 * used to exist in four places with two punctuations.
 */
import { describe, it, expect } from 'vitest';
import {
  EngineDispatchThrewError,
  ENGINE_THREW_RELOAD_GUIDANCE,
  engineThrewMessage,
  sceneActionFailedMessage,
  sceneDispatchFailureMessage,
} from '../engineDispatchThrew';

describe('EngineDispatchThrewError', () => {
  it('is an Error that names the command and carries the original throw as its cause', () => {
    const cause = new Error('JsValue("serialize failed")');
    const error = new EngineDispatchThrewError('load_scene', 'bounded text', { cause });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(EngineDispatchThrewError);
    expect(error.name).toBe('EngineDispatchThrewError');
    expect(error.command).toBe('load_scene');
    expect(error.message).toBe('bounded text');
    expect(error.cause).toBe(cause);
  });

  it('is told apart from a plain Error by instanceof, which is what every catch narrows on', () => {
    expect(new Error('quota') instanceof EngineDispatchThrewError).toBe(false);
    expect(new DOMException('Quota exceeded', 'QuotaExceededError') instanceof EngineDispatchThrewError).toBe(false);
  });
});

describe('the reload guidance', () => {
  it('is one exact sentence', () => {
    expect(ENGINE_THREW_RELOAD_GUIDANCE).toBe(
      'Reload the editor before continuing — the viewport can no longer be trusted, and saving is locked to protect your stored scene.',
    );
  });

  it('engineThrewMessage names what failed, that the engine failed and how, then the guidance', () => {
    const error = new EngineDispatchThrewError('new_scene', 'JsValue("serialize failed")');
    expect(engineThrewMessage('A new scene could not be created', error)).toBe(
      `A new scene could not be created due to an engine error (JsValue("serialize failed")). ${ENGINE_THREW_RELOAD_GUIDANCE}`,
    );
  });
});

describe('sceneActionFailedMessage', () => {
  it('relays the message of a failure that was not the engine, and claims no lockout', () => {
    const message = sceneActionFailedMessage('The scene could not be opened', new DOMException('Quota exceeded', 'QuotaExceededError'));
    expect(message).toBe('The scene could not be opened: Quota exceeded');
    expect(message).not.toContain('engine error');
    expect(message).not.toContain('saving is locked');
  });

  it('stringifies a non-Error throw', () => {
    expect(sceneActionFailedMessage('The scene could not be opened', 'boom')).toBe('The scene could not be opened: boom');
  });

  it('reads the message off a throw that carries one without being an Error instance (jsdom\'s DOMException)', () => {
    const exceptionLike = Object.assign(Object.create(null) as object, { name: 'QuotaExceededError', message: 'Quota exceeded' });
    expect(sceneActionFailedMessage('The scene could not be opened', exceptionLike)).toBe('The scene could not be opened: Quota exceeded');
  });
});

describe('sceneDispatchFailureMessage (the UI surfaces\' one catch)', () => {
  it('gives the reload guidance for the typed engine throw', () => {
    const error = new EngineDispatchThrewError('load_scene', 'JsValue("serialize failed")');
    expect(sceneDispatchFailureMessage('The scene could not be opened', error)).toBe(
      engineThrewMessage('The scene could not be opened', error),
    );
  });

  it('reports anything else as a plain failure — never as an engine error, never with a lockout', () => {
    const message = sceneDispatchFailureMessage('The scene could not be opened', new Error('hydrate failed'));
    expect(message).toBe('The scene could not be opened: hydrate failed');
    expect(message).not.toContain(ENGINE_THREW_RELOAD_GUIDANCE);
    expect(message).not.toContain('engine error');
  });
});
