import { useRef, useState } from 'react';
import {
  CheckCircle2,
  Cloud,
  Cpu,
  Download,
  Eye,
  EyeOff,
  Loader2,
  Moon,
  Sun,
  Monitor,
  Upload,
  X,
  AlertCircle,
} from 'lucide-react';
import type { AppSettings, LLMProvider, ThemeMode } from '../types';
import { GEMINI_MODELS, OLLAMA_SUGGESTED_MODELS } from '../services/storage/settings';
import { testLLMConnection } from '../services/llm/llmClient';
import {
  downloadBackupJson,
  exportLibraryBackup,
  importLibraryBackup,
} from '../services/storage/backup';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSaveSettings: (next: AppSettings) => void;
  onLibraryChanged: () => Promise<void>;
}

export function SettingsModal({
  isOpen,
  onClose,
  settings,
  onSaveSettings,
  onLibraryChanged,
}: SettingsModalProps) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const updateField = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    onSaveSettings(next);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    const res = await testLLMConnection(draft);
    setTestResult(res);
    setTesting(false);
  };

  const handleExport = async () => {
    try {
      setBackupStatus('Preparing JSON export...');
      const payload = await exportLibraryBackup(true);
      downloadBackupJson(payload);
      setBackupStatus(
        `Exported ${payload.authors.length} author(s), ${payload.books.length} book(s), ${payload.chunks.length} chunks.`,
      );
    } catch (err) {
      setBackupStatus(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setBackupStatus('Importing library backup...');
      const text = await file.text();
      const res = await importLibraryBackup(text, importMode);
      await onLibraryChanged();
      setBackupStatus(
        `Imported ${res.authorsImported} author(s), ${res.booksImported} book(s), ${res.chunksImported} chunks (${importMode}).`,
      );
    } catch (err) {
      setBackupStatus(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div className="w-full sm:max-w-xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/95 backdrop-blur-xs px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Council Settings</h2>
            <p className="text-xs text-[var(--text-secondary)]">
              Stored locally in your browser. Keys never leave your device except to call your chosen provider.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            aria-label="Close settings"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 p-5">
          {/* Provider Toggle */}
          <section className="space-y-3">
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              LLM Inference Provider
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              {(
                [
                  {
                    id: 'gemini',
                    title: 'Cloud (Gemini)',
                    subtitle: 'Google AI Studio free tier',
                    icon: Cloud,
                  },
                  {
                    id: 'ollama',
                    title: 'Local (Ollama)',
                    subtitle: 'Offline on your machine',
                    icon: Cpu,
                  },
                ] as const
              ).map((item) => {
                const Icon = item.icon;
                const active = draft.provider === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => updateField('provider', item.id as LLMProvider)}
                    className={`flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all ${
                      active
                        ? 'border-amber-500/70 bg-amber-500/10 ring-1 ring-amber-500/30'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 hover:border-amber-500/30'
                    }`}
                  >
                    <Icon
                      className={`mt-0.5 h-5 w-5 shrink-0 ${
                        active ? 'text-amber-500' : 'text-[var(--text-secondary)]'
                      }`}
                    />
                    <div>
                      <div className="text-sm font-medium">{item.title}</div>
                      <div className="text-xs text-[var(--text-secondary)]">{item.subtitle}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Gemini Config */}
          {draft.provider === 'gemini' ? (
            <section className="space-y-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/30 p-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium">
                  Google AI Studio API Key
                </label>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={draft.geminiApiKey}
                    onChange={(e) => updateField('geminiApiKey', e.target.value)}
                    placeholder="Paste your Gemini API key..."
                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 pr-10 text-sm focus:border-amber-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    aria-label={showKey ? 'Hide key' : 'Show key'}
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-[var(--text-secondary)]">
                  Saved only in browser <code>localStorage</code>. Automatic backoff/retry handles free-tier rate limits.
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium">Gemini Model</label>
                <select
                  value={
                    GEMINI_MODELS.some((m) => m.id === draft.geminiModel)
                      ? draft.geminiModel
                      : '__custom__'
                  }
                  onChange={(e) => {
                    if (e.target.value !== '__custom__') {
                      updateField('geminiModel', e.target.value);
                    }
                  }}
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
                >
                  {GEMINI_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} — {m.note}
                    </option>
                  ))}
                  <option value="__custom__">Custom model ID...</option>
                </select>
                <input
                  type="text"
                  value={draft.geminiModel}
                  onChange={(e) => updateField('geminiModel', e.target.value)}
                  placeholder="Model ID (e.g. gemini-4-hydrogen)"
                  className="mt-2 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-mono focus:border-amber-500 focus:outline-none"
                />
              </div>
            </section>
          ) : (
            <section className="space-y-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/30 p-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium">Ollama Endpoint</label>
                <input
                  type="url"
                  value={draft.ollamaUrl}
                  onChange={(e) => updateField('ollamaUrl', e.target.value)}
                  placeholder="http://localhost:11434"
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm font-mono focus:border-amber-500 focus:outline-none"
                />
                <p className="mt-1.5 text-[11px] text-[var(--text-secondary)]">
                  Start Ollama with <code>OLLAMA_ORIGINS="*"</code> if accessing from a hosted PWA.
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium">Ollama Model</label>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {OLLAMA_SUGGESTED_MODELS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => updateField('ollamaModel', m)}
                      className={`rounded-md border px-2.5 py-1 text-xs font-mono transition ${
                        draft.ollamaModel === m
                          ? 'border-amber-500 bg-amber-500/15 text-amber-500'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={draft.ollamaModel}
                  onChange={(e) => updateField('ollamaModel', e.target.value)}
                  placeholder="e.g. gemma3, llama3.2, qwen2.5:14b"
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm font-mono focus:border-amber-500 focus:outline-none"
                />
              </div>
            </section>
          )}

          {/* Connection test */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleTest}
              disabled={testing}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2 text-xs font-medium hover:border-amber-500/50 disabled:opacity-50"
            >
              {testing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 text-amber-500" />
              )}
              Test Provider Connection
            </button>
            {testResult && (
              <span
                className={`flex items-center gap-1.5 text-xs ${
                  testResult.ok ? 'text-emerald-500' : 'text-rose-500'
                }`}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="max-w-xs truncate" title={testResult.message}>
                  {testResult.message}
                </span>
              </span>
            )}
          </div>

          {/* Appearance */}
          <section className="space-y-2.5 border-t border-[var(--border-subtle)] pt-4">
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Appearance
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'dark', label: 'Dark', icon: Moon },
                  { id: 'light', label: 'Light', icon: Sun },
                  { id: 'system', label: 'System', icon: Monitor },
                ] as const
              ).map((t) => {
                const Icon = t.icon;
                const active = draft.theme === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => updateField('theme', t.id as ThemeMode)}
                    className={`flex items-center justify-center gap-2 rounded-lg border py-2 text-xs font-medium transition ${
                      active
                        ? 'border-amber-500/70 bg-amber-500/10 text-amber-500'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Backup & Sync */}
          <section className="space-y-3 border-t border-[var(--border-subtle)] pt-4">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Library Backup & Device Sync (JSON)
              </h3>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                Export your IndexedDB authors, book profiles, text chunks, and council history to transfer between phone and PC.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={handleExport}
                className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-zinc-950 hover:bg-amber-400"
              >
                <Download className="h-3.5 w-3.5" />
                Export Library JSON
              </button>

              <div className="inline-flex items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setImportMode('merge')}
                  className={`rounded-md px-2.5 py-1 ${
                    importMode === 'merge' ? 'bg-[var(--bg-surface)] font-medium shadow-xs' : 'text-[var(--text-secondary)]'
                  }`}
                >
                  Merge
                </button>
                <button
                  type="button"
                  onClick={() => setImportMode('replace')}
                  className={`rounded-md px-2.5 py-1 ${
                    importMode === 'replace' ? 'bg-[var(--bg-surface)] font-medium shadow-xs' : 'text-[var(--text-secondary)]'
                  }`}
                >
                  Replace
                </button>
              </div>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2 text-xs font-medium hover:border-amber-500/50"
              >
                <Upload className="h-3.5 w-3.5" />
                Import JSON
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleImportFile}
                className="hidden"
              />
            </div>

            {backupStatus && (
              <p className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 px-3 py-2 text-xs">
                {backupStatus}
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
