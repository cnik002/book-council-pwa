export type FileType = 'epub' | 'pdf';

export type BookStatus = 'parsing' | 'profiling' | 'ready' | 'error';

export interface BookFramework {
  name: string;
  description: string;
}

export interface BookProfile {
  coreTopics: string[];
  frameworks: BookFramework[];
  problemsSolved: string[];
  authorTone: string;
  summary: string;
}

export interface AuthorRecord {
  id: string;
  name: string;
  normalizedKey: string;
  aliases: string[];
  toneSummary: string;
  bookCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface BookRecord {
  id: string;
  authorId: string;
  title: string;
  originalAuthor: string;
  fileName: string;
  fileType: FileType;
  totalChunks: number;
  totalWords: number;
  profile?: BookProfile;
  status: BookStatus;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChunkRecord {
  id: string;
  bookId: string;
  authorId: string;
  index: number;
  chapter: string;
  pageStart?: number;
  pageEnd?: number;
  text: string;
  wordCount: number;
  tf: Record<string, number>;
}

export type LLMProvider = 'gemini' | 'ollama';
export type ThemeMode = 'dark' | 'light' | 'system';

export interface AppSettings {
  provider: LLMProvider;
  geminiApiKey: string;
  geminiModel: string;
  ollamaUrl: string;
  ollamaModel: string;
  theme: ThemeMode;
}

export interface LibrarianSelection {
  authorId: string;
  authorName: string;
  bookIds: string[];
  bookTitles: string[];
  reason: string;
  searchQueries: string[];
}

export interface LibrarianResult {
  abstractedIntent: string;
  problemDomain: string;
  selectedAuthors: LibrarianSelection[];
  noMatchReason?: string;
}

export interface AuthorCitation {
  bookTitle: string;
  chapterOrConcept: string;
}

export interface AuthorAdvice {
  authorId: string;
  authorName: string;
  booksConsulted: string[];
  retrievedChunksCount: number;
  abstained: boolean;
  abstentionReason?: string;
  advice: string;
  citations: AuthorCitation[];
}

export interface DivergentOption {
  authorName: string;
  bookTitles: string[];
  approachTitle: string;
  summary: string;
  actionSteps: string[];
}

export interface ModeratorSynthesis {
  consensusType: 'aligned' | 'divergent' | 'uncovered';
  headline: string;
  unifiedPlan?: string;
  options?: DivergentOption[];
  uncoveredExplanation?: string;
}

export interface CouncilMessage {
  id: string;
  role: 'user' | 'council';
  content: string;
  timestamp: number;
  librarian?: LibrarianResult;
  perspectives?: AuthorAdvice[];
  synthesis?: ModeratorSynthesis;
  error?: string;
}

export interface CouncilConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: CouncilMessage[];
}

export interface LibraryBackupPayload {
  schemaVersion: 1;
  exportedAt: number;
  authors: AuthorRecord[];
  books: BookRecord[];
  chunks: ChunkRecord[];
  conversations?: CouncilConversation[];
}

export type PipelineStage =
  | 'idle'
  | 'librarian'
  | 'retrieving'
  | 'authors'
  | 'moderator'
  | 'done'
  | 'error';

export interface PipelineProgress {
  stage: PipelineStage;
  detail: string;
  activeAuthorName?: string;
  completedAuthors?: number;
  totalAuthors?: number;
}
