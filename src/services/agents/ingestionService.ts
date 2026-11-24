import type { AppSettings, BookRecord, FileType } from '../../types';
import { chunkSections } from '../parsers/chunker';
import { parseEpubBuffer } from '../parsers/epubParser';
import { parsePdfBuffer } from '../parsers/pdfParser';
import {
  getChunksForBook,
  saveBookAndChunks,
  updateBookRecord,
  upsertAuthorForRawName,
} from '../storage/db';
import { generateBookProfile } from './bookProfiler';

export interface IngestProgress {
  fileName: string;
  stage: 'parsing' | 'chunking' | 'profiling' | 'ready' | 'error';
  percent: number;
  message: string;
}

function makeBookId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `book-${crypto.randomUUID()}`;
  }
  return `book-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function ingestBookFile(
  file: File,
  settings: AppSettings,
  onProgress?: (p: IngestProgress) => void,
): Promise<{ book: BookRecord; aiProfiled: boolean; warning?: string }> {
  const lower = file.name.toLowerCase();
  let fileType: FileType;
  if (lower.endsWith('.epub')) fileType = 'epub';
  else if (lower.endsWith('.pdf')) fileType = 'pdf';
  else throw new Error(`Unsupported file "${file.name}". Please upload .epub or .pdf files.`);

  const report = (
    stage: IngestProgress['stage'],
    percent: number,
    message: string,
  ) => onProgress?.({ fileName: file.name, stage, percent, message });

  report('parsing', 5, `Reading ${fileType.toUpperCase()} file...`);
  const buffer = await file.arrayBuffer();

  const parsed =
    fileType === 'epub'
      ? await parseEpubBuffer(buffer, file.name, (pct, msg) =>
          report('parsing', Math.round(pct * 0.55), msg),
        )
      : await parsePdfBuffer(buffer, file.name, (pct, msg) =>
          report('parsing', Math.round(pct * 0.55), msg),
        );

  report('chunking', 60, `Normalizing author "${parsed.author}" & indexing chunks...`);
  const authorRecord = await upsertAuthorForRawName(parsed.author);
  const bookId = makeBookId();
  const chunks = chunkSections(parsed.sections, bookId, authorRecord.id);

  if (chunks.length === 0) {
    throw new Error(`Could not extract usable text chunks from "${file.name}".`);
  }

  const now = Date.now();
  const initialBook: BookRecord = {
    id: bookId,
    authorId: authorRecord.id,
    title: parsed.title,
    originalAuthor: parsed.author,
    fileName: file.name,
    fileType,
    totalChunks: chunks.length,
    totalWords: parsed.totalWords,
    status: 'profiling',
    createdAt: now,
    updatedAt: now,
  };

  await saveBookAndChunks(initialBook, chunks);

  report('profiling', 78, `Profiling "${parsed.title}" topics & author voice...`);

  let aiProfiled = false;
  let warning: string | undefined;

  try {
    const { profile, aiGenerated } = await generateBookProfile(
      initialBook.title,
      authorRecord.name,
      chunks,
      settings,
    );
    aiProfiled = aiGenerated;
    const readyBook: BookRecord = {
      ...initialBook,
      profile,
      status: 'ready',
      updatedAt: Date.now(),
    };
    await updateBookRecord(readyBook);
    report(
      'ready',
      100,
      aiGenerated
        ? `Indexed & AI-profiled under ${authorRecord.name}`
        : `Indexed under ${authorRecord.name} (offline heuristic profile)`,
    );
    return { book: readyBook, aiProfiled };
  } catch (err) {
    // Keep book usable with heuristic profile even if LLM profiling hit a rate limit
    const { profile } = await generateBookProfile(
      initialBook.title,
      authorRecord.name,
      chunks,
      { ...settings, geminiApiKey: '', provider: 'gemini' },
    );
    warning = err instanceof Error ? err.message : String(err);
    const readyBook: BookRecord = {
      ...initialBook,
      profile,
      status: 'ready',
      errorMessage: `AI profiling skipped: ${warning}`,
      updatedAt: Date.now(),
    };
    await updateBookRecord(readyBook);
    report('ready', 100, `Indexed under ${authorRecord.name} (AI profile deferred)`);
    return { book: readyBook, aiProfiled: false, warning };
  }
}

export async function reprofileBook(
  book: BookRecord,
  authorName: string,
  settings: AppSettings,
): Promise<BookRecord> {
  const chunks = await getChunksForBook(book.id);
  const { profile } = await generateBookProfile(book.title, authorName, chunks, settings);
  const updated: BookRecord = {
    ...book,
    profile,
    status: 'ready',
    errorMessage: undefined,
    updatedAt: Date.now(),
  };
  await updateBookRecord(updated);
  return updated;
}
