import type {
  AppSettings,
  AuthorAdvice,
  AuthorRecord,
  BookRecord,
  ChunkRecord,
  LibrarianResult,
  LibrarianSelection,
  ModeratorSynthesis,
  PipelineProgress,
} from '../../types';
import { generateLLMJson, isLLMConfigured } from '../llm/llmClient';
import { hybridSearchChunks } from '../retrieval/hybridSearch';
import { getAllAuthors, getAllBooks, getChunksForAuthor } from '../storage/db';

const LIBRARIAN_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    abstractedIntent: {
      type: 'string',
      description:
        'A sharp 1-sentence abstraction of the underlying strategic, psychological, or practical problem (e.g. "re-engaging a warm networking contact without sounding transactional").',
    },
    problemDomain: {
      type: 'string',
      description: 'Short category label for the dilemma (e.g., "Networking & Persuasion", "Habit Design").',
    },
    selectedAuthors: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'object',
        properties: {
          authorId: { type: 'string' },
          authorName: { type: 'string' },
          bookIds: { type: 'array', items: { type: 'string' } },
          bookTitles: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' },
          searchQueries: {
            type: 'array',
            items: { type: 'string' },
            description: '2-4 focused retrieval queries reflecting concepts from their book(s).',
          },
        },
        required: ['authorId', 'authorName', 'bookIds', 'bookTitles', 'reason', 'searchQueries'],
      },
    },
    noMatchReason: {
      type: 'string',
      description: 'Only populated when selectedAuthors is empty.',
    },
  },
  required: ['abstractedIntent', 'problemDomain', 'selectedAuthors'],
};

const AUTHOR_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    abstained: {
      type: 'boolean',
      description:
        'True ONLY if none of the provided book excerpts genuinely offer a relevant framework for the user scenario.',
    },
    abstentionReason: {
      type: 'string',
      description: 'Brief first-person explanation if abstained is true.',
    },
    advice: {
      type: 'string',
      description:
        'First-person personalized advice applying your signature mental models to the user situation WITHOUT verbatim quotes from the text.',
    },
    citations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          bookTitle: { type: 'string' },
          chapterOrConcept: { type: 'string' },
        },
        required: ['bookTitle', 'chapterOrConcept'],
      },
    },
  },
  required: ['abstained', 'advice', 'citations'],
};

const MODERATOR_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    consensusType: {
      type: 'string',
      enum: ['aligned', 'divergent', 'uncovered'],
    },
    headline: {
      type: 'string',
      description: 'Crisp headline summarizing the council verdict.',
    },
    unifiedPlan: {
      type: 'string',
      description:
        'Used when consensusType is "aligned": a cohesive, actionable game plan weaving advice together with clear Author & Book attributions.',
    },
    options: {
      type: 'array',
      description:
        'Used when consensusType is "divergent": structured distinct philosophies/approaches labeled by Author & Book.',
      items: {
        type: 'object',
        properties: {
          authorName: { type: 'string' },
          bookTitles: { type: 'array', items: { type: 'string' } },
          approachTitle: { type: 'string' },
          summary: { type: 'string' },
          actionSteps: { type: 'array', items: { type: 'string' } },
        },
        required: ['authorName', 'bookTitles', 'approachTitle', 'summary', 'actionSteps'],
      },
    },
    uncoveredExplanation: {
      type: 'string',
      description: 'Used when consensusType is "uncovered".',
    },
  },
  required: ['consensusType', 'headline'],
};

function buildCatalogPrompt(authors: AuthorRecord[], books: BookRecord[]): string {
  const booksByAuthor = new Map<string, BookRecord[]>();
  for (const b of books) {
    const arr = booksByAuthor.get(b.authorId) ?? [];
    arr.push(b);
    booksByAuthor.set(b.authorId, arr);
  }

  return authors
    .map((author) => {
      const authoredBooks = booksByAuthor.get(author.id) ?? [];
      if (authoredBooks.length === 0) return '';
      const bookLines = authoredBooks
        .map((b) => {
          const p = b.profile;
          const frameworks = p?.frameworks?.map((f) => `${f.name}: ${f.description}`).join('; ') || 'N/A';
          const problems = p?.problemsSolved?.join(', ') || 'N/A';
          const topics = p?.coreTopics?.join(', ') || 'N/A';
          return `  - Book ID: "${b.id}" | Title: "${b.title}"
    Summary: ${p?.summary || 'No summary'}
    Topics: ${topics}
    Frameworks: ${frameworks}
    Problems Solved: ${problems}`;
        })
        .join('\n');

      return `Author ID: "${author.id}" | Name: "${author.name}" (${authoredBooks.length} book${authoredBooks.length > 1 ? 's' : ''})
  Tone: ${author.toneSummary || 'Analytical'}
${bookLines}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

function resolveAuthorSelection(
  raw: LibrarianSelection,
  authors: AuthorRecord[],
  books: BookRecord[],
): LibrarianSelection | null {
  const author =
    authors.find((a) => a.id === raw.authorId) ??
    authors.find((a) => a.name.toLowerCase() === raw.authorName.toLowerCase());

  if (!author) return null;

  const authorBooks = books.filter((b) => b.authorId === author.id);
  if (authorBooks.length === 0) return null;

  let matchedBooks = authorBooks.filter(
    (b) =>
      raw.bookIds.includes(b.id) ||
      raw.bookTitles.some((t) => t.toLowerCase() === b.title.toLowerCase()),
  );
  if (matchedBooks.length === 0) {
    matchedBooks = [authorBooks[0]];
  }

  return {
    authorId: author.id,
    authorName: author.name,
    bookIds: matchedBooks.map((b) => b.id),
    bookTitles: matchedBooks.map((b) => b.title),
    reason: raw.reason,
    searchQueries: raw.searchQueries?.length ? raw.searchQueries : [raw.reason],
  };
}

export interface CouncilRunResult {
  librarian: LibrarianResult;
  perspectives: AuthorAdvice[];
  synthesis: ModeratorSynthesis;
}

export interface CouncilDependencies {
  getAuthors?: () => Promise<AuthorRecord[]>;
  getBooks?: () => Promise<BookRecord[]>;
  getChunks?: (authorId: string) => Promise<ChunkRecord[]>;
  callJson?: <T>(
    settings: AppSettings,
    options: {
      systemInstruction: string;
      prompt: string;
      jsonSchema?: Record<string, unknown>;
      temperature?: number;
    },
  ) => Promise<T>;
}

export async function runBookCouncilPipeline(
  userQuery: string,
  settings: AppSettings,
  onProgress?: (p: PipelineProgress) => void,
  deps: CouncilDependencies = {},
): Promise<CouncilRunResult> {
  if (!deps.callJson && !isLLMConfigured(settings)) {
    throw new Error(
      'No LLM provider configured. Open Settings to enter a Gemini API key or connect Local Ollama.',
    );
  }

  const callJson = deps.callJson ?? generateLLMJson;
  const authors = await (deps.getAuthors ?? getAllAuthors)();
  const books = await (deps.getBooks ?? getAllBooks)();

  if (books.length === 0 || authors.length === 0) {
    throw new Error('Your library is empty. Upload at least one EPUB or PDF in My Library first.');
  }

  // 1. LIBRARIAN AGENT: Intent Abstraction & Author/Book Routing
  onProgress?.({
    stage: 'librarian',
    detail: 'Librarian is abstracting your core strategic intent & inspecting author indexes...',
  });

  const catalog = buildCatalogPrompt(authors, books);
  const librarianRaw = await callJson<LibrarianResult>(settings, {
    systemInstruction: `You are the Librarian (Router & Intent Analyzer) of a personal Book Council.
Your job:
1. Read the user's scenario (which may include pasted messages, emails, or personal dilemmas).
2. Abstract the underlying strategic, psychological, or practical problem/intent rather than matching surface keywords.
3. Inspect the user's indexed Authors and Books below. Select between 0 and 4 most relevant Authors (strictly <= 4 to preserve API budget) whose books genuinely provide frameworks for this scenario.
4. For each selected Author, specify the exact bookId(s) and bookTitle(s) that apply, and craft 2-4 targeted search queries representing relevant concepts from those books.
5. If NO book in the library genuinely addresses the scenario, return selectedAuthors: [] and explain why in noMatchReason.`,
    prompt: `USER SCENARIO:\n"""\n${userQuery}\n"""\n\nINDEXED LIBRARY CATALOG:\n${catalog}`,
    jsonSchema: LIBRARIAN_SCHEMA,
    temperature: 0.2,
  });

  const resolvedSelections: LibrarianSelection[] = [];
  const seenAuthorIds = new Set<string>();
  for (const sel of librarianRaw.selectedAuthors ?? []) {
    if (resolvedSelections.length >= 4) break;
    const resolved = resolveAuthorSelection(sel, authors, books);
    if (resolved && !seenAuthorIds.has(resolved.authorId)) {
      seenAuthorIds.add(resolved.authorId);
      resolvedSelections.push(resolved);
    }
  }

  const librarian: LibrarianResult = {
    abstractedIntent: librarianRaw.abstractedIntent || 'Strategic guidance on the user scenario',
    problemDomain: librarianRaw.problemDomain || 'Advisory',
    selectedAuthors: resolvedSelections,
    noMatchReason: librarianRaw.noMatchReason,
  };

  if (resolvedSelections.length === 0) {
    const synthesis: ModeratorSynthesis = {
      consensusType: 'uncovered',
      headline: 'Outside Your Current Library',
      uncoveredExplanation:
        librarian.noMatchReason ||
        `None of the books currently indexed in your library provide frameworks tailored to "${librarian.abstractedIntent}". Try uploading relevant books in My Library.`,
    };
    onProgress?.({ stage: 'done', detail: 'Council deliberation complete.' });
    return { librarian, perspectives: [], synthesis };
  }

  // 2. AUTHOR PERSONA AGENTS
  const perspectives: AuthorAdvice[] = [];

  for (let i = 0; i < resolvedSelections.length; i++) {
    const sel = resolvedSelections[i];
    const author = authors.find((a) => a.id === sel.authorId)!;
    const targetBooks = books.filter((b) => sel.bookIds.includes(b.id));
    const bookTitleMap = new Map(targetBooks.map((b) => [b.id, b.title]));

    onProgress?.({
      stage: 'retrieving',
      detail: `Retrieving passages from ${sel.authorName}'s books (${sel.bookTitles.join(', ')})...`,
      activeAuthorName: sel.authorName,
      completedAuthors: i,
      totalAuthors: resolvedSelections.length,
    });

    const authorChunks = await (deps.getChunks ?? getChunksForAuthor)(sel.authorId);
    const queries = [userQuery, librarian.abstractedIntent, ...sel.searchQueries];
    const topMatches = hybridSearchChunks(authorChunks, queries, {
      bookIds: sel.bookIds,
      topK: targetBooks.length > 1 ? 8 : 6,
    });

    if (topMatches.length === 0) {
      perspectives.push({
        authorId: sel.authorId,
        authorName: sel.authorName,
        booksConsulted: sel.bookTitles,
        retrievedChunksCount: 0,
        abstained: true,
        abstentionReason: `No relevant passages were retrieved from ${sel.bookTitles.join(', ')} for this specific dilemma.`,
        advice: '',
        citations: [],
      });
      continue;
    }

    onProgress?.({
      stage: 'authors',
      detail: `${sel.authorName} is formulating personalized advice (${i + 1}/${resolvedSelections.length})...`,
      activeAuthorName: sel.authorName,
      completedAuthors: i,
      totalAuthors: resolvedSelections.length,
    });

    const passagesBlock = topMatches
      .map((m, idx) => {
        const bTitle = bookTitleMap.get(m.chunk.bookId) || sel.bookTitles[0] || 'Book';
        const pageTag =
          m.chunk.pageStart !== undefined
            ? m.chunk.pageEnd && m.chunk.pageEnd !== m.chunk.pageStart
              ? ` | pp. ${m.chunk.pageStart}-${m.chunk.pageEnd}`
              : ` | p. ${m.chunk.pageStart}`
            : '';
        return `[Excerpt ${idx + 1} | Book: "${bTitle}" | Chapter/Section: "${m.chunk.chapter}"${pageTag}]\n${m.chunk.text}`;
      })
      .join('\n\n');

    const toneGuidance =
      targetBooks.map((b) => b.profile?.authorTone).filter(Boolean).join(' ') ||
      author.toneSummary ||
      'Authentic, insightful, and grounded in your books.';

    const authorResponse = await callJson<{
      abstained: boolean;
      abstentionReason?: string;
      advice: string;
      citations: { bookTitle: string; chapterOrConcept: string }[];
    }>(settings, {
      systemInstruction: `You are ${sel.authorName}, acting as a personal AI Advisor grounded STRICTLY in the books you wrote.
Voice & Communication Style: ${toneGuidance}

STRICT RULES:
1. Respond in FIRST PERSON ("I", "my framework", "here is how I would approach your situation") adopting ${sel.authorName}'s authentic voice, mental models, and philosophy.
2. Ground EVERY claim strictly in the provided book excerpts below. NEVER use outside general knowledge or external facts not supported by these excerpts.
3. Do NOT output verbatim quotes or copy sentences from the excerpts; paraphrase, synthesize, and apply your concepts directly and practically to the user's personal scenario.
4. Include exact citations listing the Book Title(s) and Chapter/Concept(s) used.
5. STRICT ABSTENTION: If none of the provided excerpts genuinely contain a relevant framework or guidance for the user's specific problem, set "abstained": true and briefly explain why in "abstentionReason" instead of fabricating advice.`,
      prompt: `USER SCENARIO:\n"""\n${userQuery}\n"""\n\nABSTRACTED STRATEGIC INTENT: ${librarian.abstractedIntent}\nROUTING REASON: ${sel.reason}\n\nRETRIEVED EXCERPTS FROM YOUR BOOKS (${sel.bookTitles.join(', ')}):\n${passagesBlock}`,
      jsonSchema: AUTHOR_SCHEMA,
      temperature: 0.45,
    });

    perspectives.push({
      authorId: sel.authorId,
      authorName: sel.authorName,
      booksConsulted: sel.bookTitles,
      retrievedChunksCount: topMatches.length,
      abstained: Boolean(authorResponse.abstained),
      abstentionReason: authorResponse.abstentionReason,
      advice: authorResponse.abstained ? '' : authorResponse.advice,
      citations: Array.isArray(authorResponse.citations) ? authorResponse.citations : [],
    });
  }

  const activePerspectives = perspectives.filter((p) => !p.abstained && p.advice.trim().length > 0);

  if (activePerspectives.length === 0) {
    const synthesis: ModeratorSynthesis = {
      consensusType: 'uncovered',
      headline: 'No Applicable Frameworks Found in Your Library',
      uncoveredExplanation:
        'The consulted authors reviewed the relevant passages from their books and abstained because none of their indexed chapters directly address this specific scenario.',
    };
    onProgress?.({ stage: 'done', detail: 'Council deliberation complete.' });
    return { librarian, perspectives, synthesis };
  }

  // 3. MODERATOR / SYNTHESIZER AGENT
  onProgress?.({
    stage: 'moderator',
    detail: 'Moderator is synthesizing the council perspectives...',
  });

  const perspectivesSummary = activePerspectives
    .map(
      (p) =>
        `AUTHOR: ${p.authorName}\nBOOKS: ${p.booksConsulted.join(', ')}\nADVICE:\n${p.advice}\nCITATIONS: ${p.citations
          .map((c) => `${c.bookTitle} (${c.chapterOrConcept})`)
          .join('; ')}`,
    )
    .join('\n\n---\n\n');

  const moderatorRaw = await callJson<ModeratorSynthesis>(settings, {
    systemInstruction: `You are the Moderator & Synthesizer of the user's Book Council.
Review all active Author Advisor responses below (do NOT add external advice outside what these authors provided):
- If the authors fundamentally AGREE or complement one another cleanly (including when only 1 author responded): set consensusType = "aligned" and write "unifiedPlan": a single, cohesive, actionable step-by-step game plan weaving their guidance together, explicitly attributing each recommendation to its Author and Book Title.
- If the authors DISAGREE or offer meaningfully distinct philosophies/trade-offs: set consensusType = "divergent" and populate "options": a structured list of distinct strategic options clearly labeled by Author, Book(s), Approach Title, Summary, and Action Steps so the user can choose which philosophy fits them best.`,
    prompt: `USER SCENARIO:\n"""\n${userQuery}\n"""\n\nABSTRACTED INTENT: ${librarian.abstractedIntent}\n\nACTIVE AUTHOR PERSPECTIVES:\n${perspectivesSummary}`,
    jsonSchema: MODERATOR_SCHEMA,
    temperature: 0.3,
  });

  onProgress?.({ stage: 'done', detail: 'Council deliberation complete.' });

  return {
    librarian,
    perspectives,
    synthesis: {
      consensusType:
        moderatorRaw.consensusType === 'divergent'
          ? 'divergent'
          : moderatorRaw.consensusType === 'uncovered'
            ? 'uncovered'
            : 'aligned',
      headline: moderatorRaw.headline || 'Council Recommendation',
      unifiedPlan: moderatorRaw.unifiedPlan,
      options: Array.isArray(moderatorRaw.options) ? moderatorRaw.options : undefined,
      uncoveredExplanation: moderatorRaw.uncoveredExplanation,
    },
  };
}
