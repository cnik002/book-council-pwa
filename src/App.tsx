import { useCallback, useEffect, useState } from 'react';
import {
  BookOpen,
  Library,
  MessageSquareText,
  Moon,
  Settings,
  Sun,
} from 'lucide-react';
import type {
  AppSettings,
  AuthorRecord,
  BookRecord,
  CouncilConversation,
} from './types';
import {
  deleteConversation,
  getAllAuthors,
  getAllBooks,
  getAllConversations,
  saveConversation,
} from './services/storage/db';
import { loadSettings, saveSettings } from './services/storage/settings';
import { AskCouncilView } from './components/AskCouncilView';
import { LibraryView } from './components/LibraryView';
import { SettingsModal } from './components/SettingsModal';

type ActiveTab = 'chat' | 'library';

export function App() {
  const [tab, setTab] = useState<ActiveTab>('chat');
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [authors, setAuthors] = useState<AuthorRecord[]>([]);
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [conversations, setConversations] = useState<CouncilConversation[]>([]);
  const [activeConversation, setActiveConversation] =
    useState<CouncilConversation | null>(null);

  const refreshLibrary = useCallback(async () => {
    const [a, b, convs] = await Promise.all([
      getAllAuthors(),
      getAllBooks(),
      getAllConversations(),
    ]);
    setAuthors(a);
    setBooks(b);
    setConversations(convs);
  }, []);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  // Apply dark/light theme class
  useEffect(() => {
    const root = document.documentElement;
    const apply = (isDark: boolean) => {
      root.classList.toggle('dark', isDark);
    };

    if (settings.theme === 'dark') {
      apply(true);
    } else if (settings.theme === 'light') {
      apply(false);
    } else {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      apply(mq.matches);
      const handler = (e: MediaQueryListEvent) => apply(e.matches);
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [settings.theme]);

  const handleSaveSettings = (next: AppSettings) => {
    setSettings(next);
    saveSettings(next);
  };

  const handleToggleQuickTheme = () => {
    const nextTheme = settings.theme === 'dark' ? 'light' : 'dark';
    handleSaveSettings({ ...settings, theme: nextTheme });
  };

  const handleSaveConversation = async (conv: CouncilConversation) => {
    await saveConversation(conv);
    const all = await getAllConversations();
    setConversations(all);
  };

  const handleDeleteConversation = async (id: string) => {
    await deleteConversation(id);
    if (activeConversation?.id === id) {
      setActiveConversation(null);
    }
    const all = await getAllConversations();
    setConversations(all);
  };

  return (
    <div className="flex h-dvh flex-col bg-[var(--bg-app)] text-[var(--text-primary)]">
      {/* Top App Header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-500 border border-amber-500/30">
            <BookOpen className="h-4 w-4" />
          </div>
          <div>
            <span className="font-serif-editorial text-base font-bold tracking-tight">
              Book Council
            </span>
            <span className="ml-2 hidden sm:inline text-xs text-[var(--text-secondary)]">
              Personal Author Advisory Board
            </span>
          </div>
        </div>

        {/* Desktop Nav Tabs */}
        <nav className="hidden sm:flex items-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 p-1">
          <button
            type="button"
            onClick={() => setTab('chat')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              tab === 'chat'
                ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <MessageSquareText className="h-3.5 w-3.5 text-amber-500" />
            Ask the Council
          </button>
          <button
            type="button"
            onClick={() => setTab('library')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              tab === 'library'
                ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Library className="h-3.5 w-3.5 text-amber-500" />
            My Library
            {books.length > 0 && (
              <span className="rounded-full bg-amber-500/15 px-1.5 py-0.2 text-[10px] font-semibold text-amber-600 dark:text-amber-300">
                {books.length}
              </span>
            )}
          </button>
        </nav>

        {/* Right Controls */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleToggleQuickTheme}
            className="rounded-lg p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            aria-label="Toggle theme"
            title="Toggle Dark / Light Mode"
          >
            {settings.theme === 'dark' ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 px-2.5 py-1.5 text-xs font-medium hover:border-amber-500/50"
            aria-label="Open Settings"
          >
            <Settings className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Settings</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'chat' ? (
          <AskCouncilView
            authors={authors}
            books={books}
            settings={settings}
            conversations={conversations}
            activeConversation={activeConversation}
            onSelectConversation={setActiveConversation}
            onSaveConversation={handleSaveConversation}
            onDeleteConversation={handleDeleteConversation}
            onOpenLibrary={() => setTab('library')}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        ) : (
          <LibraryView
            authors={authors}
            books={books}
            settings={settings}
            onRefreshLibrary={refreshLibrary}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}
      </main>

      {/* Mobile Bottom Tab Bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 flex sm:hidden border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]/95 backdrop-blur-xs">
        <button
          type="button"
          onClick={() => setTab('chat')}
          className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium ${
            tab === 'chat' ? 'text-amber-500' : 'text-[var(--text-secondary)]'
          }`}
        >
          <MessageSquareText className="h-4 w-4" />
          <span>Council</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('library')}
          className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium ${
            tab === 'library' ? 'text-amber-500' : 'text-[var(--text-secondary)]'
          }`}
        >
          <Library className="h-4 w-4" />
          <span>Library ({books.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-[var(--text-secondary)]"
        >
          <Settings className="h-4 w-4" />
          <span>Settings</span>
        </button>
      </nav>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onSaveSettings={handleSaveSettings}
        onLibraryChanged={refreshLibrary}
      />
    </div>
  );
}

export default App;
