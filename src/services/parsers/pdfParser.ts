import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ParsedSection } from './chunker';
import type { ParsedBookResult } from './epubParser';

if (typeof window !== 'undefined' && pdfWorkerUrl) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

function fallbackFromFileName(fileName: string): { title: string; author: string } {
  const base = fileName.replace(/\.pdf$/i, '').replace(/_/g, ' ').trim();
  const dashSplit = base.split(/\s+-\s+/);
  if (dashSplit.length >= 2) {
    return {
      title: dashSplit[0].trim(),
      author: dashSplit.slice(1).join(' - ').trim(),
    };
  }
  return { title: base || 'Untitled PDF', author: 'Unknown Author' };
}

function detectChapterHeading(pageText: string): string | undefined {
  const lines = pageText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 6);

  for (const line of lines) {
    if (
      /^(chapter|part|section|lesson|principle|habit|rule)\s+([0-9]+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)\b[:.\-\s]?.*$/i.test(
        line,
      ) &&
      line.length <= 100
    ) {
      return line;
    }
  }
  return undefined;
}

export async function parsePdfBuffer(
  data: ArrayBuffer,
  fileName: string,
  onProgress?: (pct: number, msg: string) => void,
): Promise<ParsedBookResult> {
  onProgress?.(5, 'Loading PDF document...');
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(data),
    useWorkerFetch: false,
    isEvalSupported: false,
  });
  const pdf = await loadingTask.promise;

  // 1. Metadata
  const fallback = fallbackFromFileName(fileName);
  let title = fallback.title;
  let author = fallback.author;
  try {
    const meta = await pdf.getMetadata();
    const info = meta?.info as Record<string, unknown> | undefined;
    if (typeof info?.Title === 'string' && info.Title.trim()) {
      title = info.Title.trim();
    }
    if (typeof info?.Author === 'string' && info.Author.trim()) {
      author = info.Author.trim();
    }
  } catch {
    // Fallback to filename metadata
  }

  // 2. Outline -> Page-to-chapter map
  const pageChapterMap = new Map<number, string>();
  try {
    const outline = await pdf.getOutline();
    if (outline && outline.length > 0) {
      const queue = [...outline];
      while (queue.length > 0) {
        const item = queue.shift()!;
        if (item.dest) {
          try {
            const dest =
              typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest;
            if (Array.isArray(dest) && dest[0]) {
              const pageIdx = await pdf.getPageIndex(dest[0] as Parameters<typeof pdf.getPageIndex>[0]);
              const pageNum = pageIdx + 1;
              if (!pageChapterMap.has(pageNum) && item.title?.trim()) {
                pageChapterMap.set(pageNum, item.title.replace(/\s+/g, ' ').trim());
              }
            }
          } catch {
            // Skip unresolved destination
          }
        }
        if (item.items && item.items.length > 0) {
          queue.unshift(...item.items);
        }
      }
    }
  } catch {
    // Ignore outline errors
  }

  // 3. Extract pages
  const numPages = pdf.numPages;
  const pageEntries: { pageNum: number; chapterHint?: string; text: string }[] = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const pct = 10 + Math.round((pageNum / Math.max(1, numPages)) * 85);
    if (pageNum === 1 || pageNum % 5 === 0 || pageNum === numPages) {
      onProgress?.(pct, `Reading PDF page ${pageNum} of ${numPages}...`);
    }

    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    let lastY: number | null = null;
    const lines: string[] = [];
    let currentLine = '';

    for (const rawItem of content.items) {
      if (!('str' in rawItem)) continue;
      const str = rawItem.str;
      const y = Array.isArray(rawItem.transform) ? rawItem.transform[5] : null;

      if (lastY !== null && y !== null && Math.abs(y - lastY) > 6) {
        if (currentLine.trim()) lines.push(currentLine.trim());
        currentLine = str;
        // Large vertical gap indicates paragraph break
        if (Math.abs(y - lastY) > 16) {
          lines.push('');
        }
      } else {
        currentLine += (currentLine && str && !currentLine.endsWith(' ') && !str.startsWith(' ') ? ' ' : '') + str;
      }
      if (rawItem.hasEOL) {
        if (currentLine.trim()) lines.push(currentLine.trim());
        currentLine = '';
      }
      if (y !== null) lastY = y;
    }
    if (currentLine.trim()) lines.push(currentLine.trim());

    const pageText = lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (pageText) {
      const chapterHint = pageChapterMap.get(pageNum) || detectChapterHeading(pageText);
      pageEntries.push({ pageNum, chapterHint, text: pageText });
    }
  }

  if (pageEntries.length === 0) {
    throw new Error('No extractable text found in PDF (it may be a scanned image PDF).');
  }

  // 4. Group pages into coherent sections
  const sections: ParsedSection[] = [];
  let activeChapter = pageEntries[0].chapterHint || '';
  let activeStart = pageEntries[0].pageNum;
  let activeEnd = pageEntries[0].pageNum;
  let activeTexts: string[] = [];
  let activeWordCount = 0;

  const flushSection = () => {
    const text = activeTexts.join('\n\n').trim();
    if (!text) return;
    const label = activeChapter || `Pages ${activeStart}–${activeEnd}`;
    sections.push({
      chapter: label,
      pageStart: activeStart,
      pageEnd: activeEnd,
      text,
    });
    activeTexts = [];
    activeWordCount = 0;
  };

  for (let i = 0; i < pageEntries.length; i++) {
    const entry = pageEntries[i];
    const words = entry.text.split(/\s+/).filter(Boolean).length;

    const chapterChanged =
      Boolean(entry.chapterHint) &&
      entry.chapterHint !== activeChapter &&
      activeTexts.length > 0;

    // Also split long chapterless spans every ~2500 words so sections stay bounded
    const sectionTooLarge = activeWordCount > 2500 && activeTexts.length > 0;

    if (chapterChanged || sectionTooLarge) {
      flushSection();
      activeChapter = entry.chapterHint || activeChapter;
      activeStart = entry.pageNum;
    } else if (activeTexts.length === 0) {
      activeStart = entry.pageNum;
      if (entry.chapterHint) activeChapter = entry.chapterHint;
    }

    activeEnd = entry.pageNum;
    activeTexts.push(entry.text);
    activeWordCount += words;
  }
  flushSection();

  const totalWords = sections.reduce(
    (sum, sec) => sum + sec.text.split(/\s+/).filter(Boolean).length,
    0,
  );

  onProgress?.(100, 'PDF extraction complete');
  return { title, author, sections, totalWords };
}
