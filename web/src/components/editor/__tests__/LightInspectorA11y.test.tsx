/**
 * Accessible names for LightInspector's controls (#9677).
 *
 * The #9610 phone-width run reported LightInspector's colour input as an
 * unlabelled control; on desktop the same markup was hidden from axe by the
 * old `.dv-dockview` exclusion. Range, radius, spot angles and shadow biases
 * only render for some light types, so each type is rendered here and audited
 * with the axe engine the E2E suite uses.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { LightInspector } from '@/components/editor/LightInspector';
import type { EditorState, LightData } from '@/stores/editorStore';
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

function light(lightType: LightData['lightType'], shadowsEnabled = true): LightData {
  return {
    lightType,
    color: [1, 0.9, 0.8],
    intensity: 800,
    shadowsEnabled,
    shadowDepthBias: 0.02,
    shadowNormalBias: 1.8,
    range: 20,
    radius: 0.5,
    innerAngle: 0.3,
    outerAngle: 0.6,
  };
}

function useLight(data: LightData): void {
  fixture = {
    ...actualEditorStore.getInitialState(),
    primaryId: 'light-1',
    primaryLight: data,
    updateLight: vi.fn(),
  };
}

beforeEach(() => {
  vi.mocked(useEditorStore).mockImplementation(useFixture);
});

afterEach(() => cleanup());

describe('LightInspector accessible names (#9677)', () => {
  // Controls rendered per type with shadows on: colour, intensity, shadows
  // checkbox, two biases; point/spot add range + radius; spot adds two angles.
  it.each([
    ['point', 7],
    ['directional', 5],
    ['spot', 9],
  ] as const)('%s light: every control is named and axe reports nothing', async (lightType, expected) => {
    useLight(light(lightType));
    const { container } = render(<LightInspector />);

    expect(formControls(container)).toHaveLength(expected);
    expectEveryControlNamed(container);
    await expectNoAxeViolations(container);
  });

  it('renders every colour/range control the source declares, each under its visible label', () => {
    useLight(light('spot'));
    const { container } = render(<LightInspector />);

    // The spot light with shadows on is the superset; equality with the
    // static scan proves this suite is not auditing a convenient subset.
    expect(colourRangeSelect(container)).toHaveLength(staticControlCount('LightInspector.tsx'));

    expect(screen.getByLabelText('Color')).toHaveAttribute('type', 'color');
    expect(screen.getByRole('slider', { name: /^Intensity/ })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: /^Range/ })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: /^Radius/ })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: /^Inner Angle/ })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: /^Outer Angle/ })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: /^Depth Bias/ })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: /^Normal Bias/ })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Shadows' })).toBeChecked();
  });

  it('names a directional light intensity by its visible label', () => {
    useLight(light('directional'));
    render(<LightInspector />);
    expect(screen.getByRole('slider', { name: /^Illuminance/ })).toBeInTheDocument();
  });

  it('keeps label pairings unique when two inspectors are mounted', async () => {
    useLight(light('spot'));
    const { container } = render(
      <>
        <LightInspector />
        <LightInspector />
      </>,
    );

    const ids = formControls(container).map((c) => c.id);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(screen.getAllByLabelText('Color')).toHaveLength(2);
    await expectNoAxeViolations(container);
  });
});
