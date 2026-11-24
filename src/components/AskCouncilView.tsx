import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  BookMarked,
  ChevronDown,
  ChevronUp,
  Compass,
  GitFork,
  History,
  Loader2,
  MessageSquarePlus,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {
  AppSettings,
  AuthorRecord,
  BookRecord,
  CouncilConversation,
  CouncilMessage,
  PipelineProgress,
} from '../types';
import { AuthorAvatar } from './AuthorAvatar';
import { runBookCouncilPipeline } from '../services/agents/councilOrchestrator';
import { isLLMConfigured } from '../services/llm/llmClient';

interface AskCouncilViewProps {
  authors: AuthorRecord[];
  books: BookRecord[];
  settings: AppSettings;
  conversations: CouncilConversation[];
  activeConversation: CouncilConversation | null;
  onSelectConversation: (conv: CouncilConversation | null) => void;
  onSaveConversation: (conv: CouncilConversation) => Promise<void>;
  onDeleteConversation: (id: string) => Promise<void>;
  onOpenLibrary: () => void;
  onOpenSettings: () => void;
}

const SAMPLE_PROMPTS = [
  'I want to re-engage an old mentor I have not spoken to in 18 months without sounding transactional. How should I phrase the first message?',
  'I keep breaking my morning deep-work routine whenever urgent Slack messages arrive. Help me redesign my system.',
  'My co-founder and I disagree on whether to chase a big enterprise contract or stay focused on self-serve users.',
];

function makeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function AskCouncilView({
  authors,
  books,
  settings,
  conversations,
  activeConversation,
  onSelectConversation,
  onSaveConversation,
  onDeleteConversation,
  onOpenLibrary,
  onOpenSettings,
}: AskCouncilViewProps) {
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [expandedPerspectives, setExpandedPerspectives] = useState<Record<string, boolean>>({});
  const [showHistory, setShowHistory] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const messages = activeConversation?.messages ?? [];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, progress?.stage]);

  const togglePerspective = (key: string) => {
    setExpandedPerspectives((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSubmit = async (e?: React.FormEvent, overridePrompt?: string) => {
    e?.preventDefault();
    const query = (overridePrompt ?? input).trim();
    if (!query || running) return;

    if (!isLLMConfigured(settings)) {
      onOpenSettings();
      return;
    }

    if (books.length === 0) {
      onOpenLibrary();
      return;
    }

    setInput('');
    setRunning(true);
    setProgress({ stage: 'librarian', detail: 'Summoning the Librarian...' });

    const userMsg: CouncilMessage = {
      id: makeId('msg'),
      role: 'user',
      content: query,
      timestamp: Date.now(),
    };

    const conv: CouncilConversation = activeConversation
      ? {
          ...activeConversation,
          updatedAt: Date.now(),
          messages: [...activeConversation.messages, userMsg],
        }
      : {
          id: makeId('conv'),
          title: query.slice(0, 60) + (query.length > 60 ? '...' : ''),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [userMsg],
        };

    onSelectConversation(conv);
    await onSaveConversation(conv);

    try {
      const result = await runBookCouncilPipeline(query, settings, setProgress);
      const councilMsg: CouncilMessage = {
        id: makeId('msg'),
        role: 'council',
        content: result.synthesis.headline,
        timestamp: Date.now(),
        librarian: result.librarian,
        perspectives: result.perspectives,
        synthesis: result.synthesis,
      };
      const updatedConv: CouncilConversation = {
        ...conv,
        updatedAt: Date.now(),
        messages: [...conv.messages, councilMsg],
      };
      onSelectConversation(updatedConv);
      await onSaveConversation(updatedConv);
    } catch (err) {
      const errorMsg: CouncilMessage = {
        id: makeId('msg'),
        role: 'council',
        content: 'Council deliberation encountered an error.',
        timestamp: Date.now(),
        error: err instanceof Error ? err.message : String(err),
      };
      const updatedConv: CouncilConversation = {
        ...conv,
        updatedAt: Date.now(),
        messages: [...conv.messages, errorMsg],
      };
      onSelectConversation(updatedConv);
      await onSaveConversation(updatedConv);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  return (
    <div className="relative flex h-full flex-col">
      {/* Top Sub-bar */}
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/70 backdrop-blur-xs px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs font-medium hover:border-amber-500/50"
          >
            <History className="h-3.5 w-3.5 text-amber-500" />
            <span>Sessions ({conversations.length})</span>
          </button>
          <button
            type="button"
            onClick={() => onSelectConversation(null)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs font-medium hover:border-amber-500/50"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">New Session</span>
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <span className="hidden sm:inline">
            {authors.length} Advisor{authors.length === 1 ? '' : 's'} · {books.length} Book{books.length === 1 ? '' : 's'}
          </span>
          <span className="rounded-full bg-[var(--bg-elevated)] px-2.5 py-0.5 font-mono text-[11px]">
            {settings.provider === 'ollama' ? settings.ollamaModel : settings.geminiModel}
          </span>
        </div>
      </div>

      {/* History Drawer */}
      {showHistory && (
        <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
          <div className="mx-auto max-w-3xl space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Past Council Deliberations
            </div>
            {conversations.length === 0 ? (
              <p className="text-xs text-[var(--text-secondary)]">No saved sessions yet.</p>
            ) : (
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {conversations.map((c) => (
                  <div
                    key={c.id}
                    className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs transition ${
                      activeConversation?.id === c.id
                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-300 font-medium'
                        : 'hover:bg-[var(--bg-elevated)]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelectConversation(c);
                        setShowHistory(false);
                      }}
                      className="flex-1 truncate text-left"
                    >
                      {c.title}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDeleteConversation(c.id)}
                      className="text-[var(--text-secondary)] hover:text-rose-500"
                      aria-label="Delete session"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Chat Scroll Area */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {messages.length === 0 ? (
            <div className="space-y-6 py-6 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-500">
                <Sparkles className="h-7 w-7" />
              </div>
              <div className="space-y-2">
                <h1 className="font-serif-editorial text-2xl sm:text-3xl font-bold tracking-tight">
                  Consult Your Book Council
                </h1>
                <p className="mx-auto max-w-lg text-sm text-[var(--text-secondary)]">
                  Describe a real-life dilemma or paste an email/message thread. Your Librarian abstracts the strategic core and summons the most relevant authors from your library.
                </p>
              </div>

              {(books.length === 0 || !isLLMConfigured(settings)) && (
                <div className="mx-auto flex max-w-md flex-col sm:flex-row items-center justify-center gap-2.5 pt-2">
                  {books.length === 0 && (
                    <button
                      type="button"
                      onClick={onOpenLibrary}
                      className="w-full sm:w-auto rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-semibold text-zinc-950 hover:bg-amber-400"
                    >
                      1. Upload Books in Library
                    </button>
                  )}
                  {!isLLMConfigured(settings) && (
                    <button
                      type="button"
                      onClick={onOpenSettings}
                      className="w-full sm:w-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2.5 text-xs font-semibold hover:border-amber-500/50"
                    >
                      Configure Gemini / Ollama
                    </button>
                  )}
                </div>
              )}

              {books.length > 0 && (
                <div className="mx-auto max-w-xl space-y-2 pt-2 text-left">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                    Example Scenarios
                  </div>
                  {SAMPLE_PROMPTS.map((sample, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => void handleSubmit(undefined, sample)}
                      className="block w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-left text-xs leading-relaxed text-[var(--text-secondary)] transition hover:border-amber-500/50 hover:text-[var(--text-primary)]"
                    >
                      &ldquo;{sample}&rdquo;
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            messages.map((msg) => {
              if (msg.role === 'user') {
                return (
                  <div key={msg.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-xs border border-amber-500/30 bg-amber-500/12 px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">
                      {msg.content}
                    </div>
                  </div>
                );
              }

              if (msg.error) {
                return (
                  <div
                    key={msg.id}
                    className="flex items-start gap-3 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-xs text-rose-600 dark:text-rose-300"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div className="space-y-1">
                      <div className="font-semibold">Deliberation Interrupted</div>
                      <p>{msg.error}</p>
                    </div>
                  </div>
                );
              }

              return (
                <div key={msg.id} className="space-y-4">
                  {/* Librarian Intent & Consulted Authors */}
                  {msg.librarian && (
                    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                          <Compass className="h-3.5 w-3.5" />
                          Librarian Intent Analysis
                        </span>
                        <span className="rounded-full bg-[var(--bg-elevated)] px-2.5 py-0.5 text-[11px] text-[var(--text-secondary)]">
                          {msg.librarian.problemDomain}
                        </span>
                      </div>

                      <p className="text-sm font-medium leading-snug">
                        {msg.librarian.abstractedIntent}
                      </p>

                      {msg.librarian.selectedAuthors.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {msg.librarian.selectedAuthors.map((sel) => (
                            <div
                              key={sel.authorId}
                              title={sel.reason}
                              className="inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 py-1 pl-1 pr-3 text-xs"
                            >
                              <AuthorAvatar name={sel.authorName} size="sm" />
                              <div>
                                <span className="font-medium">{sel.authorName}</span>
                                <span className="ml-1.5 text-[10px] text-[var(--text-secondary)]">
                                  ({sel.bookTitles.length} {sel.bookTitles.length === 1 ? 'book' : 'books'})
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Moderator Final Synthesis */}
                  {msg.synthesis && (
                    <div className="rounded-2xl border border-amber-500/35 bg-[var(--bg-surface)] p-5 shadow-sm space-y-4">
                      <div className="flex items-center gap-2">
                        {msg.synthesis.consensusType === 'divergent' ? (
                          <GitFork className="h-4 w-4 text-sky-500" />
                        ) : msg.synthesis.consensusType === 'uncovered' ? (
                          <AlertCircle className="h-4 w-4 text-zinc-400" />
                        ) : (
                          <ShieldCheck className="h-4 w-4 text-emerald-500" />
                        )}
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                          {msg.synthesis.consensusType === 'divergent'
                            ? 'Council Verdict · Distinct Philosophies'
                            : msg.synthesis.consensusType === 'uncovered'
                              ? 'Council Verdict · Outside Current Library'
                              : 'Council Verdict · Unified Action Plan'}
                        </span>
                      </div>

                      <h2 className="font-serif-editorial text-xl font-bold tracking-tight">
                        {msg.synthesis.headline}
                      </h2>

                      {msg.synthesis.unifiedPlan && (
                        <div className="text-sm leading-relaxed whitespace-pre-wrap text-[var(--text-primary)]">
                          {msg.synthesis.unifiedPlan}
                        </div>
                      )}

                      {msg.synthesis.options && msg.synthesis.options.length > 0 && (
                        <div className="grid gap-3 sm:grid-cols-1">
                          {msg.synthesis.options.map((opt, idx) => (
                            <div
                              key={idx}
                              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/35 p-4 space-y-2"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <AuthorAvatar name={opt.authorName} size="sm" />
                                  <div>
                                    <div className="text-xs font-semibold">
                                      Option {idx + 1}: {opt.approachTitle}
                                    </div>
                                    <div className="text-[11px] text-[var(--text-secondary)]">
                                      {opt.authorName} · {opt.bookTitles.join(', ')}
                                    </div>
                                  </div>
                                </div>
                              </div>
                              <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                                {opt.summary}
                              </p>
                              {opt.actionSteps.length > 0 && (
                                <ul className="space-y-1 pl-4 text-xs list-disc">
                                  {opt.actionSteps.map((step, sIdx) => (
                                    <li key={sIdx}>{step}</li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {msg.synthesis.uncoveredExplanation && (
                        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                          {msg.synthesis.uncoveredExplanation}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Expandable Author Perspectives */}
                  {msg.perspectives && msg.perspectives.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] px-1">
                        Author Perspectives ({msg.perspectives.length})
                      </div>
                      {msg.perspectives.map((persp) => {
                        const key = `${msg.id}-${persp.authorId}`;
                        const isOpen = expandedPerspectives[key] ?? false;

                        return (
                          <div
                            key={persp.authorId}
                            className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
                          >
                            <button
                              type="button"
                              onClick={() => togglePerspective(key)}
                              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--bg-elevated)]/30"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <AuthorAvatar name={persp.authorName} size="sm" />
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-semibold">
                                      {persp.authorName}
                                    </span>
                                    {persp.abstained ? (
                                      <span className="rounded-full bg-zinc-500/15 px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">
                                        Abstained
                                      </span>
                                    ) : (
                                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-300">
                                        {persp.retrievedChunksCount} excerpts grounded
                                      </span>
                                    )}
                                  </div>
                                  <div className="truncate text-[11px] text-[var(--text-secondary)]">
                                    {persp.booksConsulted.join(' · ')}
                                  </div>
                                </div>
                              </div>
                              {isOpen ? (
                                <ChevronUp className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" />
                              ) : (
                                <ChevronDown className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" />
                              )}
                            </button>

                            {isOpen && (
                              <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/20 px-4 py-3.5 space-y-3">
                                {persp.abstained ? (
                                  <p className="text-xs italic text-[var(--text-secondary)]">
                                    {persp.abstentionReason ||
                                      'Abstained: none of the retrieved chapters directly cover this situation.'}
                                  </p>
                                ) : (
                                  <>
                                    <div className="text-sm leading-relaxed whitespace-pre-wrap">
                                      {persp.advice}
                                    </div>
                                    {persp.citations.length > 0 && (
                                      <div className="flex flex-wrap gap-1.5 pt-1">
                                        {persp.citations.map((c, idx) => (
                                          <span
                                            key={idx}
                                            className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-700 dark:text-amber-300"
                                          >
                                            <BookMarked className="h-3 w-3 shrink-0" />
                                            <span>
                                              {c.bookTitle} — {c.chapterOrConcept}
                                            </span>
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {/* Live Pipeline Progress */}
          {running && progress && (
            <div className="flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-[var(--bg-surface)] px-4 py-3.5 text-xs">
              <Loader2 className="h-4 w-4 animate-spin text-amber-500 shrink-0" />
              <div className="space-y-0.5">
                <div className="font-semibold capitalize">{progress.stage} Stage</div>
                <div className="text-[var(--text-secondary)]">{progress.detail}</div>
              </div>
            </div>
          )}

          <div ref={endRef} />
        </div>
      </div>

      {/* Composer */}
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]/90 backdrop-blur-xs p-3 sm:p-4 pb-20 sm:pb-4"
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            placeholder="Describe your dilemma or paste a message thread to ask your Book Council..."
            className="max-h-40 min-h-[48px] flex-1 resize-y rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 px-3.5 py-2.5 text-sm leading-relaxed focus:border-amber-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={running || !input.trim()}
            className="inline-flex h-12 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-4 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-40"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            <span className="hidden sm:inline">Ask Council</span>
          </button>
        </div>
      </form>
    </div>
  );
}
