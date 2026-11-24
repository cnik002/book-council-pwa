import JSZip from 'jszip';
import type { ParsedSection } from './chunker';

export interface ParsedBookResult {
  title: string;
  author: string;
  sections: ParsedSection[];
  totalWords: number;
}

function resolveZipPath(baseDir: string, relativeHref: string): string {
  const cleanHref = decodeURIComponent(relativeHref.split('#')[0]).replace(/^\/+/, '');
  if (!baseDir) return cleanHref;
  const baseParts = baseDir.split('/').filter(Boolean);
  const relParts = cleanHref.split('/');
  for (const part of relParts) {
    if (part === '.' || part === '') continue;
    if (part === '..') {
      baseParts.pop();
    } else {
      baseParts.push(part);
    }
  }
  return baseParts.join('/');
}

function getTagText(doc: Document, localNames: string[]): string {
  for (const name of localNames) {
    const nsEls = doc.getElementsByTagNameNS('*', name);
    for (let i = 0; i < nsEls.length; i++) {
      const txt = nsEls[i].textContent?.trim();
      if (txt) return txt;
    }
    const plainEls = doc.getElementsByTagName(name);
    for (let i = 0; i < plainEls.length; i++) {
      const txt = plainEls[i].textContent?.trim();
      if (txt) return txt;
    }
  }
  return '';
}

function fallbackTitleFromFileName(fileName: string): { title: string; author: string } {
  const base = fileName.replace(/\.(epub|pdf)$/i, '').replace(/_/g, ' ').trim();
  const dashSplit = base.split(/\s+-\s+/);
  if (dashSplit.length >= 2) {
    return {
      title: dashSplit[0].trim(),
      author: dashSplit.slice(1).join(' - ').trim(),
    };
  }
  return { title: base || 'Untitled Book', author: 'Unknown Author' };
}

function extractTextAndHeadingFromHtml(rawHtml: string): { heading: string; text: string } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, 'text/html');

  // Remove non-content elements
  doc.querySelectorAll('script, style, svg, nav, noscript').forEach((el) => el.remove());

  let heading = '';
  const headingEl = doc.querySelector('h1, h2, h3');
  if (headingEl?.textContent) {
    heading = headingEl.textContent.replace(/\s+/g, ' ').trim();
  } else if (doc.title) {
    heading = doc.title.replace(/\s+/g, ' ').trim();
  }

  const blockTags = new Set([
    'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'DIV', 'SECTION', 'ARTICLE', 'TR',
  ]);

  const paragraphs: string[] = [];
  const body = doc.body ?? doc.documentElement;
  if (!body) return { heading, text: '' };

  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let buffer = '';

  const flush = () => {
    const normalized = buffer.replace(/\s+/g, ' ').trim();
    if (normalized) paragraphs.push(normalized);
    buffer = '';
  };

  let node: Node | null = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      buffer += ` ${node.textContent ?? ''}`;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = (node as Element).tagName;
      if (tag === 'BR') {
        flush();
      } else if (blockTags.has(tag)) {
        // Only flush if element doesn't contain nested block tags, or flush before heading/p
        if (tag === 'P' || tag.startsWith('H') || tag === 'LI' || tag === 'BLOCKQUOTE') {
          flush();
        }
      }
    }
    node = walker.nextNode();
  }
  flush();

  // Deduplicate adjacent identical lines sometimes produced by nested divs
  const deduped: string[] = [];
  for (const p of paragraphs) {
    if (deduped.length === 0 || deduped[deduped.length - 1] !== p) {
      deduped.push(p);
    }
  }

  return {
    heading,
    text: deduped.join('\n\n'),
  };
}

export async function parseEpubBuffer(
  data: ArrayBuffer,
  fileName: string,
  onProgress?: (pct: number, msg: string) => void,
): Promise<ParsedBookResult> {
  onProgress?.(5, 'Opening EPUB archive...');
  const zip = await JSZip.loadAsync(data);
  const xmlParser = new DOMParser();

  // 1. Locate OPF via META-INF/container.xml
  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) {
    throw new Error('Invalid EPUB: missing META-INF/container.xml');
  }
  const containerXml = await containerFile.async('text');
  const containerDoc = xmlParser.parseFromString(containerXml, 'application/xml');
  const rootfileEl =
    containerDoc.getElementsByTagNameNS('*', 'rootfile')[0] ??
    containerDoc.getElementsByTagName('rootfile')[0];
  const opfPath = rootfileEl?.getAttribute('full-path');
  if (!opfPath) {
    throw new Error('Invalid EPUB: missing OPF rootfile path');
  }

  const opfFile = zip.file(opfPath);
  if (!opfFile) {
    throw new Error(`Invalid EPUB: OPF file not found at ${opfPath}`);
  }
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
  const opfXml = await opfFile.async('text');
  const opfDoc = xmlParser.parseFromString(opfXml, 'application/xml');

  // 2. Metadata
  const fallback = fallbackTitleFromFileName(fileName);
  const title = getTagText(opfDoc, ['title']) || fallback.title;
  const author = getTagText(opfDoc, ['creator']) || fallback.author;

  // 3. Manifest & Spine
  const manifestMap = new Map<string, { href: string; mediaType: string }>();
  const itemEls = opfDoc.getElementsByTagNameNS('*', 'item');
  const items = itemEls.length > 0 ? itemEls : opfDoc.getElementsByTagName('item');
  for (let i = 0; i < items.length; i++) {
    const el = items[i];
    const id = el.getAttribute('id');
    const href = el.getAttribute('href');
    const mediaType = el.getAttribute('media-type') ?? '';
    if (id && href) {
      manifestMap.set(id, { href, mediaType });
    }
  }

  // Optional NCX TOC map (path -> label)
  const tocLabels = new Map<string, string>();
  for (const [, item] of manifestMap) {
    if (item.mediaType === 'application/x-dtbncx+xml' || item.href.toLowerCase().endsWith('.ncx')) {
      const ncxPath = resolveZipPath(opfDir, item.href);
      const ncxFile = zip.file(ncxPath);
      if (ncxFile) {
        try {
          const ncxXml = await ncxFile.async('text');
          const ncxDoc = xmlParser.parseFromString(ncxXml, 'application/xml');
          const navPoints = ncxDoc.getElementsByTagNameNS('*', 'navPoint');
          const ncxDir = ncxPath.includes('/') ? ncxPath.slice(0, ncxPath.lastIndexOf('/')) : '';
          for (let i = 0; i < navPoints.length; i++) {
            const np = navPoints[i];
            const labelEl = np.getElementsByTagNameNS('*', 'text')[0];
            const contentEl = np.getElementsByTagNameNS('*', 'content')[0];
            const src = contentEl?.getAttribute('src');
            const label = labelEl?.textContent?.replace(/\s+/g, ' ').trim();
            if (src && label) {
              const resolved = resolveZipPath(ncxDir, src);
              if (!tocLabels.has(resolved)) {
                tocLabels.set(resolved, label);
              }
            }
          }
        } catch {
          // Ignore malformed NCX
        }
      }
    }
  }

  const spineRefs: string[] = [];
  const itemrefEls = opfDoc.getElementsByTagNameNS('*', 'itemref');
  const itemrefs = itemrefEls.length > 0 ? itemrefEls : opfDoc.getElementsByTagName('itemref');
  for (let i = 0; i < itemrefs.length; i++) {
    const idref = itemrefs[i].getAttribute('idref');
    if (idref) spineRefs.push(idref);
  }

  // Fallback to all HTML items in manifest if spine is empty
  const orderedHrefs: string[] =
    spineRefs.length > 0
      ? spineRefs
          .map((id) => manifestMap.get(id))
          .filter((item): item is { href: string; mediaType: string } =>
            Boolean(item && (item.mediaType.includes('html') || /\.(x?html?|htm)$/i.test(item.href))),
          )
          .map((item) => resolveZipPath(opfDir, item.href))
      : Array.from(manifestMap.values())
          .filter((item) => item.mediaType.includes('html') || /\.(x?html?|htm)$/i.test(item.href))
          .map((item) => resolveZipPath(opfDir, item.href));

  const sections: ParsedSection[] = [];
  let totalWords = 0;

  for (let i = 0; i < orderedHrefs.length; i++) {
    const path = orderedHrefs[i];
    const file = zip.file(path);
    if (!file) continue;

    const pct = 15 + Math.round(((i + 1) / Math.max(1, orderedHrefs.length)) * 80);
    onProgress?.(pct, `Extracting section ${i + 1} of ${orderedHrefs.length}...`);

    const html = await file.async('text');
    const { heading, text } = extractTextAndHeadingFromHtml(html);
    const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
    if (words < 15) continue;

    const chapter = tocLabels.get(path) || heading || `Section ${sections.length + 1}`;
    sections.push({ chapter, text });
    totalWords += words;
  }

  if (sections.length === 0) {
    throw new Error('No readable text content found in EPUB.');
  }

  onProgress?.(100, 'EPUB extraction complete');
  return { title, author, sections, totalWords };
}
