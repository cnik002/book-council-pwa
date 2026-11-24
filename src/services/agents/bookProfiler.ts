import type { AppSettings, BookProfile, ChunkRecord } from '../../types';
import { generateLLMJson, isLLMConfigured } from '../llm/llmClient';

const BOOK_PROFILE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    coreTopics: {
      type: 'array',
      items: { type: 'string' },
      description: '5 to 8 core topics and themes explored in the book.',
    },
    frameworks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['name', 'description'],
      },
      description: '4 to 7 signature mental models, principles, or frameworks from the book.',
    },
    problemsSolved: {
      type: 'array',
      items: { type: 'string' },
      description: '5 to 8 real-life dilemmas or challenges this book equips the reader to solve.',
    },
    authorTone: {
      type: 'string',
      description:
        'Concise description of the author voice, rhetorical style, worldview, and advising manner.',
    },
    summary: {
      type: 'string',
      description: '2 to 3 sentence synthesis of the book thesis and practical orientation.',
    },
  },
  required: ['coreTopics', 'frameworks', 'problemsSolved', 'authorTone', 'summary'],
};

function selectRepresentativeChunks(chunks: ChunkRecord[], maxSamples = 8): ChunkRecord[] {
  if (chunks.length <= maxSamples) return chunks;
  const indices = new Set<number>([0, 1]);
  const step = (chunks.length - 1) / (maxSamples - 1);
  for (let i = 1; i < maxSamples - 1; i++) {
    indices.add(Math.round(i * step));
  }
  indices.add(chunks.length - 1);
  return Array.from(indices)
    .sort((a, b) => a - b)
    .slice(0, maxSamples)
    .map((idx) => chunks[idx]);
}

/**
 * Generates a lightweight offline profile from chunk metadata and top terms
 * when no LLM provider is configured yet.
 */
export function buildHeuristicBookProfile(
  title: string,
  author: string,
  chunks: ChunkRecord[],
): BookProfile {
  const globalTf = new Map<string, number>();
  const chapters: string[] = [];

  for (const c of chunks) {
    if (c.chapter && !chapters.includes(c.chapter) && chapters.length < 8) {
      chapters.push(c.chapter);
    }
    for (const [term, count] of Object.entries(c.tf)) {
      if (term.length >= 4) {
        globalTf.set(term, (globalTf.get(term) ?? 0) + count);
      }
    }
  }

  const topTerms = Array.from(globalTf.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([term]) => term);

  return {
    coreTopics: topTerms.length > 0 ? topTerms : [title],
    frameworks: chapters.slice(0, 5).map((ch) => ({
      name: ch,
      description: `Indexed section from "${title}" (connect Gemini or Ollama to extract full AI framework analysis).`,
    })),
    problemsSolved: topTerms.slice(0, 5).map((t) => `Questions involving ${t}`),
    authorTone: `Grounded in the prose and chapter structure of ${author}'s "${title}".`,
    summary: `Indexed "${title}" by ${author} across ${chunks.length} searchable segments. Generate an AI profile in My Library for deeper routing metadata.`,
  };
}

export async function generateBookProfile(
  title: string,
  author: string,
  chunks: ChunkRecord[],
  settings: AppSettings,
): Promise<{ profile: BookProfile; aiGenerated: boolean }> {
  if (!isLLMConfigured(settings)) {
    return {
      profile: buildHeuristicBookProfile(title, author, chunks),
      aiGenerated: false,
    };
  }

  const samples = selectRepresentativeChunks(chunks, 8);
  const excerptBlock = samples
    .map(
      (c, i) =>
        `--- Sample ${i + 1} [${c.chapter}${c.pageStart ? `, p.${c.pageStart}` : ''}] ---\n${c.text.slice(0, 1100)}`,
    )
    .join('\n\n');

  const prompt = `Analyze this book using ONLY the provided excerpts and metadata.

Book Title: "${title}"
Author: ${author}
Total Indexed Chunks: ${chunks.length}

Excerpts across the book:
${excerptBlock}

Return JSON capturing:
1. coreTopics: 5-8 core topics/themes addressed by the book.
2. frameworks: 4-7 named mental models, laws, principles, or actionable frameworks explicitly presented in the book (each with name and 1-sentence description).
3. problemsSolved: 5-8 real-life personal, professional, interpersonal, or strategic problems this book helps solve.
4. authorTone: 2-3 sentences describing the author's voice, tone, and communication style based on these excerpts.
5. summary: 2-3 sentence overview of the book's central thesis.`;

  const profile = await generateLLMJson<BookProfile>(settings, {
    systemInstruction:
      'You are an expert literary indexer building structured advisory metadata for a personal book library. Base your output strictly on the provided excerpts.',
    prompt,
    jsonSchema: BOOK_PROFILE_SCHEMA,
    temperature: 0.2,
  });

  return {
    profile: {
      coreTopics: Array.isArray(profile.coreTopics) ? profile.coreTopics : [],
      frameworks: Array.isArray(profile.frameworks) ? profile.frameworks : [],
      problemsSolved: Array.isArray(profile.problemsSolved) ? profile.problemsSolved : [],
      authorTone: profile.authorTone || `Voice of ${author}`,
      summary: profile.summary || `Indexed "${title}" by ${author}.`,
    },
    aiGenerated: true,
  };
}
