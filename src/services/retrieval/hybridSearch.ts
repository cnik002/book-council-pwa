import type { ChunkRecord } from '../../types';
import { tokenize } from '../parsers/chunker';

export interface ScoredChunk {
  chunk: ChunkRecord;
  score: number;
  matchedTerms: string[];
}

export interface HybridSearchOptions {
  bookIds?: string[];
  topK?: number;
  minScore?: number;
}

function extractBigrams(tokens: string[]): string[] {
  const bigrams: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    bigrams.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return bigrams;
}

/**
 * Hybrid BM25/TF-IDF + exact keyword/phrase + chapter-header scoring over a set of chunks.
 * Balances coverage across multiple books when `bookIds` spans >1 book by the same author.
 */
export function hybridSearchChunks(
  chunks: ChunkRecord[],
  queryStrings: string[],
  options: HybridSearchOptions = {},
): ScoredChunk[] {
  const topK = options.topK ?? 8;
  const minScore = options.minScore ?? 0.05;

  const candidateChunks =
    options.bookIds && options.bookIds.length > 0
      ? chunks.filter((c) => options.bookIds!.includes(c.bookId))
      : chunks;

  if (candidateChunks.length === 0) return [];

  const combinedQuery = queryStrings.join(' ').trim();
  const queryTokens = Array.from(new Set(tokenize(combinedQuery)));
  if (queryTokens.length === 0) {
    return candidateChunks.slice(0, topK).map((chunk) => ({
      chunk,
      score: 0.1,
      matchedTerms: [],
    }));
  }

  const rawKeywords = Array.from(
    new Set(
      combinedQuery
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 4),
    ),
  );
  const queryBigrams = extractBigrams(queryTokens);

  const N = candidateChunks.length;
  const avgDocLen =
    candidateChunks.reduce((acc, c) => acc + Math.max(1, c.wordCount), 0) / N;

  // Document frequency across candidate chunks
  const df = new Map<string, number>();
  for (const term of queryTokens) {
    let count = 0;
    for (const c of candidateChunks) {
      if ((c.tf[term] ?? 0) > 0) count++;
    }
    df.set(term, count);
  }

  const k1 = 1.4;
  const b = 0.65;

  const scored: ScoredChunk[] = [];

  for (const chunk of candidateChunks) {
    const docLen = Math.max(1, chunk.wordCount);
    let bm25Score = 0;
    const matchedTerms: string[] = [];

    for (const term of queryTokens) {
      const tf = chunk.tf[term] ?? 0;
      if (tf === 0) continue;
      matchedTerms.push(term);
      const docFreq = df.get(term) ?? 0;
      const idf = Math.log(1 + (N - docFreq + 0.5) / (docFreq + 0.5));
      const denom = tf + k1 * (1 - b + b * (docLen / avgDocLen));
      bm25Score += idf * ((tf * (k1 + 1)) / denom);
    }

    if (bm25Score === 0) continue;

    const lowerText = chunk.text.toLowerCase();
    const lowerChapter = chunk.chapter.toLowerCase();

    // Keyword exact match boost + chapter header boost
    let keywordBoost = 0;
    for (const kw of rawKeywords) {
      if (lowerChapter.includes(kw)) keywordBoost += 0.9;
      else if (lowerText.includes(kw)) keywordBoost += 0.25;
    }

    // Phrase / bigram proximity boost (approximates semantic co-occurrence)
    let bigramBoost = 0;
    if (queryBigrams.length > 0) {
      const chunkTokens = tokenize(chunk.text);
      const chunkBigramSet = new Set(extractBigrams(chunkTokens));
      for (const bg of queryBigrams) {
        if (chunkBigramSet.has(bg)) bigramBoost += 0.65;
      }
    }

    // Coverage ratio bonus when multiple distinct query concepts appear together
    const coverageRatio = matchedTerms.length / queryTokens.length;
    const totalScore = bm25Score * (1 + coverageRatio * 0.5) + keywordBoost + bigramBoost;

    if (totalScore >= minScore) {
      scored.push({ chunk, score: totalScore, matchedTerms });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  // Diversity filter: avoid picking immediately adjacent overlapping chunks unless needed,
  // and ensure multi-book balance when multiple books have relevant matches.
  const selected: ScoredChunk[] = [];
  const usedKeys = new Set<string>();
  const bookCounts = new Map<string, number>();
  const distinctBooks = new Set(scored.map((s) => s.chunk.bookId));
  const maxPerBook =
    distinctBooks.size > 1 ? Math.max(2, Math.ceil(topK / distinctBooks.size) + 1) : topK;

  for (const item of scored) {
    if (selected.length >= topK) break;
    const prevKey = `${item.chunk.bookId}:${item.chunk.index - 1}`;
    const nextKey = `${item.chunk.bookId}:${item.chunk.index + 1}`;
    const countForBook = bookCounts.get(item.chunk.bookId) ?? 0;

    if (countForBook >= maxPerBook) continue;
    if (usedKeys.has(prevKey) || usedKeys.has(nextKey)) continue;

    selected.push(item);
    usedKeys.add(`${item.chunk.bookId}:${item.chunk.index}`);
    bookCounts.set(item.chunk.bookId, countForBook + 1);
  }

  // Backfill if diversity filter left slots open
  if (selected.length < topK) {
    const selectedIds = new Set(selected.map((s) => s.chunk.id));
    for (const item of scored) {
      if (selected.length >= topK) break;
      if (!selectedIds.has(item.chunk.id)) {
        selected.push(item);
        selectedIds.add(item.chunk.id);
      }
    }
  }

  return selected;
}
