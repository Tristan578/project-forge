/**
 * The manual completion-mode picker (idea.FR-1.OP-04, #9998).
 *
 * Drives the REAL editor store: the point of this control is that it writes
 * through the same `setCompletionMode` action the AI's `set_completion_mode`
 * tool calls, and that the Play gate then reads what it wrote. A mocked store
 * could only prove the component called something.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { CompletionModeSection } from '../CompletionModeSection';
import { useEditorStore } from '@/stores/editorStore';
import { validateWinnability } from '@/lib/playMode/winnabilityValidator';
import { axe } from 'jest-axe';

function resetScene() {
  useEditorStore.setState({
    sceneGraph: { nodes: {}, rootIds: [] },
    completionModeHistory: { past: [], future: [] },
    sceneModified: false,
    allGameComponents: {},
  });
}

describe('CompletionModeSection', () => {
  beforeEach(resetScene);
  afterEach(cleanup);

  it('is a labelled radio group listing the four modes with their consequences', () => {
    render(<CompletionModeSection />);

    const group = screen.getByRole('radiogroup', { name: 'Completion mode' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(['win', 'endless', 'sandbox', 'narrative']);
    // Each option carries its consequence as an accessible description, so a
    // screen-reader user hears what Play will do before choosing.
    expect(screen.getByRole('radio', { name: 'Sandbox' })).toHaveAccessibleDescription(
      'A toy or creative space with no goal. Play does not require a win condition.',
    );
    expect(screen.getByRole('radio', { name: 'Win' })).toHaveAccessibleDescription(
      'Goal-driven. Play requires at least one win condition the player can complete.',
    );
  });

  it('has no axe violations under the WCAG 2.1 A/AA rules the E2E audit gates on', async () => {
    // The picker renders OUTSIDE SceneSettings' a11y-deferred subtree, so the
    // E2E axe audit of the Inspector includes it. Catch a regression here first.
    // Color contrast is disabled there too (dark theme, tracked as PF-572).
    const { container } = render(<CompletionModeSection />);
    fireEvent.click(screen.getByRole('radio', { name: 'Sandbox' }));

    const results = await axe(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      rules: { 'color-contrast': { enabled: false } },
    });

    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    // Non-vacuous: the audit actually walked the radios.
    expect(results.passes.some((p) => p.nodes.some((n) => String(n.html).includes('type="radio"')))).toBe(true);
  });

  it('shows a legacy scene (no mode) as Win, the rule it plays by', () => {
    render(<CompletionModeSection />);

    expect(screen.getByRole('radio', { name: 'Win' })).toBeChecked();
    expect(screen.getByText(/not saved with this scene yet/i)).toBeInTheDocument();
  });

  it.each([
    ['Endless', 'endless'],
    ['Sandbox', 'sandbox'],
    ['Narrative', 'narrative'],
    ['Win', 'win'],
  ] as const)('choosing %s writes %s through the store action and announces it', (label, mode) => {
    if (mode === 'win') useEditorStore.getState().setCompletionMode('sandbox');
    render(<CompletionModeSection />);

    fireEvent.click(screen.getByRole('radio', { name: label }));

    expect(useEditorStore.getState().sceneGraph.completionMode).toBe(mode);
    expect(useEditorStore.getState().sceneModified).toBe(true);
    expect(screen.getByRole('radio', { name: label })).toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent(`Completion mode set to ${label}.`);
  });

  it('records an explicit Win when the default Win is clicked on a legacy scene', () => {
    // The radio is already checked, so no change event fires; the hint says
    // choosing a mode saves it, and this is the one choice that would not.
    render(<CompletionModeSection />);

    fireEvent.click(screen.getByRole('radio', { name: 'Win' }));

    expect(useEditorStore.getState().sceneGraph.completionMode).toBe('win');
    expect(useEditorStore.getState().completionModeHistory.past).toEqual([undefined]);
    expect(screen.queryByText(/not saved with this scene yet/i)).not.toBeInTheDocument();
  });

  it('does not record a second step when an ordinary choice is clicked', () => {
    render(<CompletionModeSection />);

    fireEvent.click(screen.getByRole('radio', { name: 'Sandbox' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Sandbox' }));

    expect(useEditorStore.getState().completionModeHistory.past).toEqual([undefined]);
  });

  it('lets a sandbox scene with no win condition pass the Play gate once chosen by hand', () => {
    render(<CompletionModeSection />);
    const before = useEditorStore.getState();
    expect(validateWinnability(before.sceneGraph, before.allGameComponents, before.sceneGraph.completionMode).winnable).toBe(false);

    fireEvent.click(screen.getByRole('radio', { name: 'Sandbox' }));

    const after = useEditorStore.getState();
    expect(validateWinnability(after.sceneGraph, after.allGameComponents, after.sceneGraph.completionMode).winnable).toBe(true);
  });

  it('undoes and redoes a change with its own buttons, disabled when there is nothing to step', () => {
    render(<CompletionModeSection />);
    const undo = screen.getByRole('button', { name: 'Undo completion mode change' });
    const redo = screen.getByRole('button', { name: 'Redo completion mode change' });
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: 'Endless' }));
    expect(undo).toBeEnabled();

    fireEvent.click(undo);
    expect(useEditorStore.getState().sceneGraph.completionMode).toBeUndefined();
    expect(screen.getByRole('radio', { name: 'Win' })).toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent('Completion mode change undone. Now Win.');
    expect(undo).toBeDisabled();
    expect(redo).toBeEnabled();

    fireEvent.click(redo);
    expect(useEditorStore.getState().sceneGraph.completionMode).toBe('endless');
    expect(screen.getByRole('radio', { name: 'Endless' })).toBeChecked();
  });

  it('reflects a change made elsewhere — the AI tool writes the same store field', () => {
    render(<CompletionModeSection />);

    // Same action the `set_completion_mode` chat handler calls.
    act(() => {
      useEditorStore.getState().setCompletionMode('narrative');
    });

    expect(screen.getByRole('radio', { name: 'Narrative' })).toBeChecked();
  });
});
