'use client';

import { useState, useCallback, type KeyboardEvent } from 'react';
import { Code2, Play, AlertCircle, CheckCircle, Clock, ChevronDown } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';

// Pre-built WGSL snippet templates for common effects.
const WGSL_TEMPLATES: Array<{ name: string; code: string }> = [
  {
    name: 'Passthrough',
    code: 'return base_color;',
  },
  {
    name: 'Color Tint',
    code: 'return base_color * user_color;',
  },
  {
    name: 'Wave Distortion',
    code: [
      'let freq = user_params_0.x;',
      'let speed = user_params_0.y;',
      'let wave = sin(uv.x * freq + time * speed) * 0.5 + 0.5;',
      'return vec4(base_color.rgb * wave, base_color.a);',
    ].join('\n'),
  },
  {
    name: 'Rim Light',
    code: [
      'let view_dir = normalize(vec3(0.0, 0.0, 1.0));',
      'let power = max(user_params_0.x, 0.1);',
      'let strength = user_params_0.y;',
      'let rim = pow(1.0 - abs(dot(world_normal, view_dir)), power);',
      'return vec4(base_color.rgb + user_color.rgb * rim * strength, base_color.a);',
    ].join('\n'),
  },
  {
    name: 'Grayscale',
    code: [
      'let luma = dot(base_color.rgb, vec3(0.299, 0.587, 0.114));',
      'let amount = user_params_0.x; // 0 = color, 1 = grayscale',
      'return vec4(mix(base_color.rgb, vec3(luma), amount), base_color.a);',
    ].join('\n'),
  },
  {
    name: 'Pulsing Glow',
    code: [
      'let speed = max(user_params_0.x, 0.1);',
      'let intensity = user_params_0.y;',
      'let pulse = 0.5 + 0.5 * sin(time * speed);',
      'let glow = user_color.rgb * pulse * intensity;',
      'return vec4(base_color.rgb + glow, base_color.a);',
    ].join('\n'),
  },
  {
    name: 'UV Scroll',
    code: [
      'let scroll_uv = uv + vec2(time * user_params_0.x, time * user_params_0.y);',
      'let pattern = fract(scroll_uv.x * 5.0) > 0.5;',
      'let tint = select(base_color.rgb, base_color.rgb * user_color.rgb, pattern);',
      'return vec4(tint, base_color.a);',
    ].join('\n'),
  },
  {
    name: 'Scanlines',
    code: [
      'let freq = max(user_params_0.x, 1.0);',
      'let strength = user_params_0.y;',
      'let scan = sin(world_pos.y * freq + time) * 0.5 + 0.5;',
      'let darkened = base_color.rgb * mix(1.0, scan, strength);',
      'return vec4(darkened, base_color.a);',
    ].join('\n'),
  },
];

interface CustomWgslEditorProps {
  className?: string;
}

export function CustomWgslEditor({ className = '' }: CustomWgslEditorProps) {
  const customWgslSource = useEditorStore((state) => state.customWgslSource);
  const updateCustomWgslSource = useEditorStore((state) => state.updateCustomWgslSource);

  const [localCode, setLocalCode] = useState(
    customWgslSource?.userCode ?? 'return base_color;'
  );
  const [localName, setLocalName] = useState(
    customWgslSource?.name ?? 'Custom WGSL'
  );
  const [showTemplates, setShowTemplates] = useState(false);

  // Sync local state when the engine reports a new source (e.g., after scene load).
  const [prevSource, setPrevSource] = useState(customWgslSource);
  if (prevSource !== customWgslSource && customWgslSource !== null) {
    setPrevSource(customWgslSource);
    setLocalCode(customWgslSource.userCode);
    setLocalName(customWgslSource.name);
  }

  const handleCompile = useCallback(() => {
    updateCustomWgslSource(localCode, localName);
  }, [updateCustomWgslSource, localCode, localName]);

  const handleTemplateSelect = useCallback((template: { name: string; code: string }) => {
    setLocalCode(template.code);
    setLocalName(template.name);
    setShowTemplates(false);
  }, []);

  // Auto-compile when user presses Ctrl+Enter / Cmd+Enter inside the textarea.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleCompile();
      }
    },
    [handleCompile]
  );

  const status = customWgslSource?.compileStatus ?? null;
  const compileError = customWgslSource?.compileError ?? null;

  // Indicate if local editor state differs from what was last compiled (code or name).
  const isDirty =
    customWgslSource === null ||
    localCode !== customWgslSource.userCode ||
    localName !== customWgslSource.name;

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {/* Header row */}
      <div className="flex items-center gap-2">
        <Code2 size={14} className="text-purple-400 flex-shrink-0" />
        <span className="text-xs font-medium text-gray-300">Custom WGSL Shader</span>
        <div className="ml-auto flex items-center gap-1">
          {/* Status indicator */}
          {status === 'ok' && !isDirty && (
            <span title="Compiled successfully"><CheckCircle size={12} className="text-green-400" /></span>
          )}
          {status === 'error' && (
            <span title={compileError ?? 'Error'}><AlertCircle size={12} className="text-red-400" /></span>
          )}
          {(status === 'pending' || isDirty) && (
            <span title="Pending compilation"><Clock size={12} className="text-yellow-400" /></span>
          )}
        </div>
      </div>

      {/* Shader name */}
      <input
        type="text"
        value={localName}
        onChange={(e) => setLocalName(e.target.value)}
        className="w-full px-2 py-1 text-xs bg-gray-800 border border-gray-600 rounded text-gray-200 focus:border-purple-500 focus:outline-none"
        placeholder="Shader name"
      />

      {/* Template selector */}
      <div className="relative">
        <button
          onClick={() => setShowTemplates((v) => !v)}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 transition-colors"
        >
          <ChevronDown size={12} className={showTemplates ? 'rotate-180' : ''} />
          Insert template
        </button>
        {showTemplates && (
          <div className="absolute top-6 left-0 z-50 w-48 bg-gray-800 border border-gray-600 rounded shadow-lg">
            {WGSL_TEMPLATES.map((tpl) => (
              <button
                key={tpl.name}
                onClick={() => handleTemplateSelect(tpl)}
                className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 transition-colors"
              >
                {tpl.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* WGSL code editor */}
      <textarea
        value={localCode}
        onChange={(e) => setLocalCode(e.target.value)}
        onKeyDown={handleKeyDown}
        className="w-full min-h-32 px-2 py-2 text-xs font-mono bg-gray-900 border border-gray-700 rounded text-green-300 placeholder-gray-600 focus:border-purple-500 focus:outline-none resize-y"
        placeholder="// WGSL function body&#10;// Inputs: base_color, world_pos, world_normal, uv,&#10;//         time, user_params_0..3, user_color&#10;// Must return: vec4<f32>&#10;return base_color;"
        spellCheck={false}
      />

      {/* Compile button */}
      <button
        onClick={handleCompile}
        className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-500 text-white rounded transition-colors"
        title="Compile (Ctrl+Enter)"
      >
        <Play size={11} />
        Compile Shader
      </button>

      {/* Error message */}
      {status === 'error' && compileError && (
        <div className="flex items-start gap-1.5 p-2 bg-red-950 border border-red-700 rounded text-xs text-red-300">
          <AlertCircle size={11} className="flex-shrink-0 mt-0.5" />
          <span className="font-mono break-all">{compileError}</span>
        </div>
      )}

      {/* Usage hint */}
      <p className="text-xs text-gray-600 leading-relaxed">
        WebGPU only. Ctrl+Enter to compile. Entities use this shader when{' '}
        <code className="text-gray-500">shaderType = &quot;custom_wgsl&quot;</code>.
      </p>
    </div>
  );
}
