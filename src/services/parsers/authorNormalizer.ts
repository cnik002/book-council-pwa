const HONORIFICS_AND_SUFFIXES = new Set([
  'dr',
  'prof',
  'professor',
  'mr',
  'mrs',
  'ms',
  'sir',
  'phd',
  'md',
  'jr',
  'sr',
  'ii',
  'iii',
  'iv',
  'esq',
]);

export interface NormalizedAuthor {
  /** Stable slug used as IndexedDB key & grouping key */
  authorId: string;
  /** Canonical comparison string (sorted lowercase tokens without initials/honorifics) */
  normalizedKey: string;
  /** Clean human-readable display name (e.g., "Clear, James" -> "James Clear") */
  displayName: string;
}

function stripDiacritics(input: string): string {
  return input.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function toTitleCaseWord(word: string): string {
  if (!word) return word;
  // Preserve acronyms or initials like "J." or "C.S."
  if (/^[A-Z]\.?$/.test(word)) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function formatDisplayName(raw: string): string {
  let cleaned = raw
    .replace(/\s+/g, ' ')
    .replace(/\([^)]*\)/g, '') // strip parenthetical roles like "(Author)" or "(Editor)"
    .replace(/\s*;\s*/g, ', ')
    .trim();

  if (!cleaned) return 'Unknown Author';

  // Handle "Last, First" or "Last, First Middle" (only when single comma separates surname and given name)
  const commaParts = cleaned.split(',').map((p) => p.trim()).filter(Boolean);
  if (commaParts.length === 2) {
    const [last, first] = commaParts;
    // Avoid flipping "John Doe, PhD"
    const secondTokens = first.toLowerCase().replace(/\./g, '').split(/\s+/);
    const isSuffix = secondTokens.every((t) => HONORIFICS_AND_SUFFIXES.has(t));
    if (isSuffix) {
      cleaned = last;
    } else {
      cleaned = `${first} ${last}`;
    }
  }

  // Remove trailing honorifics/suffixes like ", Ph.D."
  const words = cleaned.split(/\s+/).filter((w) => {
    const bare = w.toLowerCase().replace(/[.,]/g, '');
    return bare.length > 0 && !HONORIFICS_AND_SUFFIXES.has(bare);
  });

  if (words.length === 0) return 'Unknown Author';

  const needsCasing =
    cleaned === cleaned.toUpperCase() || cleaned === cleaned.toLowerCase();

  return words
    .map((w) => (needsCasing ? toTitleCaseWord(w) : w))
    .join(' ')
    .trim();
}

/**
 * Normalizes an author string so variants like:
 * - "James Clear"
 * - "Clear, James"
 * - "Dr. James R. Clear"
 * - "JAMES CLEAR"
 * all resolve to the same canonical `authorId` and `normalizedKey`.
 */
export function normalizeAuthorName(rawAuthor: string | undefined | null): NormalizedAuthor {
  const raw = (rawAuthor ?? '').trim();
  if (!raw) {
    return {
      authorId: 'author-unknown',
      normalizedKey: 'unknown author',
      displayName: 'Unknown Author',
    };
  }

  // If multiple authors separated by " and " or "&" or ";", pick primary or preserve normalized group
  const displayName = formatDisplayName(raw);
  const ascii = stripDiacritics(displayName)
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const rawTokens = ascii.split(' ').filter(Boolean);
  // Drop single-letter middle initials when there are 3+ tokens so "James R Clear" == "James Clear"
  const filteredTokens =
    rawTokens.length >= 3
      ? rawTokens.filter((tok, idx) => idx === 0 || idx === rawTokens.length - 1 || tok.length > 1)
      : rawTokens;

  const finalTokens = filteredTokens.filter((t) => !HONORIFICS_AND_SUFFIXES.has(t));
  const keyTokens = (finalTokens.length > 0 ? finalTokens : rawTokens).slice();

  // Sort tokens only if length <= 3 to remain robust against "Last First" without punctuation,
  // while keeping multi-author lists distinguishable.
  const normalizedKey =
    keyTokens.length <= 3 ? [...keyTokens].sort().join(' ') : keyTokens.join(' ');

  const slugBase = (finalTokens.length > 0 ? finalTokens : rawTokens)
    .join('-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 64);

  return {
    authorId: `author-${slugBase || 'unknown'}`,
    normalizedKey: normalizedKey || 'unknown author',
    displayName,
  };
}

/**
 * Generates initials and deterministic accent color index for an Author avatar.
 */
export function getAuthorInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
