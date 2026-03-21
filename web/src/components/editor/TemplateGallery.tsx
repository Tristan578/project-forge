'use client';

import { useState, useEffect, useRef } from 'react';
import { Gamepad2, Zap, Crosshair, Puzzle, Compass, X } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import { trackEvent, AnalyticsEvent } from '@/lib/analytics/posthog';
import type { TemplateRegistryEntry } from '@/data/templates';

interface TemplateGalleryProps {
  isOpen: boolean;
  onClose: () => void;
}

const ICON_MAP = {
  Gamepad2,
  Zap,
  Crosshair,
  Puzzle,
  Compass,
};

export function TemplateGallery({ isOpen, onClose }: TemplateGalleryProps) {
  const [templates, setTemplates] = useState<TemplateRegistryEntry[]>([]);
  const loadTemplate = useEditorStore((s) => s.loadTemplate);
  const newScene = useEditorStore((s) => s.newScene);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      import('@/data/templates').then(({ TEMPLATE_REGISTRY }) => {
        setTemplates(TEMPLATE_REGISTRY);
      });
    }
  }, [isOpen]);

  // Escape to close + focus trap
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusable = dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Auto-focus dialog on open
  useEffect(() => {
    if (isOpen) dialogRef.current?.focus();
  }, [isOpen]);

  const handleSelectTemplate = async (templateId: string | null) => {
    if (templateId === null) {
      // Blank project
      newScene();
      trackEvent(AnalyticsEvent.GAME_CREATED, { source: 'blank' });
    } else {
      // Load template
      await loadTemplate(templateId);
      trackEvent(AnalyticsEvent.TEMPLATE_USED, { templateId });
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-gallery-title"
        tabIndex={-1}
        className="mx-4 w-full max-w-4xl max-h-[90vh] overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 p-6 shadow-2xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 id="template-gallery-title" className="text-xl font-semibold text-zinc-100">Choose a Template</h2>
            <p className="text-sm text-zinc-400">Start with a pre-built game or a blank project</p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
            aria-label="Close template gallery"
          >
            <X size={20} />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Blank Project Card */}
          <TemplateCard
            id={null}
            name="Blank Project"
            description="Start from scratch with an empty scene"
            gradient="linear-gradient(135deg, #404040, #262626)"
            icon="Compass"
            accentColor="#606060"
            difficulty="beginner"
            entityCount={1}
            tags={['empty', 'custom']}
            onSelect={handleSelectTemplate}
          />

          {/* Template Cards */}
          {templates.map((entry) => (
            <TemplateCard
              key={entry.id}
              id={entry.id}
              name={entry.name}
              description={entry.description}
              gradient={entry.thumbnail.gradient}
              icon={entry.thumbnail.icon}
              accentColor={entry.thumbnail.accentColor}
              difficulty={entry.difficulty}
              entityCount={entry.entityCount}
              tags={entry.tags}
              onSelect={handleSelectTemplate}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface TemplateCardProps {
  id: string | null;
  name: string;
  description: string;
  gradient: string;
  icon: string;
  accentColor: string;
  difficulty: string;
  entityCount: number;
  tags: string[];
  onSelect: (id: string | null) => void;
}

function TemplateCard({
  id,
  name,
  description,
  gradient,
  icon,
  accentColor,
  difficulty,
  entityCount,
  tags,
  onSelect,
}: TemplateCardProps) {
  const IconComponent = ICON_MAP[icon as keyof typeof ICON_MAP] || Compass;

  return (
    <button
      onClick={() => onSelect(id)}
      className="group relative flex flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-800 text-left transition-all hover:scale-105 hover:border-zinc-600 hover:shadow-xl"
      style={{
        borderColor: accentColor + '40',
      }}
    >
      {/* Gradient header */}
      <div
        className="flex h-24 items-center justify-center"
        style={{ background: gradient }}
      >
        <IconComponent size={48} className="text-white drop-shadow-lg" />
      </div>

      {/* Content */}
      <div className="flex-1 p-4">
        <h3 className="mb-1 text-base font-semibold text-zinc-100">{name}</h3>
        <p className="mb-3 line-clamp-2 text-xs text-zinc-400">{description}</p>

        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <span className="rounded bg-zinc-700 px-2 py-0.5 capitalize">{difficulty}</span>
          <span>{entityCount} entities</span>
        </div>

        {/* Tags */}
        <div className="mt-2 flex flex-wrap gap-1">
          {tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded bg-zinc-700/50 px-1.5 py-0.5 text-xs text-zinc-400"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}
