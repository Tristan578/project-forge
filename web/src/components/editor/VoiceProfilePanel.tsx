'use client';

import { useState, useCallback, useMemo } from 'react';
import { Mic, Plus, Trash2, Play, Users } from 'lucide-react';
import {
  useVoiceProfileStore,
  VOICE_PRESETS,
  type VoiceProfile,
} from '@/stores/voiceProfileStore';
import { useDialogueStore } from '@/stores/dialogueStore';

export function VoiceProfilePanel() {
  const profiles = useVoiceProfileStore((s) => s.profiles);
  const setProfile = useVoiceProfileStore((s) => s.setProfile);
  const removeProfile = useVoiceProfileStore((s) => s.removeProfile);
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  // Get all unique speakers from dialogue trees
  const dialogueSpeakers = useMemo(() => {
    const dialogueTrees = useDialogueStore.getState().dialogueTrees;
    const speakers = new Set<string>();
    for (const tree of Object.values(dialogueTrees)) {
      for (const node of tree.nodes) {
        if (node.type === 'text' && node.speaker) {
          speakers.add(node.speaker);
        }
      }
    }
    return Array.from(speakers).sort();
  }, []);

  // Speakers without profiles
  const unmappedSpeakers = useMemo(
    () => dialogueSpeakers.filter((s) => !profiles[s]),
    [dialogueSpeakers, profiles]
  );

  const profileList = useMemo(
    () => Object.values(profiles).sort((a, b) => a.speaker.localeCompare(b.speaker)),
    [profiles]
  );

  return (
    <div className="flex h-full flex-col bg-zinc-900 text-xs">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          <Users size={13} className="text-purple-400" />
          <span className="font-medium text-zinc-300">Voice Profiles</span>
          <span className="text-[10px] text-zinc-400">({profileList.length})</span>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="rounded p-0.5 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
          title="Add voice profile"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Add new profile form */}
      {showAdd && (
        <AddProfileForm
          unmappedSpeakers={unmappedSpeakers}
          onAdd={(profile) => {
            setProfile(profile);
            setShowAdd(false);
          }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {/* Profile list */}
      <div className="flex-1 overflow-y-auto">
        {profileList.length === 0 && !showAdd ? (
          <div className="flex flex-col items-center gap-2 px-3 py-8 text-zinc-400">
            <Mic size={20} />
            <span>No voice profiles</span>
            <span className="text-[10px]">Add profiles to ensure consistent character voices</span>
          </div>
        ) : (
          profileList.map((profile) => (
            <ProfileRow
              key={profile.speaker}
              profile={profile}
              isEditing={editingSpeaker === profile.speaker}
              onEdit={() =>
                setEditingSpeaker(
                  editingSpeaker === profile.speaker ? null : profile.speaker
                )
              }
              onSave={(updated) => {
                setProfile(updated);
                setEditingSpeaker(null);
              }}
              onDelete={() => {
                removeProfile(profile.speaker);
                if (editingSpeaker === profile.speaker) setEditingSpeaker(null);
              }}
            />
          ))
        )}
      </div>

      {/* Unmapped speakers hint */}
      {unmappedSpeakers.length > 0 && (
        <div className="border-t border-zinc-800 px-2 py-1.5">
          <span className="text-[10px] text-zinc-400">
            {unmappedSpeakers.length} speaker{unmappedSpeakers.length > 1 ? 's' : ''} without
            profiles: {unmappedSpeakers.slice(0, 3).join(', ')}
            {unmappedSpeakers.length > 3 ? '...' : ''}
          </span>
        </div>
      )}
    </div>
  );
}

function AddProfileForm({
  unmappedSpeakers,
  onAdd,
  onCancel,
}: {
  unmappedSpeakers: string[];
  onAdd: (profile: VoiceProfile) => void;
  onCancel: () => void;
}) {
  const [speaker, setSpeaker] = useState(unmappedSpeakers[0] ?? '');
  const [customSpeaker, setCustomSpeaker] = useState('');
  const [voiceIdx, setVoiceIdx] = useState(0);

  const effectiveSpeaker = speaker === '__custom__' ? customSpeaker.trim() : speaker;
  const canAdd = effectiveSpeaker.length > 0;

  const handleAdd = useCallback(() => {
    if (!canAdd) return;
    const voice = VOICE_PRESETS[voiceIdx] ?? VOICE_PRESETS[0];
    onAdd({
      speaker: effectiveSpeaker,
      voiceId: voice.id,
      voiceLabel: voice.label,
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0,
      updatedAt: Date.now(),
    });
  }, [canAdd, effectiveSpeaker, voiceIdx, onAdd]);

  return (
    <div className="border-b border-zinc-800 px-2 py-2 space-y-2">
      {/* Speaker selection */}
      {unmappedSpeakers.length > 0 ? (
        <select
          value={speaker}
          onChange={(e) => setSpeaker(e.target.value)}
          className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 outline-none"
        >
          {unmappedSpeakers.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
          <option value="__custom__">Custom name...</option>
        </select>
      ) : (
        <input
          type="text"
          value={customSpeaker}
          onChange={(e) => {
            setCustomSpeaker(e.target.value);
            setSpeaker('__custom__');
          }}
          placeholder="Speaker name"
          className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 outline-none placeholder:text-zinc-400"
        />
      )}

      {speaker === '__custom__' && unmappedSpeakers.length > 0 && (
        <input
          type="text"
          value={customSpeaker}
          onChange={(e) => setCustomSpeaker(e.target.value)}
          placeholder="Speaker name"
          className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 outline-none placeholder:text-zinc-400"
        />
      )}

      {/* Voice selection */}
      <select
        value={voiceIdx}
        onChange={(e) => setVoiceIdx(Number(e.target.value))}
        className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 outline-none"
      >
        {VOICE_PRESETS.map((v, i) => (
          <option key={v.id} value={i}>
            {v.label} ({v.gender}, {v.accent})
          </option>
        ))}
      </select>

      {/* Actions */}
      <div className="flex gap-1">
        <button
          onClick={onCancel}
          className="flex-1 rounded bg-zinc-800 px-2 py-1 text-zinc-400 hover:bg-zinc-700"
        >
          Cancel
        </button>
        <button
          onClick={handleAdd}
          disabled={!canAdd}
          className="flex-1 rounded bg-purple-600 px-2 py-1 text-white hover:bg-purple-500 disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function ProfileRow({
  profile,
  isEditing,
  onEdit,
  onSave,
  onDelete,
}: {
  profile: VoiceProfile;
  isEditing: boolean;
  onEdit: () => void;
  onSave: (updated: VoiceProfile) => void;
  onDelete: () => void;
}) {
  const [voiceIdx, setVoiceIdx] = useState(
    () => VOICE_PRESETS.findIndex((v) => v.id === profile.voiceId) ?? 0
  );
  const [stability, setStability] = useState(profile.stability);
  const [similarityBoost, setSimilarityBoost] = useState(profile.similarityBoost);
  const [style, setStyle] = useState(profile.style);

  const handleSave = useCallback(() => {
    const voice = VOICE_PRESETS[voiceIdx] ?? VOICE_PRESETS[0];
    onSave({
      ...profile,
      voiceId: voice.id,
      voiceLabel: voice.label,
      stability,
      similarityBoost,
      style,
      updatedAt: Date.now(),
    });
  }, [profile, voiceIdx, stability, similarityBoost, style, onSave]);

  return (
    <div className="border-b border-zinc-800">
      {/* Summary row */}
      <button
        onClick={onEdit}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-zinc-800"
      >
        <Mic size={11} className="text-purple-400" />
        <span className="flex-1 truncate font-medium text-zinc-300">{profile.speaker}</span>
        <span className="text-[10px] text-zinc-400">{profile.voiceLabel}</span>
      </button>

      {/* Edit panel */}
      {isEditing && (
        <div className="space-y-2 bg-zinc-800/50 px-2 py-2">
          {/* Voice select */}
          <div>
            <label className="mb-0.5 block text-[10px] text-zinc-400">Voice</label>
            <select
              value={voiceIdx}
              onChange={(e) => setVoiceIdx(Number(e.target.value))}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 outline-none"
            >
              {VOICE_PRESETS.map((v, i) => (
                <option key={v.id} value={i}>
                  {v.label} ({v.gender}, {v.accent})
                </option>
              ))}
            </select>
          </div>

          {/* Stability slider */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-zinc-400">Stability</label>
              <span className="text-[10px] text-zinc-400">{stability.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={stability}
              onChange={(e) => setStability(Number(e.target.value))}
              className="w-full"
            />
          </div>

          {/* Similarity boost slider */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-zinc-400">Similarity</label>
              <span className="text-[10px] text-zinc-400">{similarityBoost.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={similarityBoost}
              onChange={(e) => setSimilarityBoost(Number(e.target.value))}
              className="w-full"
            />
          </div>

          {/* Style slider */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-zinc-400">Style</label>
              <span className="text-[10px] text-zinc-400">{style.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={style}
              onChange={(e) => setStyle(Number(e.target.value))}
              className="w-full"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1">
            <button
              onClick={handleSave}
              className="flex-1 rounded bg-purple-600 px-2 py-1 text-white hover:bg-purple-500"
            >
              <Play size={10} className="mr-1 inline" />
              Save
            </button>
            <button
              onClick={onDelete}
              className="rounded bg-red-900/50 p-1 text-red-400 hover:bg-red-900"
              title="Delete profile"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
