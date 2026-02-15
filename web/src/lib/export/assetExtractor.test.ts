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
});
