import type { ChunkRecord } from '../../types';

export interface ParsedSection {
  chapter: string;
  pageStart?: number;
  pageEnd?: number;
  text: string;
}

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'because', 'been', 'but', 'by',
  'can', 'could', 'did', 'do', 'does', 'doing', 'done', 'down', 'during',
  'each', 'even', 'for', 'from', 'further', 'get', 'got', 'had', 'has', 'have',
  'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his',
  'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'just', 'like',
  'make', 'many', 'may', 'me', 'might', 'more', 'most', 'much', 'must', 'my',
  'myself', 'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'one', 'only',
  'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'she',
  'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'theirs',
  'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those',
  'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we', 'were',
  'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'will',
  'with', 'would', 'you', 'your', 'yours', 'yourself', 'yourselves', 'also',
  'about', 'after', 'again', 'against', 'all', 'am', 'any', 'back', 'before',
  'being', 'between', 'both', 'every', 'first', 'go', 'going', 'good', 'great',
  'know', 'new', 'people', 'really', 'right', 'see', 'think', 'time', 'two',
  'us', 'use', 'way', 'well', 'work', 'year', 'years',
]);

/**
 * Tokenizes text into normalized lowercase terms, stripping punctuation & stopwords.
 */
export function tokenize(text: string): string[] {
  const raw = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/);

  const tokens: string[] = [];
  for (const w of raw) {
    const clean = w.replace(/^-+|-+$/g, '');
    if (clean.length < 2 || STOPWORDS.has(clean)) continue;
    // Simple lightweight suffix stemming for better recall
    let stem = clean;
    if (stem.length > 5 && stem.endsWith('ing')) {
      stem = stem.slice(0, -3);
    } else if (stem.length > 4 && stem.endsWith('ies')) {
      stem = `${stem.slice(0, -3)}y`;
    } else if (stem.length > 4 && stem.endsWith('ed')) {
      stem = stem.slice(0, -2);
    } else if (stem.length > 4 && stem.endsWith('s') && !stem.endsWith('ss')) {
      stem = stem.slice(0, -1);
    }
    tokens.push(stem);
  }
  return tokens;
}

export function computeTermFrequency(text: string): Record<string, number> {
  const tokens = tokenize(text);
  const tf: Record<string, number> = {};
  for (const tok of tokens) {
    tf[tok] = (tf[tok] ?? 0) + 1;
  }
  return tf;
}

export interface ChunkOptions {
  targetWords?: number;
  overlapWords?: number;
  minChunkWords?: number;
}

/**
 * Splits parsed book sections into overlapping chunks with chapter/page metadata
 * and precomputed term-frequency maps for hybrid search.
 */
export function chunkSections(
  sections: ParsedSection[],
  bookId: string,
  authorId: string,
  options: ChunkOptions = {},
): ChunkRecord[] {
  const targetWords = options.targetWords ?? 420;
  const overlapWords = options.overlapWords ?? 75;
  const minChunkWords = options.minChunkWords ?? 40;

  const chunks: ChunkRecord[] = [];
  let chunkIndex = 0;

  for (const section of sections) {
    const cleaned = section.text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
    if (!cleaned) continue;

    // Split on paragraphs first, then pack into word windows
    const paragraphs = cleaned
      .split(/\n{2,}/)
      .map((p) => p.replace(/\n+/g, ' ').trim())
      .filter(Boolean);

    const words: string[] = [];
    for (const para of paragraphs) {
      const pWords = para.split(/\s+/).filter(Boolean);
      words.push(...pWords);
    }

    if (words.length === 0) continue;

    if (words.length <= targetWords) {
      if (words.length >= minChunkWords || sections.length === 1) {
        const text = words.join(' ');
        chunks.push({
          id: `${bookId}::chunk-${chunkIndex}`,
          bookId,
          authorId,
          index: chunkIndex,
          chapter: section.chapter || 'Main Text',
          pageStart: section.pageStart,
          pageEnd: section.pageEnd,
          text,
          wordCount: words.length,
          tf: computeTermFrequency(`${section.chapter} ${text}`),
        });
        chunkIndex++;
      }
      continue;
    }

    const step = Math.max(50, targetWords - overlapWords);
    for (let start = 0; start < words.length; start += step) {
      const slice = words.slice(start, start + targetWords);
      if (slice.length < minChunkWords && chunks.length > 0 && start > 0) {
        // Merge tiny trailing sliver into previous chunk if same book/section
        const prev = chunks[chunks.length - 1];
        if (prev.bookId === bookId && prev.chapter === (section.chapter || 'Main Text')) {
          const tailOnly = words.slice(Math.max(start, start - 0));
          const mergedText = `${prev.text} ${tailOnly.join(' ')}`.trim();
          prev.text = mergedText;
          prev.wordCount = mergedText.split(/\s+/).length;
          prev.tf = computeTermFrequency(`${prev.chapter} ${mergedText}`);
          if (section.pageEnd !== undefined) {
            prev.pageEnd = section.pageEnd;
          }
          break;
        }
      }

      const text = slice.join(' ');
      // Estimate page range proportionally if section spans multiple pages
      let pageStart = section.pageStart;
      let pageEnd = section.pageEnd;
      if (
        section.pageStart !== undefined &&
        section.pageEnd !== undefined &&
        section.pageEnd > section.pageStart
      ) {
        const span = section.pageEnd - section.pageStart;
        const startRatio = start / words.length;
        const endRatio = Math.min(1, (start + slice.length) / words.length);
        pageStart = Math.round(section.pageStart + span * startRatio);
        pageEnd = Math.round(section.pageStart + span * endRatio);
      }

      chunks.push({
        id: `${bookId}::chunk-${chunkIndex}`,
        bookId,
        authorId,
        index: chunkIndex,
        chapter: section.chapter || 'Main Text',
        pageStart,
        pageEnd,
        text,
        wordCount: slice.length,
        tf: computeTermFrequency(`${section.chapter} ${text}`),
      });
      chunkIndex++;

      if (start + targetWords >= words.length) break;
    }
  }

  return chunks;
}
