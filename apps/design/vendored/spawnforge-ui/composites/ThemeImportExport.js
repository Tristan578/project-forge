'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useRef, useCallback, useEffect } from 'react';
import { validateCustomTheme } from '../utils/themeValidator';
import { saveCustomTheme, loadCustomTheme, listCustomThemes, deleteCustomTheme, } from '../utils/themeStorage';
import { Toast } from '../primitives/Toast';
import { Button } from '../primitives/Button';
import { Dialog } from '../primitives/Dialog';
import { cn } from '../utils/cn';
export function ThemeImportExport() {
    const [state, setState] = useState({ status: 'idle' });
    const [isPickerOpen, setIsPickerOpen] = useState(false);
    const [showExportDialog, setShowExportDialog] = useState(false);
    const [customThemes, setCustomThemes] = useState([]);
    const [selectedForExport, setSelectedForExport] = useState(null);
    const fileInputRef = useRef(null);
    const refreshThemeList = useCallback(async () => {
        const ids = await listCustomThemes();
        setCustomThemes(ids);
    }, []);
    // Load initial theme list
    useEffect(() => {
        refreshThemeList().catch(() => { });
    }, [refreshThemeList]);
    const handleFileChange = useCallback(async (e) => {
        const file = e.target.files?.[0];
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
        setIsPickerOpen(false);
        if (!file)
            return;
        // File size check BEFORE JSON.parse
        if (file.size > 50_000) {
            setState({ status: 'error', message: 'File is too large. Maximum allowed size is 50KB.' });
            return;
        }
        setState({ status: 'reading' });
        let parsed;
        try {
            const text = await file.text();
            parsed = JSON.parse(text);
        }
        catch {
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
            accentColor: typeof result.theme.tokens['--sf-accent'] === 'string'
                ? result.theme.tokens['--sf-accent']
                : '#3b82f6',
            bgColor: typeof result.theme.tokens['--sf-bg-surface'] === 'string'
                ? result.theme.tokens['--sf-bg-surface']
                : '#18181b',
        });
    }, [refreshThemeList]);
    const handleReplaceDuplicate = useCallback(async () => {
        if (state.status !== 'duplicate')
            return;
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
            if (existing?.name === name)
                await deleteCustomTheme(id);
        }
        const newId = crypto.randomUUID();
        await saveCustomTheme(newId, result.theme);
        await refreshThemeList();
        setState({
            status: 'success',
            name: result.theme.name,
            accentColor: typeof result.theme.tokens['--sf-accent'] === 'string'
                ? result.theme.tokens['--sf-accent']
                : '#3b82f6',
            bgColor: typeof result.theme.tokens['--sf-bg-surface'] === 'string'
                ? result.theme.tokens['--sf-bg-surface']
                : '#18181b',
        });
    }, [state, refreshThemeList]);
    const handleExport = useCallback(async (id) => {
        const theme = await loadCustomTheme(id);
        if (!theme)
            return;
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
    return (_jsxs("div", { className: cn('space-y-4 p-4'), children: [customThemes.length === 0 && state.status === 'idle' && (_jsxs("div", { className: cn('flex flex-col items-center gap-3 rounded-[var(--sf-radius-lg)]', 'border-2 border-dashed border-[var(--sf-border)] p-8 text-center'), children: [_jsx("p", { className: "text-[var(--sf-text-muted)] text-sm", children: "No custom themes yet." }), _jsx("p", { className: "text-[var(--sf-text-disabled)] text-xs", children: "Import a .json theme file to get started." })] })), state.status === 'reading' && _jsx(Toast, { variant: "info", message: "Reading file...", onDismiss: () => { } }), state.status === 'error' && (_jsx(Toast, { variant: "error", message: state.message, onDismiss: () => setState({ status: 'idle' }) })), state.status === 'success' && (_jsxs(_Fragment, { children: [_jsx(Toast, { variant: "success", message: `Theme '${state.name}' imported successfully.`, onDismiss: () => setState({ status: 'idle' }) }), _jsxs("div", { className: "flex items-center gap-2 rounded-[var(--sf-radius-md)] border border-[var(--sf-border)] p-3", children: [_jsx("div", { className: "h-8 w-8 rounded-full border border-[var(--sf-border)]", style: { background: state.accentColor }, "aria-label": `Accent color: ${state.accentColor}` }), _jsx("div", { className: "h-8 w-12 rounded border border-[var(--sf-border)]", style: { background: state.bgColor }, "aria-label": `Background: ${state.bgColor}` }), _jsx("span", { className: "text-[var(--sf-text-secondary)] text-sm", children: state.name })] })] })), _jsx(Dialog, { open: state.status === 'duplicate', onClose: () => setState({ status: 'idle' }), title: "Theme Already Exists", actions: _jsxs("div", { className: "flex gap-2 justify-end", children: [_jsx(Button, { variant: "outline", onClick: () => setState({ status: 'idle' }), children: "Cancel" }), _jsx(Button, { variant: "destructive", onClick: handleReplaceDuplicate, children: "Replace" })] }), children: state.status === 'duplicate' && (_jsxs("p", { className: "text-[var(--sf-text)] text-sm", children: ["A theme named ", _jsxs("strong", { children: ["'", state.name, "'"] }), " already exists. Replace it?"] })) }), _jsx(Dialog, { open: showExportDialog && selectedForExport !== null, onClose: () => setShowExportDialog(false), title: "Export Theme", actions: _jsxs("div", { className: "flex gap-2 justify-end", children: [_jsx(Button, { variant: "outline", onClick: () => setShowExportDialog(false), children: "Cancel" }), _jsx(Button, { onClick: () => {
                                if (selectedForExport)
                                    handleExport(selectedForExport).catch(() => { });
                            }, children: "Download" })] }), children: _jsx("p", { className: "text-[var(--sf-text)] text-sm", children: "Download this theme as a .json file to share or back it up." }) }), _jsxs("div", { className: "flex gap-2", children: [_jsx(Button, { onClick: () => {
                            setIsPickerOpen(true);
                            fileInputRef.current?.click();
                        }, disabled: isPickerOpen || state.status === 'reading', children: isPickerOpen ? 'Opening...' : 'Import .json' }), customThemes.length > 0 && (_jsx(Button, { variant: "outline", onClick: () => {
                            setSelectedForExport(customThemes[0] ?? null);
                            setShowExportDialog(true);
                        }, children: "Export" }))] }), _jsx("input", { ref: fileInputRef, type: "file", accept: ".json,application/json", className: "sr-only", "aria-hidden": "true", tabIndex: -1, onChange: handleFileChange })] }));
}
