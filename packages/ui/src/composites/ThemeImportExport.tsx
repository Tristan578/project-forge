'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { validateCustomTheme } from '../utils/themeValidator';
import {
  saveCustomTheme,
  loadCustomTheme,
  listCustomThemes,
  deleteCustomTheme,
} from '../utils/themeStorage';
import { Toast } from '../primitives/Toast';
import { Button } from '../primitives/Button';
import { Dialog } from '../primitives/Dialog';
import { cn } from '../utils/cn';

type ImportState =
  | { status: 'idle' }
  | { status: 'reading' }
  | { status: 'duplicate'; name: string; pendingJson: unknown }
  | { status: 'success'; name: string; accentColor: string; bgColor: string }
  | { status: 'error'; message: string };

export function ThemeImportExport() {
  const [state, setState] = useState<ImportState>({ status: 'idle' });
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [customThemes, setCustomThemes] = useState<string[]>([]);
  const [selectedForExport, setSelectedForExport] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshThemeList = useCallback(async () => {
    const ids = await listCustomThemes();
    setCustomThemes(ids);
  }, []);

  // Load initial theme list
  useEffect(() => {
    refreshThemeList().catch(() => {});
  }, [refreshThemeList]);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setIsPickerOpen(false);

      if (!file) return;

      // File size check BEFORE JSON.parse
      if (file.size > 50_000) {
        setState({ status: 'error', message: 'File is too large. Maximum allowed size is 50KB.' });
        return;
      }

      setState({ status: 'reading' });

      let parsed: unknown;
      try {
        const text = await file.text();
        parsed = JSON.parse(text);
      } catch {
        setState({
          status: 'error',
          message: 'Could not parse the file. Is it a valid .json file?',
        });
        return;
      }

      const result = validateCustomTheme(parsed, { byteSize: file.size });
      if (!result.ok) {
        setState({ status: 'error', message: `Invalid theme: ${result.error}` });
        return;
      }

      // Duplicate name detection
      const existingIds = await listCustomThemes();
      let foundDuplicate = false;
      for (const id of existingIds) {
        const existing = await loadCustomTheme(id);
        if (existing?.name === result.theme.name) {
          foundDuplicate = true;
          break;
        }
      }

      if (foundDuplicate) {
        setState({ status: 'duplicate', name: result.theme.name, pendingJson: parsed });
        return;
      }

      const id = crypto.randomUUID();
      await saveCustomTheme(id, result.theme);
      await refreshThemeList();

      setState({
        status: 'success',
        name: result.theme.name,
        accentColor:
          typeof result.theme.tokens['--sf-accent'] === 'string'
            ? result.theme.tokens['--sf-accent']
            : '#3b82f6',
        bgColor:
          typeof result.theme.tokens['--sf-bg-surface'] === 'string'
            ? result.theme.tokens['--sf-bg-surface']
            : '#18181b',
      });
    },
    [refreshThemeList],
  );

  const handleReplaceDuplicate = useCallback(async () => {
    if (state.status !== 'duplicate') return;
    const { name, pendingJson } = state;

    const result = validateCustomTheme(pendingJson);
    if (!result.ok) {
      setState({ status: 'error', message: result.error });
      return;
    }

    // Find and delete the old entry
    const existingIds = await listCustomThemes();
    for (const id of existingIds) {
      const existing = await loadCustomTheme(id);
      if (existing?.name === name) await deleteCustomTheme(id);
    }

    const newId = crypto.randomUUID();
    await saveCustomTheme(newId, result.theme);
    await refreshThemeList();

    setState({
      status: 'success',
      name: result.theme.name,
      accentColor:
        typeof result.theme.tokens['--sf-accent'] === 'string'
          ? result.theme.tokens['--sf-accent']
          : '#3b82f6',
      bgColor:
        typeof result.theme.tokens['--sf-bg-surface'] === 'string'
          ? result.theme.tokens['--sf-bg-surface']
          : '#18181b',
    });
  }, [state, refreshThemeList]);

  const handleExport = useCallback(async (id: string) => {
    const theme = await loadCustomTheme(id);
    if (!theme) return;
    const blob = new Blob([JSON.stringify(theme, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${theme.name.replace(/\s+/g, '-').toLowerCase()}.spawnforge-theme.json`;
    a.click();
    // Revoke immediately after click to prevent memory leak
    URL.revokeObjectURL(url);
    setShowExportDialog(false);
  }, []);

  return (
    <div className={cn('space-y-4 p-4')}>
      {/* Empty state */}
      {customThemes.length === 0 && state.status === 'idle' && (
        <div
          className={cn(
            'flex flex-col items-center gap-3 rounded-[var(--sf-radius-lg)]',
            'border-2 border-dashed border-[var(--sf-border)] p-8 text-center',
          )}
        >
          <p className="text-[var(--sf-text-muted)] text-sm">No custom themes yet.</p>
          <p className="text-[var(--sf-text-disabled)] text-xs">
            Import a .json theme file to get started.
          </p>
        </div>
      )}

      {/* Reading indicator */}
      {state.status === 'reading' && <Toast variant="info" message="Reading file..." onDismiss={() => {}} />}

      {/* Error toast */}
      {state.status === 'error' && (
        <Toast
          variant="error"
          message={state.message}
          onDismiss={() => setState({ status: 'idle' })}
        />
      )}

      {/* Success preview */}
      {state.status === 'success' && (
        <>
          <Toast
            variant="success"
            message={`Theme '${state.name}' imported successfully.`}
            onDismiss={() => setState({ status: 'idle' })}
          />
          <div className="flex items-center gap-2 rounded-[var(--sf-radius-md)] border border-[var(--sf-border)] p-3">
            <div
              className="h-8 w-8 rounded-full border border-[var(--sf-border)]"
              style={{ background: state.accentColor }}
              aria-label={`Accent color: ${state.accentColor}`}
            />
            <div
              className="h-8 w-12 rounded border border-[var(--sf-border)]"
              style={{ background: state.bgColor }}
              aria-label={`Background: ${state.bgColor}`}
            />
            <span className="text-[var(--sf-text-secondary)] text-sm">{state.name}</span>
          </div>
        </>
      )}

      {/* Duplicate name dialog */}
      <Dialog
        open={state.status === 'duplicate'}
        onClose={() => setState({ status: 'idle' })}
        title="Theme Already Exists"
        actions={
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setState({ status: 'idle' })}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleReplaceDuplicate}>
              Replace
            </Button>
          </div>
        }
      >
        {state.status === 'duplicate' && (
          <p className="text-[var(--sf-text)] text-sm">
            A theme named <strong>&apos;{state.name}&apos;</strong> already exists. Replace it?
          </p>
        )}
      </Dialog>

      {/* Export dialog */}
      <Dialog
        open={showExportDialog && selectedForExport !== null}
        onClose={() => setShowExportDialog(false)}
        title="Export Theme"
        actions={
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowExportDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (selectedForExport) handleExport(selectedForExport).catch(() => {});
              }}
            >
              Download
            </Button>
          </div>
        }
      >
        <p className="text-[var(--sf-text)] text-sm">
          Download this theme as a .json file to share or back it up.
        </p>
      </Dialog>

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          onClick={() => {
            setIsPickerOpen(true);
            fileInputRef.current?.click();
          }}
          disabled={isPickerOpen || state.status === 'reading'}
        >
          {isPickerOpen ? 'Opening...' : 'Import .json'}
        </Button>
        {customThemes.length > 0 && (
          <Button
            variant="outline"
            onClick={() => {
              setSelectedForExport(customThemes[0] ?? null);
              setShowExportDialog(true);
            }}
          >
            Export
          </Button>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={handleFileChange}
      />
    </div>
  );
}
