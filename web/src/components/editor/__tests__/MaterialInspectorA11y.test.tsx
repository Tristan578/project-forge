/**
 * Accessible names for MaterialInspector's controls (#9677).
 *
 * Most of the inspector sits inside collapsed sections (Shader Effect, UV
 * Transform, Parallax, Clearcoat, Transmission), and texture slots only render
 * a <select> once a texture asset exists — so an E2E pass on a default scene
 * sees a fraction of it. This suite opens every section, supplies a texture
 * asset, a dissolve shader and a finite attenuation distance, and audits the
 * whole panel with axe.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@/test/utils/componentTestUtils';
import userEvent from '@testing-library/user-event';
import { MaterialInspector } from '@/components/editor/MaterialInspector';
import type { EditorState, MaterialData } from '@/stores/editorStore';
import {
  colourRangeSelect,
  expectEveryControlNamed,
  expectEveryLabelForResolves,
  axeViolations,
  formControls,
} from './formControlA11y';

vi.mock('@/stores/editorStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/stores/editorStore')>()),
  useEditorStore: vi.fn(),
}));

// The generation dialog and WGSL editor are separate surfaces; neither
// renders in the states used here, and stubbing keeps their imports out.
vi.mock('@/components/editor/GenerateTextureDialog', () => ({ GenerateTextureDialog: () => null }));
vi.mock('@/components/editor/CustomWgslEditor', () => ({ CustomWgslEditor: () => null }));

import { useEditorStore } from '@/stores/editorStore';

const { useEditorStore: actualEditorStore } =
  await vi.importActual<typeof import('@/stores/editorStore')>('@/stores/editorStore');

let fixture: EditorState = actualEditorStore.getInitialState();

function useFixture<T>(selector: (state: EditorState) => T): T {
  return selector(fixture);
}

const material: MaterialData = {
  baseColor: [0.8, 0.2, 0.2, 1],
  metallic: 0.5,
  perceptualRoughness: 0.5,
  reflectance: 0.5,
  emissive: [0, 0, 0, 1],
  emissiveExposureWeight: 0,
  alphaMode: 'opaque',
  alphaCutoff: 0.5,
  doubleSided: false,
  unlit: false,
  parallaxMappingMethod: 'relief',
  clearcoat: 0.3,
  clearcoatPerceptualRoughness: 0.4,
  attenuationDistance: 10,
  attenuationColor: [1, 1, 1],
};

function everythingOn(): EditorState {
  return {
    ...actualEditorStore.getInitialState(),
    primaryId: 'mesh-1',
    primaryMaterial: material,
    primaryShaderEffect: {
      shaderType: 'dissolve',
      customColor: [1, 0.5, 0.2, 1],
      noiseScale: 5,
      emissionStrength: 2,
      dissolveThreshold: 0.5,
      dissolveEdgeWidth: 0.05,
      scanLineFrequency: 50,
      scanLineSpeed: 2,
      scrollSpeed: [0.1, 0.2],
      distortionStrength: 0.1,
      toonBands: 4,
      fresnelPower: 3,
    },
    assetRegistry: {
      'tex-1': {
        id: 'tex-1',
        name: 'Bricks',
        kind: 'texture',
        fileSize: 1024,
        source: { type: 'upload', filename: 'bricks.png' },
      },
    },
    updateMaterial: vi.fn(),
    updateShaderEffect: vi.fn(),
    removeShaderEffect: vi.fn(),
    loadTexture: vi.fn(),
    removeTexture: vi.fn(),
  };
}

/** Render with every collapsed section opened. */
async function renderOpen(ui: React.ReactElement): Promise<HTMLElement> {
  const user = userEvent.setup();
  const { container } = render(ui);
  for (const toggle of screen.getAllByRole('button', { expanded: false })) {
    await user.click(toggle);
  }
  expect(screen.queryAllByRole('button', { expanded: false })).toEqual([]);
  return container;
}

beforeEach(() => {
  fixture = everythingOn();
  vi.mocked(useEditorStore).mockImplementation(useFixture);
});

afterEach(() => cleanup());

describe('MaterialInspector accessible names (#9677)', () => {
  it('gives every form control an accessible name with every section open', async () => {
    const container = await renderOpen(<MaterialInspector />);
    // Shader (select, colour, 4 sliders), preset, base colour/opacity/metallic/
    // roughness/reflectance/emissive/strength, 5 texture selects, 5 UV
    // sliders, parallax, clearcoat, transmission: well over 40 controls.
    expect(colourRangeSelect(container).length).toBeGreaterThanOrEqual(40);
    expectEveryControlNamed(container);
  });

  it('has zero axe violations with every section open', async () => {
    const container = await renderOpen(<MaterialInspector />);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('associates controls with their visible labels', async () => {
    await renderOpen(<MaterialInspector />);

    expect(screen.getByRole('combobox', { name: /^Type/ })).toHaveValue('dissolve');
    expect(screen.getByRole('combobox', { name: /^Preset/ })).toHaveValue('');
    expect(screen.getByRole('slider', { name: /^Metallic/ })).toHaveValue('0.5');
    expect(screen.getByRole('slider', { name: /^Reflectance/ })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /^Method/ })).toHaveValue('relief');
    expect(screen.getByRole('combobox', { name: /^Base Color/ })).toHaveValue('__none__');
    expect(screen.getByRole('checkbox', { name: /^Double Sided/ })).not.toBeChecked();
    expect(screen.getByRole('slider', { name: /^Atten\. Dist\./ })).toHaveValue('10');
    expect(screen.getByRole('checkbox', { name: 'Infinite attenuation distance' })).not.toBeChecked();

    // "Roughness" labels both the base slider and the clearcoat slider;
    // "Normal Map" labels two texture slots. Each pair must resolve to two
    // distinct controls, not one control twice.
    const roughness = screen.getAllByRole('slider', { name: /^Roughness/ });
    expect(roughness).toHaveLength(2);
    expect(roughness[0]).not.toBe(roughness[1]);
    const normalMaps = screen.getAllByRole('combobox', { name: /^Normal Map/ });
    expect(normalMaps).toHaveLength(2);
    expect(normalMaps[0]).not.toBe(normalMaps[1]);
  });

  it('points every label for= at a rendered control with every section open', async () => {
    const container = await renderOpen(<MaterialInspector />);
    // With a texture asset and a finite distance, the conditional controls
    // are present, so their labels carry a `for` resolving to them.
    expect(screen.getByText('Atten. Dist.').closest('label')?.control).toBe(
      screen.getByRole('slider', { name: /^Atten\. Dist\./ }),
    );
    expect(screen.getByText('Base Color').closest('label')?.control).toBe(
      screen.getByRole('combobox', { name: /^Base Color/ }),
    );
    expectEveryLabelForResolves(container);
  });

  it('points no label at a missing control with infinite attenuation and no texture assets', async () => {
    // The two states that remove a labelled control: "Infinite" hides the
    // distance slider, and with no texture asset each slot renders an Upload
    // button in place of its select.
    fixture = {
      ...everythingOn(),
      primaryMaterial: { ...material, attenuationDistance: null },
      assetRegistry: {},
    };
    const container = await renderOpen(<MaterialInspector />);

    expect(screen.getByRole('checkbox', { name: 'Infinite attenuation distance' })).toBeChecked();
    expect(screen.queryAllByRole('slider', { name: /^Atten\. Dist\./ })).toEqual([]);
    expect(screen.queryAllByRole('combobox', { name: /^(Base Color|Normal Map|Coat Map)/ })).toEqual([]);
    // The labels stay visible but stop pointing at the controls that left.
    expect(screen.getByText('Atten. Dist.').closest('label')).not.toHaveAttribute('for');
    expect(screen.getByText('Base Color').closest('label')).not.toHaveAttribute('for');
    expectEveryLabelForResolves(container);
    expectEveryControlNamed(container);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('names each texture slot Upload button after its slot', async () => {
    fixture = { ...everythingOn(), assetRegistry: {} };
    await renderOpen(<MaterialInspector />);

    // Nine slots; "Normal Map" is both a surface slot and a clearcoat slot.
    const slots = [
      'base color', 'normal map', 'metal/rough', 'emissive', 'occlusion',
      'depth map', 'coat map', 'rough map', 'normal map',
    ];
    expect(screen.getAllByRole('button', { name: /^Upload .+ texture$/ })).toHaveLength(slots.length);
    for (const slot of new Set(slots)) {
      expect(screen.getAllByRole('button', { name: `Upload ${slot} texture` })).toHaveLength(
        slots.filter((s) => s === slot).length,
      );
    }
    // A bare "Upload" nine times over tells a screen-reader user nothing
    // about which slot each button fills.
    expect(screen.queryAllByRole('button', { name: 'Upload' })).toEqual([]);
  });

  it('keeps label pairings unique when two inspectors are mounted', async () => {
    const container = await renderOpen(
      <>
        <MaterialInspector />
        <MaterialInspector />
      </>,
    );

    const ids = formControls(container).map((c) => c.id).filter((id) => id.length > 0);
    expect(ids.length).toBeGreaterThanOrEqual(80);
    expect(new Set(ids).size).toBe(ids.length);
    expect(within(container).getAllByRole('slider', { name: /^Metallic/ })).toHaveLength(2);
    expect(await axeViolations(container)).toEqual([]);
  });
});
