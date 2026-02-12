import type { AssetMetadata } from '@/stores/editorStore';

interface PackagedAsset {
  id: string;
  filename: string;
  data: ArrayBuffer;
  mimeType: string;
}

interface AssetPackage {
  assets: PackagedAsset[];
  manifest: Record<string, string>; // assetId → filename
  totalSize: number;
}

export function packageAssets(
  assets: Record<string, AssetMetadata & { data?: ArrayBuffer }>
): AssetPackage {
  const packaged: PackagedAsset[] = [];
  const manifest: Record<string, string> = {};
  let totalSize = 0;

  for (const [id, asset] of Object.entries(assets)) {
    if (!asset.data) continue;

    const ext = asset.name.split('.').pop() || 'bin';
    const filename = `${id}.${ext}`;

    packaged.push({
      id,
      filename,
      data: asset.data,
      mimeType: getMimeType(ext),
    });
    manifest[id] = filename;
    totalSize += asset.data.byteLength;
  }

  return { assets: packaged, manifest, totalSize };
}

function getMimeType(ext: string): string {
  const types: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    glb: 'model/gltf-binary', gltf: 'model/gltf+json',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac',
  };
  return types[ext.toLowerCase()] || 'application/octet-stream';
}
