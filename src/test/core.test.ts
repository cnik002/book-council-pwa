import { describe, it, expect, beforeEach } from 'vitest';
import JSZip from 'jszip';
import { normalizeAuthorName } from '../services/parsers/authorNormalizer';
import { chunkSections } from '../services/parsers/chunker';
import { parseEpubBuffer } from '../services/parsers/epubParser';
import { hybridSearchChunks } from '../services/retrieval/hybridSearch';
import {
  getAllAuthors,
  getAllBooks,
  getChunksForAuthor,
  resetDBCacheForTests,
  saveBookAndChunks,
  updateBookMetadata,
  upsertAuthorForRawName,
} from '../services/storage/db';
import { exportLibraryBackup, importLibraryBackup } from '../services/storage/backup';
import { runBookCouncilPipeline } from '../services/agents/councilOrchestrator';
import { DEFAULT_SETTINGS } from '../services/storage/settings';
import type { BookRecord } from '../types';

async function createSampleEpubBuffer(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?>
     <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
       <rootfiles>
         <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
       </rootfiles>
     </container>`,
  );
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?>
     <package xmlns="http://www.idpf.org/2007/opf" version="2.0">
       <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
         <dc:title>Deep Work</dc:title>
         <dc:creator>Newport, Cal</dc:creator>
       </metadata>
       <manifest>
         <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
         <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
         <item id="ch2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
       </manifest>
       <spine toc="ncx">
         <itemref idref="ch1"/>
         <itemref idref="ch2"/>
       </spine>
     </package>`,
  );
  zip.file(
    'OEBPS/toc.ncx',
    `<?xml version="1.0" encoding="utf-8"?>
     <ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
       <navMap>
         <navPoint id="np1" playOrder="1">
           <navLabel><text>Chapter 1: Deep Work Is Valuable</text></navLabel>
           <content src="chapter1.xhtml"/>
         </navPoint>
         <navPoint id="np2" playOrder="2">
           <navLabel><text>Chapter 2: Quit Social Media</text></navLabel>
           <content src="chapter2.xhtml"/>
         </navPoint>
       </navMap>
     </ncx>`,
  );
  zip.file(
    'OEBPS/chapter1.xhtml',
    `<html><body><h1>Deep Work Is Valuable</h1>
      <p>${'Focused attention without distraction builds rare and valuable cognitive skill in a noisy economy. '.repeat(12)}</p>
    </body></html>`,
  );
  zip.file(
    'OEBPS/chapter2.xhtml',
    `<html><body><h1>Quit Social Media</h1>
      <p>${'Use the craftsman approach to tool selection instead of any-benefit social network adoption. '.repeat(12)}</p>
    </body></html>`,
  );
  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('Book Council Core Pipeline', () => {
  beforeEach(async () => {
    await resetDBCacheForTests();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('book-council-db');
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });

  it('normalizes author variants into a single canonical Author ID', () => {
    const a = normalizeAuthorName('James Clear');
    const b = normalizeAuthorName('Clear, James');
    const c = normalizeAuthorName('Dr. James R. Clear');
    const d = normalizeAuthorName('JAMES CLEAR');

    expect(a.authorId).toBe(b.authorId);
    expect(b.authorId).toBe(c.authorId);
    expect(c.authorId).toBe(d.authorId);
    expect(b.displayName).toBe('James Clear');
    expect(c.displayName).toBe('James R. Clear');
  });

  it('parses EPUB metadata, spine chapters, and chunks cleanly', async () => {
    const buf = await createSampleEpubBuffer();
    const parsed = await parseEpubBuffer(buf, 'deep-work.epub');

    expect(parsed.title).toBe('Deep Work');
    expect(parsed.author).toBe('Newport, Cal');
    expect(parsed.sections).toHaveLength(2);
    expect(parsed.sections[0].chapter).toBe('Chapter 1: Deep Work Is Valuable');

    const norm = normalizeAuthorName(parsed.author);
    const chunks = chunkSections(parsed.sections, 'book-1', norm.authorId, {
      targetWords: 60,
      overlapWords: 15,
      minChunkWords: 10,
    });
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0].authorId).toBe('author-cal-newport');
    expect(Object.keys(chunks[0].tf).length).toBeGreaterThan(0);
  });

  it('groups multiple books by the same author and supports metadata re-grouping & backup', async () => {
    const author1 = await upsertAuthorForRawName('Clear, James', 'Direct and practical');
    const author2 = await upsertAuthorForRawName('James Clear');
    expect(author1.id).toBe(author2.id);

    const now = Date.now();
    const b1: BookRecord = {
      id: 'b-atomic',
      authorId: author1.id,
      title: 'Atomic Habits',
      originalAuthor: 'Clear, James',
      fileName: 'atomic.epub',
      fileType: 'epub',
      totalChunks: 1,
      totalWords: 100,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    };
    const b2: BookRecord = {
      id: 'b-wrong-author',
      authorId: (await upsertAuthorForRawName('Unknown')).id,
      title: 'Habits Field Guide',
      originalAuthor: 'Unknown',
      fileName: 'guide.pdf',
      fileType: 'pdf',
      totalChunks: 1,
      totalWords: 80,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    };

    await saveBookAndChunks(
      b1,
      chunkSections(
        [{ chapter: 'Four Laws', text: 'Make cues obvious, attractive, easy, and satisfying to build daily habits. '.repeat(6) }],
        b1.id,
        b1.authorId,
        { minChunkWords: 10 },
      ),
    );
    await saveBookAndChunks(
      b2,
      chunkSections(
        [{ chapter: 'Environment Design', text: 'Redesign your physical environment so good cues are visible on your desk. '.repeat(6) }],
        b2.id,
        b2.authorId,
        { minChunkWords: 10 },
      ),
    );

    // Fix messy author metadata -> merges under James Clear and removes empty Unknown author
    await updateBookMetadata('b-wrong-author', 'Habits Field Guide', 'James Clear');
    const authors = await getAllAuthors();
    expect(authors).toHaveLength(1);
    expect(authors[0].bookCount).toBe(2);

    const authorChunks = await getChunksForAuthor(authors[0].id);
    expect(authorChunks).toHaveLength(2);

    // Hybrid search across both books
    const hits = hybridSearchChunks(authorChunks, ['environment physical cues desk'], {
      bookIds: ['b-atomic', 'b-wrong-author'],
      topK: 4,
    });
    expect(hits[0].chunk.bookId).toBe('b-wrong-author');

    // JSON Export / Import round-trip
    const backup = await exportLibraryBackup(false);
    const json = JSON.stringify(backup);
    const imported = await importLibraryBackup(json, 'replace');
    expect(imported.booksImported).toBe(2);
    expect((await getAllBooks())).toHaveLength(2);
  });

  it('orchestrates Librarian -> Author Personas -> Moderator with divergent & abstention handling', async () => {
    const a1 = await upsertAuthorForRawName('Cal Newport', 'Rigorous and anti-distraction');
    const a2 = await upsertAuthorForRawName('Austin Kleon', 'Playful and generous');

    const now = Date.now();
    const book1: BookRecord = {
      id: 'bk-newport',
      authorId: a1.id,
      title: 'So Good They Cant Ignore You',
      originalAuthor: 'Cal Newport',
      fileName: 'sogood.epub',
      fileType: 'epub',
      totalChunks: 1,
      totalWords: 120,
      profile: {
        coreTopics: ['Career capital', 'Craftsmanship'],
        frameworks: [{ name: 'Craftsman Mindset', description: 'Focus on rare value before passion.' }],
        problemsSolved: ['Career transitions', 'Networking outreach'],
        authorTone: 'Analytical',
        summary: 'Build rare skills to earn career autonomy.',
      },
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    };
    const book2: BookRecord = {
      id: 'bk-kleon',
      authorId: a2.id,
      title: 'Show Your Work',
      originalAuthor: 'Austin Kleon',
      fileName: 'showwork.epub',
      fileType: 'epub',
      totalChunks: 1,
      totalWords: 120,
      profile: {
        coreTopics: ['Sharing process', 'Warm outreach'],
        frameworks: [{ name: 'Scenius', description: 'Share daily work to attract peers.' }],
        problemsSolved: ['Re-engaging warm contacts', 'Building audience'],
        authorTone: 'Conversational',
        summary: 'Share your creative process openly.',
      },
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    };

    await saveBookAndChunks(
      book1,
      chunkSections(
        [{ chapter: 'Chapter 3: Career Capital', text: 'Offer concrete rare value and thoughtful research when reaching out to senior contacts. '.repeat(8) }],
        book1.id,
        a1.id,
        { minChunkWords: 10 },
      ),
    );
    await saveBookAndChunks(
      book2,
      chunkSections(
        [{ chapter: 'Chapter 4: Share Something Small', text: 'Reconnect with peers by sharing a genuinely useful artifact or project update without asking for favors. '.repeat(8) }],
        book2.id,
        a2.id,
        { minChunkWords: 10 },
      ),
    );

    let callCount = 0;
    const result = await runBookCouncilPipeline(
      'I want to message an old mentor from 2 years ago without sounding needy.',
      { ...DEFAULT_SETTINGS, geminiApiKey: 'test-key' },
      undefined,
      {
        callJson: async <T,>(_settings: unknown, opts: { systemInstruction: string }) => {
          callCount++;
          if (callCount === 1) {
            return {
              abstractedIntent: 'Re-engaging a warm professional contact with value rather than a cold ask',
              problemDomain: 'Networking & Outreach',
              selectedAuthors: [
                {
                  authorId: a1.id,
                  authorName: a1.name,
                  bookIds: [book1.id],
                  bookTitles: [book1.title],
                  reason: 'Career capital perspective on outreach',
                  searchQueries: ['rare value senior contacts'],
                },
                {
                  authorId: a2.id,
                  authorName: a2.name,
                  bookIds: [book2.id],
                  bookTitles: [book2.title],
                  reason: 'Sharing small updates to reconnect',
                  searchQueries: ['reconnect peers artifact update'],
                },
              ],
            } as T;
          }
          if (opts.systemInstruction.includes('Cal Newport')) {
            return {
              abstained: true,
              abstentionReason: 'My book focuses on skill acquisition rather than warm social re-engagement.',
              advice: '',
              citations: [],
            } as T;
          }
          if (opts.systemInstruction.includes('Austin Kleon')) {
            return {
              abstained: false,
              advice: 'Lead by sending a brief note pointing to something small you built or learned that connects to their work, with zero expectation of a favor.',
              citations: [{ bookTitle: book2.title, chapterOrConcept: 'Chapter 4: Share Something Small' }],
            } as T;
          }
          return {
            consensusType: 'aligned',
            headline: 'Lead With a Small, Useful Artifact',
            unifiedPlan: 'Follow Austin Kleon (Show Your Work): share a concise update on something you created that connects to their interests without making a direct ask.',
          } as T;
        },
      },
    );

    expect(result.librarian.abstractedIntent).toContain('warm professional contact');
    expect(result.perspectives).toHaveLength(2);
    expect(result.perspectives[0].abstained).toBe(true);
    expect(result.perspectives[1].abstained).toBe(false);
    expect(result.synthesis.consensusType).toBe('aligned');
  });
});
