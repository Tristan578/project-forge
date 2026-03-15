import { describe, it, expect } from 'vitest';
import { extractAssets } from './assetExtractor';

describe('assetExtractor', () => {
  it('should extract base64 data URLs from scene data', async () => {
    const sceneData = {
      entities: [
        {
          id: 'entity1',
          material: {
            baseColorTexture: 'data:image/png;base64,iVBORw0KGgo=',
          },
        },
      ],
    };

    const result = await extractAssets(sceneData);

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].relativePath).toMatch(/^assets\/textures\/.+\.png$/);
    expect(result.modifiedScene).not.toEqual(sceneData); // Should be modified
  });

  it('should deduplicate identical assets', async () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const sceneData = {
      entities: [
        { id: 'entity1', texture: dataUrl },
        { id: 'entity2', texture: dataUrl }, // Same asset
      ],
    };

    const result = await extractAssets(sceneData);

    // Should only extract once
    expect(result.assets).toHaveLength(1);
  });

  it('should handle scenes with no data URLs', async () => {
    const sceneData = {
      entities: [
        { id: 'entity1', name: 'Cube', position: [0, 0, 0] },
      ],
    };

    const result = await extractAssets(sceneData);

    expect(result.assets).toHaveLength(0);
    expect(result.modifiedScene).toEqual(sceneData);
  });

  it('should categorize assets by MIME type', async () => {
    const sceneData = {
      entities: [
        { texture: 'data:image/png;base64,iVBORw0KGgo=' },
        { audio: 'data:audio/mp3;base64,SUQzBAA=' },
      ],
    };

    const result = await extractAssets(sceneData);

    expect(result.assets).toHaveLength(2);
    expect(result.assets[0].relativePath).toMatch(/^assets\/textures\/.+\.png$/);
    expect(result.assets[1].relativePath).toMatch(/^assets\/audio\/.+\.mp3$/);
  });

  it('should handle null input gracefully', async () => {
    const result = await extractAssets(null);
    expect(result.assets).toHaveLength(0);
    expect(result.modifiedScene).toBeNull();
  });

  it('should handle primitive string input (not a data URL)', async () => {
    // A primitive string is not an object so walkAndExtract returns immediately
    const result = await extractAssets('just a plain string');
    expect(result.assets).toHaveLength(0);
  });

  it('should handle empty object input', async () => {
    const result = await extractAssets({});
    expect(result.assets).toHaveLength(0);
    expect(result.modifiedScene).toEqual({});
  });

  it('should handle arrays at the top level', async () => {
    const sceneData = [
      { texture: 'data:image/png;base64,iVBORw0KGgo=' },
      { name: 'no-asset-entity' },
    ];
    const result = await extractAssets(sceneData);
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].relativePath).toMatch(/^assets\/textures\/.+\.png$/);
  });

  it('should replace data URL value with relative path in the modified scene', async () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const sceneData = { texture: dataUrl };

    const result = await extractAssets(sceneData);

    const modified = result.modifiedScene as Record<string, unknown>;
    expect(modified.texture).toMatch(/^assets\/textures\//);
    expect(modified.texture).not.toBe(dataUrl);
  });

  it('should track original ref on extracted asset', async () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const sceneData = { texture: dataUrl };

    const result = await extractAssets(sceneData);

    expect(result.assets[0].originalRef).toBe(dataUrl);
  });

  it('should extract model assets into the models category', async () => {
    const sceneData = {
      model: 'data:model/gltf-binary;base64,Z2xURg==',
    };

    const result = await extractAssets(sceneData);

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].relativePath).toMatch(/^assets\/models\/.+\.glb$/);
  });

  it('should handle image/jpeg MIME type', async () => {
    const sceneData = {
      texture: 'data:image/jpeg;base64,/9j/4AA=',
    };
    const result = await extractAssets(sceneData);
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].relativePath).toMatch(/\.jpg$/);
  });

  it('should handle image/webp MIME type', async () => {
    // Use valid base64-padded data
    const sceneData = { texture: 'data:image/webp;base64,UklGRgAAAABXRUJQVlA4IAAAAA==' };
    const result = await extractAssets(sceneData);
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].relativePath).toMatch(/\.webp$/);
  });

  it('should handle audio/wav MIME type', async () => {
    // "UklGRg==" is valid base64 for "RIFF\x06\x00\x00\x00"
    const sceneData = { audio: 'data:audio/wav;base64,UklGRgAAAAA=' };
    const result = await extractAssets(sceneData);
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].relativePath).toMatch(/^assets\/audio\/.+\.wav$/);
  });

  it('should handle audio/ogg MIME type', async () => {
    const sceneData = { audio: 'data:audio/ogg;base64,T2dnUw==' };
    const result = await extractAssets(sceneData);
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].relativePath).toMatch(/^assets\/audio\/.+\.ogg$/);
  });

  it('should handle application/octet-stream with .bin extension', async () => {
    const sceneData = { data: 'data:application/octet-stream;base64,AAAA' };
    const result = await extractAssets(sceneData);
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].relativePath).toMatch(/^assets\/other\/.+\.bin$/);
  });

  it('should handle plain (non-base64) data URLs', async () => {
    const sceneData = {
      svgData: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    };
    const result = await extractAssets(sceneData);
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].relativePath).toMatch(/^assets\/textures\/.+\.svg$/);
  });

  it('should extract assets from deeply nested objects', async () => {
    const sceneData = {
      a: {
        b: {
          c: {
            texture: 'data:image/png;base64,iVBORw0KGgo=',
          },
        },
      },
    };
    const result = await extractAssets(sceneData);
    expect(result.assets).toHaveLength(1);
  });

  it('should not mutate the original sceneData', async () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const sceneData = { texture: dataUrl };

    await extractAssets(sceneData);

    // Original should be unchanged
    expect(sceneData.texture).toBe(dataUrl);
  });

  it('should produce a blob with the correct MIME type for textures', async () => {
    const sceneData = { texture: 'data:image/png;base64,iVBORw0KGgo=' };
    const result = await extractAssets(sceneData);
    expect(result.assets[0].blob.type).toBe('image/png');
  });

  it('should produce a blob with the correct MIME type for audio', async () => {
    const sceneData = { audio: 'data:audio/wav;base64,UklGRgAAAAA=' };
    const result = await extractAssets(sceneData);
    expect(result.assets[0].blob.type).toBe('audio/wav');
  });

  it('should handle multiple distinct assets in a single call', async () => {
    const sceneData = {
      entities: [
        { texture: 'data:image/png;base64,iVBORw0KGgo=' },
        { audio: 'data:audio/mp3;base64,SUQzBAA=' },
        { model: 'data:model/gltf-binary;base64,Z2xURg==' },
      ],
    };
    const result = await extractAssets(sceneData);
    expect(result.assets).toHaveLength(3);
    const categories = result.assets.map((a) => a.relativePath.split('/')[1]);
    expect(categories).toContain('textures');
    expect(categories).toContain('audio');
    expect(categories).toContain('models');
  });
});
