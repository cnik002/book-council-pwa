import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  AuthorRecord,
  BookRecord,
  ChunkRecord,
  CouncilConversation,
} from '../../types';
import { normalizeAuthorName } from '../parsers/authorNormalizer';

interface BookCouncilDB extends DBSchema {
  authors: {
    key: string;
    value: AuthorRecord;
    indexes: { 'by-normalizedKey': string };
  };
  books: {
    key: string;
    value: BookRecord;
    indexes: { 'by-authorId': string };
  };
  chunks: {
    key: string;
    value: ChunkRecord;
    indexes: { 'by-bookId': string; 'by-authorId': string };
  };
  conversations: {
    key: string;
    value: CouncilConversation;
    indexes: { 'by-updatedAt': number };
  };
}

const DB_NAME = 'book-council-db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<BookCouncilDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<BookCouncilDB>> {
  if (!dbPromise) {
    dbPromise = openDB<BookCouncilDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('authors')) {
          const authorStore = db.createObjectStore('authors', { keyPath: 'id' });
          authorStore.createIndex('by-normalizedKey', 'normalizedKey');
        }
        if (!db.objectStoreNames.contains('books')) {
          const bookStore = db.createObjectStore('books', { keyPath: 'id' });
          bookStore.createIndex('by-authorId', 'authorId');
        }
        if (!db.objectStoreNames.contains('chunks')) {
          const chunkStore = db.createObjectStore('chunks', { keyPath: 'id' });
          chunkStore.createIndex('by-bookId', 'bookId');
          chunkStore.createIndex('by-authorId', 'authorId');
        }
        if (!db.objectStoreNames.contains('conversations')) {
          const convStore = db.createObjectStore('conversations', { keyPath: 'id' });
          convStore.createIndex('by-updatedAt', 'updatedAt');
        }
      },
    });
  }
  return dbPromise;
}

export async function resetDBCacheForTests(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
}

/**
 * Finds or creates a canonical AuthorRecord for a raw author name.
 */
export async function upsertAuthorForRawName(
  rawAuthor: string,
  toneSnippet?: string,
): Promise<AuthorRecord> {
  const db = await getDB();
  const norm = normalizeAuthorName(rawAuthor);
  const existingByKey = await db.getFromIndex('authors', 'by-normalizedKey', norm.normalizedKey);
  const existing = existingByKey ?? (await db.get('authors', norm.authorId));
  const now = Date.now();

  if (existing) {
    const aliases = Array.from(new Set([...existing.aliases, rawAuthor.trim()].filter(Boolean)));
    const updated: AuthorRecord = {
      ...existing,
      aliases,
      toneSummary: toneSnippet
        ? existing.toneSummary
          ? existing.toneSummary
          : toneSnippet
        : existing.toneSummary,
      updatedAt: now,
    };
    await db.put('authors', updated);
    return updated;
  }

  const created: AuthorRecord = {
    id: norm.authorId,
    name: norm.displayName,
    normalizedKey: norm.normalizedKey,
    aliases: rawAuthor.trim() ? [rawAuthor.trim()] : [norm.displayName],
    toneSummary: toneSnippet ?? '',
    bookCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  await db.put('authors', created);
  return created;
}

export async function recomputeAuthorStats(authorId: string): Promise<void> {
  const db = await getDB();
  const author = await db.get('authors', authorId);
  if (!author) return;
  const books = await db.getAllFromIndex('books', 'by-authorId', authorId);
  if (books.length === 0) {
    await db.delete('authors', authorId);
    return;
  }

  const tones = books
    .map((b) => b.profile?.authorTone?.trim())
    .filter((t): t is string => Boolean(t));

  await db.put('authors', {
    ...author,
    bookCount: books.length,
    toneSummary: tones[0] ?? author.toneSummary,
    updatedAt: Date.now(),
  });
}

export async function saveBookAndChunks(
  book: BookRecord,
  chunks: ChunkRecord[],
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['books', 'chunks'], 'readwrite');
  await tx.objectStore('books').put(book);
  const chunkStore = tx.objectStore('chunks');
  for (const chunk of chunks) {
    await chunkStore.put(chunk);
  }
  await tx.done;
  await recomputeAuthorStats(book.authorId);
}

export async function updateBookRecord(book: BookRecord): Promise<void> {
  const db = await getDB();
  await db.put('books', { ...book, updatedAt: Date.now() });
  await recomputeAuthorStats(book.authorId);
}

/**
 * Edits a book's title and/or author metadata, automatically re-grouping the book
 * and all its chunks under the normalized target Author Persona.
 */
export async function updateBookMetadata(
  bookId: string,
  newTitle: string,
  newAuthorName: string,
): Promise<{ book: BookRecord; author: AuthorRecord }> {
  const db = await getDB();
  const book = await db.get('books', bookId);
  if (!book) throw new Error('Book not found');

  const oldAuthorId = book.authorId;
  const targetAuthor = await upsertAuthorForRawName(
    newAuthorName,
    book.profile?.authorTone,
  );

  const updatedBook: BookRecord = {
    ...book,
    title: newTitle.trim() || book.title,
    originalAuthor: newAuthorName.trim() || targetAuthor.name,
    authorId: targetAuthor.id,
    updatedAt: Date.now(),
  };

  const chunks = await db.getAllFromIndex('chunks', 'by-bookId', bookId);
  const tx = db.transaction(['books', 'chunks'], 'readwrite');
  await tx.objectStore('books').put(updatedBook);
  if (oldAuthorId !== targetAuthor.id) {
    const chunkStore = tx.objectStore('chunks');
    for (const chunk of chunks) {
      await chunkStore.put({ ...chunk, authorId: targetAuthor.id });
    }
  }
  await tx.done;

  await recomputeAuthorStats(targetAuthor.id);
  if (oldAuthorId !== targetAuthor.id) {
    await recomputeAuthorStats(oldAuthorId);
  }

  return { book: updatedBook, author: targetAuthor };
}

export async function deleteBook(bookId: string): Promise<void> {
  const db = await getDB();
  const book = await db.get('books', bookId);
  if (!book) return;

  const chunks = await db.getAllFromIndex('chunks', 'by-bookId', bookId);
  const tx = db.transaction(['books', 'chunks'], 'readwrite');
  await tx.objectStore('books').delete(bookId);
  const chunkStore = tx.objectStore('chunks');
  for (const chunk of chunks) {
    await chunkStore.delete(chunk.id);
  }
  await tx.done;
  await recomputeAuthorStats(book.authorId);
}

export async function deleteAuthorAndBooks(authorId: string): Promise<void> {
  const db = await getDB();
  const books = await db.getAllFromIndex('books', 'by-authorId', authorId);
  const chunks = await db.getAllFromIndex('chunks', 'by-authorId', authorId);
  const tx = db.transaction(['authors', 'books', 'chunks'], 'readwrite');
  await tx.objectStore('authors').delete(authorId);
  const bookStore = tx.objectStore('books');
  for (const b of books) await bookStore.delete(b.id);
  const chunkStore = tx.objectStore('chunks');
  for (const c of chunks) await chunkStore.delete(c.id);
  await tx.done;
}

export async function getAllAuthors(): Promise<AuthorRecord[]> {
  const db = await getDB();
  const authors = await db.getAll('authors');
  return authors.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getAllBooks(): Promise<BookRecord[]> {
  const db = await getDB();
  const books = await db.getAll('books');
  return books.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getBookById(bookId: string): Promise<BookRecord | undefined> {
  const db = await getDB();
  return db.get('books', bookId);
}

export async function getAuthorById(authorId: string): Promise<AuthorRecord | undefined> {
  const db = await getDB();
  return db.get('authors', authorId);
}

export async function getChunksForBook(bookId: string): Promise<ChunkRecord[]> {
  const db = await getDB();
  const chunks = await db.getAllFromIndex('chunks', 'by-bookId', bookId);
  return chunks.sort((a, b) => a.index - b.index);
}

export async function getChunksForAuthor(authorId: string): Promise<ChunkRecord[]> {
  const db = await getDB();
  return db.getAllFromIndex('chunks', 'by-authorId', authorId);
}

export async function getAllChunks(): Promise<ChunkRecord[]> {
  const db = await getDB();
  return db.getAll('chunks');
}

export async function getAllConversations(): Promise<CouncilConversation[]> {
  const db = await getDB();
  const all = await db.getAll('conversations');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveConversation(conv: CouncilConversation): Promise<void> {
  const db = await getDB();
  await db.put('conversations', conv);
}

export async function deleteConversation(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('conversations', id);
}
