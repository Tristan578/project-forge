'use client';

import { useCallback, useRef, memo, useState, useEffect } from 'react';
import { FolderOpen, Upload, Image as ImageIcon, Trash2, Box, Music, Palette, Sparkles, ChevronDown } from 'lucide-react';
import { useEditorStore, type AssetMetadata } from '@/stores/editorStore';
import { MaterialLibraryPanel } from './MaterialLibraryPanel';
import { GenerateModelDialog } from './GenerateModelDialog';
import { GenerateTextureDialog } from './GenerateTextureDialog';
import { GenerateSoundDialog } from './GenerateSoundDialog';
import { GenerateMusicDialog } from './GenerateMusicDialog';
import { GenerateSkyboxDialog } from './GenerateSkyboxDialog';

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data:...;base64, prefix
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AssetCard({ asset }: { asset: AssetMetadata }) {
  const placeAsset = useEditorStore((s) => s.placeAsset);
  const deleteAsset = useEditorStore((s) => s.deleteAsset);

  const icon = asset.kind === 'gltf_model' ? <Box size={20} /> : asset.kind === 'audio' ? <Music size={20} /> : <ImageIcon size={20} />;
  const canPlace = asset.kind === 'gltf_model';

  return (
    <div
      className={`group relative flex flex-col items-center gap-1 rounded border border-zinc-700 bg-zinc-800/50 p-2 hover:border-zinc-500 hover:bg-zinc-800 ${canPlace ? 'cursor-pointer' : ''}`}
      onClick={() => canPlace && placeAsset(asset.id)}
      title={canPlace ? `Click to place ${asset.name} in scene` : asset.name}
    >
      <button
        className="absolute right-1 top-1 hidden rounded p-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-red-400 group-hover:block"
        onClick={(e) => {
          e.stopPropagation();
          deleteAsset(asset.id);
        }}
        title="Delete asset"
      >
        <Trash2 size={12} />
      </button>
      <div className="flex h-8 w-8 items-center justify-center text-zinc-400">
        {icon}
      </div>
      <span className="max-w-full truncate text-[10px] text-zinc-400">{asset.name}</span>
      <span className="text-[9px] text-zinc-600">{formatFileSize(asset.fileSize)}</span>
    </div>
  );
}

type AssetPanelTab = 'assets' | 'materials';

export const AssetPanel = memo(function AssetPanel() {
  const [activeTab, setActiveTab] = useState<AssetPanelTab>('assets');
  const [showAiDropdown, setShowAiDropdown] = useState(false);
  const [generateModelOpen, setGenerateModelOpen] = useState(false);
  const [generateTextureOpen, setGenerateTextureOpen] = useState(false);
  const [generateSoundOpen, setGenerateSoundOpen] = useState(false);
  const [generateMusicOpen, setGenerateMusicOpen] = useState(false);
  const [generateSkyboxOpen, setGenerateSkyboxOpen] = useState(false);

  const assetRegistry = useEditorStore((s) => s.assetRegistry);
  const importGltf = useEditorStore((s) => s.importGltf);
  const loadTexture = useEditorStore((s) => s.loadTexture);
  const importAudio = useEditorStore((s) => s.importAudio);
  const primaryId = useEditorStore((s) => s.primaryId);
  const gltfInputRef = useRef<HTMLInputElement>(null);
  const textureInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const aiDropdownRef = useRef<HTMLDivElement>(null);

  const assets = Object.values(assetRegistry);

  const handleGltfImport = useCallback(async (files: FileList | null) => {
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.name.endsWith('.glb') && !file.name.endsWith('.gltf')) continue;
      const base64 = await fileToBase64(file);
      importGltf(base64, file.name);
    }
  }, [importGltf]);

  const handleTextureImport = useCallback(async (files: FileList | null) => {
    if (!files || !primaryId) return;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const base64 = await fileToBase64(file);
      loadTexture(base64, file.name, primaryId, 'base_color');
    }
  }, [loadTexture, primaryId]);

  const handleAudioImport = useCallback(async (files: FileList | null) => {
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (['mp3', 'ogg', 'wav', 'flac'].includes(ext ?? '')) {
        const base64 = await fileToBase64(file);
        importAudio(base64, file.name);
      }
    }
  }, [importAudio]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer.files;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext === 'glb' || ext === 'gltf') {
        const base64 = await fileToBase64(file);
        importGltf(base64, file.name);
      } else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext ?? '')) {
        if (primaryId) {
          const base64 = await fileToBase64(file);
          loadTexture(base64, file.name, primaryId, 'base_color');
        }
      } else if (['mp3', 'ogg', 'wav', 'flac'].includes(ext ?? '')) {
        const base64 = await fileToBase64(file);
        importAudio(base64, file.name);
      }
    }
  }, [importGltf, loadTexture, importAudio, primaryId]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // Close AI dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (aiDropdownRef.current && !aiDropdownRef.current.contains(e.target as Node)) {
        setShowAiDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div
      className="flex min-h-[140px] w-full flex-col border-t border-zinc-800 bg-zinc-900"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {/* Tab bar + import buttons */}
      <div className="flex items-center border-b border-zinc-800">
        <div className="flex flex-1">
          <button
            onClick={() => setActiveTab('assets')}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === 'assets'
                ? 'border-b-2 border-blue-400 text-zinc-300'
                : 'text-zinc-500 hover:text-zinc-400'
            }`}
          >
            <FolderOpen size={12} />
            Assets
          </button>
          <button
            onClick={() => setActiveTab('materials')}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === 'materials'
                ? 'border-b-2 border-purple-400 text-zinc-300'
                : 'text-zinc-500 hover:text-zinc-400'
            }`}
          >
            <Palette size={12} />
            Materials
          </button>
        </div>
        {activeTab === 'assets' && (
          <div className="flex gap-1 pr-2">
            {/* AI Generate dropdown */}
            <div className="relative" ref={aiDropdownRef}>
              <button
                className="flex items-center gap-1 rounded bg-purple-900/30 px-2 py-0.5 text-xs text-purple-400 hover:bg-purple-900/50"
                onClick={() => setShowAiDropdown(!showAiDropdown)}
                title="AI Generate"
              >
                <Sparkles size={14} />
                <ChevronDown size={10} />
              </button>
              {showAiDropdown && (
                <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded border border-zinc-700 bg-zinc-900 shadow-xl">
                  <button
                    onClick={() => { setGenerateModelOpen(true); setShowAiDropdown(false); }}
                    className="w-full px-3 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-800"
                  >
                    Generate 3D Model
                  </button>
                  <button
                    onClick={() => { setGenerateTextureOpen(true); setShowAiDropdown(false); }}
                    className="w-full px-3 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-800"
                  >
                    Generate Texture
                  </button>
                  <button
                    onClick={() => { setGenerateSoundOpen(true); setShowAiDropdown(false); }}
                    className="w-full px-3 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-800"
                  >
                    Generate Sound
                  </button>
                  <button
                    onClick={() => { setGenerateMusicOpen(true); setShowAiDropdown(false); }}
                    className="w-full px-3 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-800"
                  >
                    Generate Music
                  </button>
                  <button
                    onClick={() => { setGenerateSkyboxOpen(true); setShowAiDropdown(false); }}
                    className="w-full px-3 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-800"
                  >
                    Generate Skybox
                  </button>
                </div>
              )}
            </div>

            <button
              className="rounded px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              onClick={() => gltfInputRef.current?.click()}
              title="Import 3D model (.glb/.gltf)"
            >
              <Upload size={14} />
            </button>
            <button
              className="rounded px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              onClick={() => textureInputRef.current?.click()}
              title="Import texture (.png/.jpg)"
            >
              <ImageIcon size={14} />
            </button>
            <button
              className="rounded px-1.5 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              onClick={() => audioInputRef.current?.click()}
              title="Import audio (.mp3/.ogg/.wav)"
            >
              <Music size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Hidden file inputs */}
      <input
        ref={gltfInputRef}
        type="file"
        accept=".glb,.gltf"
        multiple
        className="hidden"
        onChange={(e) => handleGltfImport(e.target.files)}
      />
      <input
        ref={textureInputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.webp"
        multiple
        className="hidden"
        onChange={(e) => handleTextureImport(e.target.files)}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept=".mp3,.ogg,.wav,.flac"
        multiple
        className="hidden"
        onChange={(e) => handleAudioImport(e.target.files)}
      />

      {/* Tab content */}
      {activeTab === 'materials' ? (
        <div className="flex-1 overflow-y-auto">
          <MaterialLibraryPanel />
        </div>
      ) : (
        <>
          {assets.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-4">
              <div className="flex flex-col items-center gap-2 text-zinc-600">
                <FolderOpen size={20} />
                <span className="text-xs">Drop .glb, .png, or audio files here</span>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-1.5 overflow-y-auto p-2">
              {assets.map((asset) => (
                <AssetCard key={asset.id} asset={asset} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Generation dialogs */}
      <GenerateModelDialog isOpen={generateModelOpen} onClose={() => setGenerateModelOpen(false)} />
      {primaryId && (
        <>
          <GenerateTextureDialog isOpen={generateTextureOpen} onClose={() => setGenerateTextureOpen(false)} entityId={primaryId} />
          <GenerateSoundDialog isOpen={generateSoundOpen} onClose={() => setGenerateSoundOpen(false)} entityId={primaryId} />
          <GenerateMusicDialog isOpen={generateMusicOpen} onClose={() => setGenerateMusicOpen(false)} entityId={primaryId} />
        </>
      )}
      <GenerateSkyboxDialog isOpen={generateSkyboxOpen} onClose={() => setGenerateSkyboxOpen(false)} />
    </div>
  );
});
