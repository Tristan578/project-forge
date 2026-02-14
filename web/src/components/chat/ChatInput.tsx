'use client';

import { useState, useRef, useCallback } from 'react';
import { Send, Square, Paperclip, Mic, MicOff, Brain, Shield } from 'lucide-react';
import { useChatStore, type ChatModel } from '@/stores/chatStore';
import { EntityPicker } from './EntityPicker';

const MODEL_OPTIONS: { value: ChatModel; label: string }[] = [
  { value: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
];

export function ChatInput() {
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  const sendMessage = useChatStore((s) => s.sendMessage);
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const activeModel = useChatStore((s) => s.activeModel);
  const setModel = useChatStore((s) => s.setModel);
  const thinkingEnabled = useChatStore((s) => s.thinkingEnabled);
  const setThinkingEnabled = useChatStore((s) => s.setThinkingEnabled);
  const approvalMode = useChatStore((s) => s.approvalMode);
  const setApprovalMode = useChatStore((s) => s.setApprovalMode);
  const showEntityPicker = useChatStore((s) => s.showEntityPicker);
  const setShowEntityPicker = useChatStore((s) => s.setShowEntityPicker);
  const setEntityPickerFilter = useChatStore((s) => s.setEntityPickerFilter);
  const pendingEntityRefs = useChatStore((s) => s.pendingEntityRefs);
  const addEntityRef = useChatStore((s) => s.addEntityRef);
  const clearEntityRefs = useChatStore((s) => s.clearEntityRefs);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && images.length === 0) return;
    const refs = Object.keys(pendingEntityRefs).length > 0 ? { ...pendingEntityRefs } : undefined;
    sendMessage(trimmed, images.length > 0 ? images : undefined, refs);
    setText('');
    setImages([]);
    clearEntityRefs();
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [text, images, sendMessage, pendingEntityRefs, clearEntityRefs]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showEntityPicker) return; // EntityPicker handles arrow/enter/escape
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isStreaming) return;
      handleSend();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setText(value);

    // Auto-expand
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';

    // Detect @ for entity picker
    const cursorPos = el.selectionStart;
    const textBeforeCursor = value.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@(\w*)$/);
    if (atMatch) {
      setShowEntityPicker(true);
      setEntityPickerFilter(atMatch[1]);
    } else {
      setShowEntityPicker(false);
    }
  };

  const handleEntitySelect = useCallback((name: string, entityId: string) => {
    // Replace the @partial with @EntityName in the text
    const cursorPos = textareaRef.current?.selectionStart ?? text.length;
    const textBeforeCursor = text.slice(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf('@');
    if (atIndex >= 0) {
      const before = text.slice(0, atIndex);
      const after = text.slice(cursorPos);
      setText(before + '@' + name + ' ' + after);
    }
    addEntityRef('@' + name, entityId);
    setShowEntityPicker(false);
    textareaRef.current?.focus();
  }, [text, addEntityRef, setShowEntityPicker]);

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            setImages((prev) => [...prev, reader.result as string]);
          }
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setImages((prev) => [...prev, reader.result as string]);
        }
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const toggleVoice = () => {
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setText((prev: string) => prev + transcript);
    };

    recognition.onend = () => setIsRecording(false);
    recognition.onerror = () => setIsRecording(false);

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const entityRefChips = Object.entries(pendingEntityRefs);

  return (
    <div className="border-t border-zinc-700 bg-zinc-900">
      {/* Entity reference chips */}
      {entityRefChips.length > 0 && (
        <div className="flex flex-wrap gap-1 px-2 pt-2">
          {entityRefChips.map(([name, id]) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-full bg-purple-600/20 px-2 py-0.5 text-[10px] text-purple-300"
              title={`Entity ID: ${id}`}
            >
              {name}
              <button
                onClick={() => {
                  const refs = { ...pendingEntityRefs };
                  delete refs[name];
                  useChatStore.setState({ pendingEntityRefs: refs });
                }}
                className="text-purple-400 hover:text-purple-200"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Image previews */}
      {images.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto px-2 pt-2">
          {images.map((img, i) => (
            <div key={i} className="group relative flex-shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img} alt="Preview" className="h-12 w-12 rounded border border-zinc-700 object-cover" />
              <button
                onClick={() => removeImage(i)}
                className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-zinc-700 text-zinc-300 group-hover:flex"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input row with entity picker */}
      <div className="relative flex items-end gap-1.5 p-2">
        {showEntityPicker && (
          <EntityPicker
            onSelect={handleEntitySelect}
            onClose={() => setShowEntityPicker(false)}
          />
        )}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleTextareaChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Describe what you want... (@ to reference entities)"
          disabled={isStreaming}
          rows={1}
          className="flex-1 resize-none rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-600"
        />
        {isStreaming ? (
          <button
            onClick={stopStreaming}
            className="flex h-8 w-8 items-center justify-center rounded-md bg-red-600/20 text-red-400 hover:bg-red-600/30"
            title="Stop"
          >
            <Square size={14} />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!text.trim() && images.length === 0}
            className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 disabled:opacity-30 disabled:hover:bg-blue-600/20"
            title="Send"
          >
            <Send size={14} />
          </button>
        )}
      </div>

      {/* Bottom toolbar */}
      <div className="flex items-center gap-2 border-t border-zinc-800 px-2 py-1">
        <select
          value={activeModel}
          onChange={(e) => setModel(e.target.value as ChatModel)}
          className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400 outline-none"
        >
          {MODEL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <button
          onClick={() => setThinkingEnabled(!thinkingEnabled)}
          className={`flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] transition-colors ${
            thinkingEnabled
              ? 'bg-amber-600/20 text-amber-400'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
          title={thinkingEnabled ? 'Disable extended thinking' : 'Enable extended thinking'}
        >
          <Brain size={12} />
          <span>Think</span>
        </button>

        <button
          onClick={() => setApprovalMode(!approvalMode)}
          className={`flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] transition-colors ${
            approvalMode
              ? 'bg-amber-600/20 text-amber-400'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
          title={approvalMode ? 'Disable command preview' : 'Enable command preview — review AI actions before execution'}
        >
          <Shield size={12} />
          <span>Review</span>
        </button>

        <button
          onClick={() => fileInputRef.current?.click()}
          className="text-zinc-500 hover:text-zinc-300"
          title="Attach image"
        >
          <Paperclip size={13} />
        </button>

        <button
          onClick={toggleVoice}
          className={`${isRecording ? 'text-red-400 animate-pulse' : 'text-zinc-500 hover:text-zinc-300'}`}
          title={isRecording ? 'Stop recording' : 'Voice input'}
        >
          {isRecording ? <MicOff size={13} /> : <Mic size={13} />}
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>
    </div>
  );
}
