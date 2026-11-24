import { useRef, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Edit3,
  FileText,
  Layers,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import type { AppSettings, AuthorRecord, BookRecord } from '../types';
import { AuthorAvatar } from './AuthorAvatar';
import { ingestBookFile, reprofileBook, type IngestProgress } from '../services/agents/ingestionService';
import { deleteAuthorAndBooks, deleteBook, updateBookMetadata } from '../services/storage/db';
import { isLLMConfigured } from '../services/llm/llmClient';

interface LibraryViewProps {
  authors: AuthorRecord[];
  books: BookRecord[];
  settings: AppSettings;
  onRefreshLibrary: () => Promise<void>;
  onOpenSettings: () => void;
}

export function LibraryView({
  authors,
  books,
  settings,
  onRefreshLibrary,
  onOpenSettings,
}: LibraryViewProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<IngestProgress[]>([]);
  const [expandedAuthors, setExpandedAuthors] = useState<Record<string, boolean>>({});
  const [editingBook, setEditingBook] = useState<BookRecord | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editAuthor, setEditAuthor] = useState('');
  const [reprofilingId, setReprofilingId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const booksByAuthor = new Map<string, BookRecord[]>();
  for (const b of books) {
    const arr = booksByAuthor.get(b.authorId) ?? [];
    arr.push(b);
    booksByAuthor.set(b.authorId, arr);
  }

  const toggleAuthor = (id: string) => {
    setExpandedAuthors((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }));
  };

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    setBanner(null);

    for (const file of files) {
      setUploads((prev) => [
        ...prev.filter((u) => u.fileName !== file.name),
        { fileName: file.name, stage: 'parsing', percent: 2, message: 'Queued...' },
      ]);
      try {
        const res = await ingestBookFile(file, settings, (prog) => {
          setUploads((prev) =>
            prev.map((u) => (u.fileName === file.name ? prog : u)),
          );
        });
        if (res.warning) {
          setBanner(`"${res.book.title}" indexed, but AI profiling fell back to local keywords: ${res.warning}`);
        }
        await onRefreshLibrary();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setUploads((prev) =>
          prev.map((u) =>
            u.fileName === file.name
              ? { fileName: file.name, stage: 'error', percent: 100, message: msg }
              : u,
          ),
        );
      }
    }
  };

  const openEditModal = (book: BookRecord) => {
    const author = authors.find((a) => a.id === book.authorId);
    setEditingBook(book);
    setEditTitle(book.title);
    setEditAuthor(author?.name ?? book.originalAuthor);
  };

  const handleSaveMetadata = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBook) return;
    await updateBookMetadata(editingBook.id, editTitle, editAuthor);
    setEditingBook(null);
    await onRefreshLibrary();
  };

  const handleDeleteBook = async (book: BookRecord) => {
    await deleteBook(book.id);
    await onRefreshLibrary();
  };

  const handleDeleteAuthor = async (author: AuthorRecord) => {
    await deleteAuthorAndBooks(author.id);
    await onRefreshLibrary();
  };

  const handleReprofile = async (book: BookRecord, authorName: string) => {
    if (!isLLMConfigured(settings)) {
      onOpenSettings();
      return;
    }
    setReprofilingId(book.id);
    setBanner(null);
    try {
      await reprofileBook(book, authorName, settings);
      await onRefreshLibrary();
    } catch (err) {
      setBanner(`Failed to profile "${book.title}": ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setReprofilingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-5 pb-24 sm:pb-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif-editorial text-2xl font-bold tracking-tight">
            My Book Library
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Books are automatically normalized and grouped under unified Author Advisor personas.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1 font-medium">
            {authors.length} Author{authors.length === 1 ? '' : 's'}
          </span>
          <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1 font-medium">
            {books.length} Book{books.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {/* Upload Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handleFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={`cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition-all ${
          dragging
            ? 'border-amber-500 bg-amber-500/10'
            : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-amber-500/50'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".epub,.pdf"
          multiple
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = '';
          }}
          className="hidden"
        />
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/15 text-amber-500">
          <Upload className="h-5 w-5" />
        </div>
        <p className="text-sm font-semibold">
          Upload EPUB or PDF books
        </p>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          Drag & drop or tap to select files. Parsed 100% locally in your browser and stored in IndexedDB.
        </p>
        {!isLLMConfigured(settings) && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-[11px] font-medium text-amber-600 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5" />
            Tip: Add a Gemini key or Ollama in Settings for automatic AI topic & voice profiling.
          </p>
        )}
      </div>

      {banner && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-200">
          <span>{banner}</span>
          <button onClick={() => setBanner(null)} className="shrink-0 underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Active Upload Progress */}
      {uploads.length > 0 && (
        <div className="space-y-2">
          {uploads.map((u) => (
            <div
              key={u.fileName}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5"
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate font-medium">{u.fileName}</span>
                <span
                  className={
                    u.stage === 'error'
                      ? 'text-rose-500'
                      : u.stage === 'ready'
                        ? 'text-emerald-500'
                        : 'text-amber-500'
                  }
                >
                  {u.stage === 'ready' ? 'Done' : u.stage === 'error' ? 'Failed' : `${u.percent}%`}
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-elevated)]">
                <div
                  className={`h-full transition-all duration-300 ${
                    u.stage === 'error'
                      ? 'bg-rose-500'
                      : u.stage === 'ready'
                        ? 'bg-emerald-500'
                        : 'bg-amber-500'
                  }`}
                  style={{ width: `${u.percent}%` }}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-[var(--text-secondary)]">{u.message}</p>
            </div>
          ))}
        </div>
      )}

      {/* Author-Grouped Library */}
      {authors.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-10 text-center">
          <BookOpen className="mx-auto mb-3 h-8 w-8 text-[var(--text-secondary)] opacity-60" />
          <h3 className="text-base font-semibold">Your Council Table Is Empty</h3>
          <p className="mx-auto mt-1 max-w-md text-xs text-[var(--text-secondary)]">
            Upload one or more non-fiction, strategy, psychology, or craft books (.epub or .pdf) to summon their authors as personal advisors.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {authors.map((author) => {
            const authorBooks = booksByAuthor.get(author.id) ?? [];
            const isExpanded = expandedAuthors[author.id] ?? true;

            return (
              <div
                key={author.id}
                className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xs"
              >
                {/* Author Header */}
                <div className="flex items-start justify-between gap-3 p-4 sm:p-5">
                  <button
                    type="button"
                    onClick={() => toggleAuthor(author.id)}
                    className="flex flex-1 items-start gap-3.5 text-left"
                  >
                    <AuthorAvatar name={author.name} size="lg" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-semibold tracking-tight">
                          {author.name}
                        </h2>
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                          <Layers className="h-3 w-3" />
                          {authorBooks.length} {authorBooks.length === 1 ? 'Book' : 'Books'} Indexed
                        </span>
                      </div>
                      {author.toneSummary && (
                        <p className="mt-1 line-clamp-2 text-xs text-[var(--text-secondary)]">
                          Voice: {author.toneSummary}
                        </p>
                      )}
                    </div>
                    <span className="mt-1 text-[var(--text-secondary)]">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleDeleteAuthor(author)}
                    title={`Remove ${author.name} and all their books`}
                    className="rounded-lg p-2 text-[var(--text-secondary)] hover:bg-rose-500/10 hover:text-rose-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                {/* Books under this Author */}
                {isExpanded && (
                  <div className="space-y-3 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/25 p-4 sm:px-5">
                    {authorBooks.map((book) => {
                      const isHeuristic = book.profile?.summary?.includes('offline heuristic') ||
                        book.profile?.frameworks?.[0]?.description?.includes('connect Gemini');
                      return (
                        <div
                          key={book.id}
                          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <FileText className="h-4 w-4 shrink-0 text-amber-500" />
                                <h3 className="text-sm font-semibold">{book.title}</h3>
                                <span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] font-mono uppercase text-[var(--text-secondary)]">
                                  {book.fileType}
                                </span>
                                {book.status === 'ready' && !isHeuristic && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-300">
                                    <CheckCircle2 className="h-3 w-3" />
                                    AI Profiled
                                  </span>
                                )}
                                {isHeuristic && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-300">
                                    Keyword Index Only
                                  </span>
                                )}
                              </div>
                              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                                {book.totalChunks} chunks · {book.totalWords.toLocaleString()} words · Meta author: &ldquo;{book.originalAuthor}&rdquo;
                              </p>
                            </div>

                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => void handleReprofile(book, author.name)}
                                disabled={reprofilingId === book.id}
                                title="Generate / refresh AI topic & framework profile"
                                className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-subtle)] px-2.5 py-1 text-[11px] font-medium hover:border-amber-500/50 disabled:opacity-50"
                              >
                                {reprofilingId === book.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : isHeuristic ? (
                                  <Sparkles className="h-3 w-3 text-amber-500" />
                                ) : (
                                  <RefreshCw className="h-3 w-3" />
                                )}
                                {isHeuristic ? 'AI Profile' : 'Re-index'}
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditModal(book)}
                                title="Edit book title or author metadata"
                                className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeleteBook(book)}
                                title="Delete book"
                                className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-rose-500/10 hover:text-rose-500"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>

                          {book.profile && (
                            <div className="mt-3 space-y-2.5 border-t border-[var(--border-subtle)] pt-3">
                              <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                                {book.profile.summary}
                              </p>

                              {book.profile.frameworks.length > 0 && (
                                <div>
                                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                                    Indexed Frameworks & Concepts
                                  </div>
                                  <div className="flex flex-wrap gap-1.5">
                                    {book.profile.frameworks.map((fw, idx) => (
                                      <span
                                        key={idx}
                                        title={fw.description}
                                        className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 px-2 py-0.5 text-[11px]"
                                      >
                                        {fw.name}
                                      </span>
                                    ))}
                                  </div>
                                </div>
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
          })}
        </div>
      )}

      {/* Edit Book Metadata Modal */}
      {editingBook && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={(e) => void handleSaveMetadata(e)}
            className="w-full max-w-md space-y-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 shadow-2xl"
          >
            <h3 className="text-base font-semibold">Edit Book Metadata</h3>
            <p className="text-xs text-[var(--text-secondary)]">
              Updating the Author name automatically re-groups this book under the matching normalized Author Persona.
            </p>
            <div>
              <label className="mb-1 block text-xs font-medium">Book Title</label>
              <input
                type="text"
                required
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Author Name</label>
              <input
                type="text"
                required
                value={editAuthor}
                onChange={(e) => setEditAuthor(e.target.value)}
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingBook(null)}
                className="rounded-lg border border-[var(--border-subtle)] px-3.5 py-2 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-zinc-950 hover:bg-amber-400"
              >
                Save & Re-group
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
