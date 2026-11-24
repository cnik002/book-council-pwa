import type { LibraryBackupPayload } from '../../types';
import {
  getAllAuthors,
  getAllBooks,
  getAllChunks,
  getAllConversations,
  getDB,
  recomputeAuthorStats,
  upsertAuthorForRawName,
} from './db';

export async function exportLibraryBackup(includeConversations = true): Promise<LibraryBackupPayload> {
  const [authors, books, chunks, conversations] = await Promise.all([
    getAllAuthors(),
    getAllBooks(),
    getAllChunks(),
    includeConversations ? getAllConversations() : Promise.resolve([]),
  ]);

  return {
    schemaVersion: 1,
    exportedAt: Date.now(),
    authors,
    books,
    chunks,
    ...(includeConversations ? { conversations } : {}),
  };
}

export function downloadBackupJson(payload: LibraryBackupPayload): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `book-council-backup-${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function importLibraryBackup(
  rawJson: string,
  mode: 'merge' | 'replace' = 'merge',
): Promise<{ authorsImported: number; booksImported: number; chunksImported: number }> {
  const parsed = JSON.parse(rawJson) as Partial<LibraryBackupPayload>;
  if (
    parsed.schemaVersion !== 1 ||
    !Array.isArray(parsed.authors) ||
    !Array.isArray(parsed.books) ||
    !Array.isArray(parsed.chunks)
  ) {
    throw new Error('Invalid Book Council backup file format.');
  }

  const db = await getDB();

  if (mode === 'replace') {
    const tx = db.transaction(['authors', 'books', 'chunks', 'conversations'], 'readwrite');
    await tx.objectStore('authors').clear();
    await tx.objectStore('books').clear();
    await tx.objectStore('chunks').clear();
    if (Array.isArray(parsed.conversations)) {
      await tx.objectStore('conversations').clear();
    }
    await tx.done;
  }

  // Remap author IDs cleanly via normalization in case of merge
  const oldToNewAuthorId = new Map<string, string>();
  for (const author of parsed.authors) {
    const upserted = await upsertAuthorForRawName(author.name, author.toneSummary);
    oldToNewAuthorId.set(author.id, upserted.id);
  }

  const tx = db.transaction(['books', 'chunks', 'conversations'], 'readwrite');
  const bookStore = tx.objectStore('books');
  for (const book of parsed.books) {
    const mappedAuthorId = oldToNewAuthorId.get(book.authorId) ?? book.authorId;
    await bookStore.put({ ...book, authorId: mappedAuthorId });
  }

  const chunkStore = tx.objectStore('chunks');
  for (const chunk of parsed.chunks) {
    const mappedAuthorId = oldToNewAuthorId.get(chunk.authorId) ?? chunk.authorId;
    await chunkStore.put({ ...chunk, authorId: mappedAuthorId });
  }

  if (Array.isArray(parsed.conversations)) {
    const convStore = tx.objectStore('conversations');
    for (const conv of parsed.conversations) {
      await convStore.put(conv);
    }
  }
  await tx.done;

  const affectedAuthorIds = new Set(
    parsed.books.map((b) => oldToNewAuthorId.get(b.authorId) ?? b.authorId),
  );
  for (const authorId of affectedAuthorIds) {
    await recomputeAuthorStats(authorId);
  }

  return {
    authorsImported: parsed.authors.length,
    booksImported: parsed.books.length,
    chunksImported: parsed.chunks.length,
  };
}
