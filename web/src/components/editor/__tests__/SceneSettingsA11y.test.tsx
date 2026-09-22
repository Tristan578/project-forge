/**
 * Accessible names for SceneSettings' controls (#9677).
 *
 * SceneSettings was exempted from the E2E axe audit through
 * `data-a11y-defer="scene-settings"` because its ~40 colour/range/select
 * controls sat beside `<label>`s that were never associated with them. With
 * the exemption gone, the E2E audit still sees only the controls that are
 * rendered by default — most live behind an effect's Enabled checkbox. This
 * suite switches every effect on (fog, skybox, bloom, chromatic aberration,
 * colour grading, sharpening, SSAO, depth of field, motion blur, mobile
 * controls) so axe audits the whole panel.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@/test/utils/componentTestUtils';
import { SceneSettings } from '@/components/editor/SceneSettings';
import type { EditorState } from '@/stores/editorStore';
import {
  colourRangeSelect,
  expectEveryControlNamed,
  expectNoAxeViolations,
  formControls,
  staticControlCount,
} from './formControlA11y';

vi.mock('@/stores/editorStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/stores/editorStore')>()),
  useEditorStore: vi.fn(),
}));

import { useEditorStore } from '@/stores/editorStore';

const { useEditorStore: actualEditorStore } =
  await vi.importActual<typeof import('@/stores/editorStore')>('@/stores/editorStore');

let fixture: EditorState = actualEditorStore.getInitialState();

function useFixture<T>(selector: (state: EditorState) => T): T {
  return selector(fixture);
}

/** Initial store state with every SceneSettings effect switched on. */
function everythingOn(): EditorState {
  const initial = actualEditorStore.getInitialState();
  return {
    ...initial,
    environment: { ...initial.environment, fogEnabled: true, skyboxPreset: 'studio' },
    postProcessing: {
      ...initial.postProcessing,
      bloom: { ...initial.postProcessing.bloom, enabled: true },
      chromaticAberration: { ...initial.postProcessing.chromaticAberration, enabled: true },
      colorGrading: { ...initial.postProcessing.colorGrading, enabled: true },
      sharpening: { ...initial.postProcessing.sharpening, enabled: true },
      ssao: { quality: 'medium' },
      depthOfField: {
        mode: 'gaussian',
        focalDistance: 10,
        apertureFStops: 5.6,
        sensorHeight: 0.024,
        maxCircleOfConfusionDiameter: 0.1,
        maxDepth: 100,
      },
      motionBlur: { shutterAngle: 0.5, samples: 4 },
    },
    mobileTouchConfig: {
      ...initial.mobileTouchConfig,
      enabled: true,
      joystick: initial.mobileTouchConfig.joystick ?? { position: 'bottom-left', size: 120, opacity: 0.7 },
    },
  };
}

// SSAO is WebGPU-only; SceneSettings gates it on navigator.gpu.
const hadGpu = 'gpu' in navigator;

beforeEach(() => {
  fixture = everythingOn();
  vi.mocked(useEditorStore).mockImplementation(useFixture);
  Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true });
});

afterEach(() => {
  cleanup();
  if (!hadGpu) delete (navigator as Navigator & { gpu?: unknown }).gpu;
});

describe('SceneSettings accessible names (#9677)', () => {
  it('renders every colour/range/select control the source declares', () => {
    const { container } = render(<SceneSettings />);
    // Equality with the static scan proves every such control in the file is
    // in the DOM for the assertions below, not a convenient subset.
    expect(colourRangeSelect(container)).toHaveLength(staticControlCount('SceneSettings.tsx'));
  });

  it('gives every form control an accessible name', () => {
    const { container } = render(<SceneSettings />);
    expect(formControls(container).length).toBeGreaterThanOrEqual(50);
    expectEveryControlNamed(container);
  });

  it('has zero axe violations with every effect enabled', async () => {
    const { container } = render(<SceneSettings />);
    await expectNoAxeViolations(container);
  });

  it('associates controls with their visible labels, scoped by section', () => {
    render(<SceneSettings />);

    // Labels repeat across sections ("Enabled" x9, "Intensity", "Mode"...),
    // so each section is a named group and the repeated label is unambiguous
    // within it.
    expect(screen.getAllByRole('checkbox', { name: 'Enabled' })).toHaveLength(9);
    const bloom = screen.getByRole('group', { name: /^Bloom/ });
    expect(within(bloom).getByRole('checkbox', { name: 'Enabled' })).toBeChecked();
    expect(within(bloom).getByRole('combobox', { name: /^Mode/ })).toHaveValue('energy_conserving');
    const fog = screen.getByRole('group', { name: /^Fog/ });
    expect(within(fog).getByLabelText(/^Color/)).toHaveAttribute('type', 'color');

    // Colour grading has a global Saturation and a per-tab Saturation; the
    // per-tab sliders sit in a group named after the pressed tab.
    const grading = screen.getByRole('group', { name: /^Color Grading/ });
    expect(within(grading).getByRole('button', { name: 'Midtones' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(grading).getByRole('button', { name: 'Shadows' })).toHaveAttribute('aria-pressed', 'false');
    const midtones = within(grading).getByRole('group', { name: 'Midtones' });
    expect(within(midtones).getByRole('slider', { name: /^Saturation/ })).toBeInTheDocument();
    expect(within(grading).getAllByRole('slider', { name: /^Saturation/ })).toHaveLength(2);

    expect(screen.getByRole('combobox', { name: /^Skybox/ })).toHaveValue('studio');
    expect(screen.getByRole('slider', { name: /^Exposure/ })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: /^Focal Dist/ })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Orientation' })).toBeInTheDocument();
  });

  it('keeps label pairings unique when two panels are mounted', async () => {
    const { container } = render(
      <>
        <SceneSettings />
        <SceneSettings />
      </>,
    );

    const ids = formControls(container).map((c) => c.id).filter((id) => id.length > 0);
    expect(ids.length).toBeGreaterThanOrEqual(100);
    expect(new Set(ids).size).toBe(ids.length);
    await expectNoAxeViolations(container);
  });
});
