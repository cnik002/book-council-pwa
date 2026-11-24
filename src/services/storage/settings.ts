import type { AppSettings } from '../../types';

const SETTINGS_KEY = 'book_council_settings_v1';

export const GEMINI_MODELS = [
  {
    id: 'gemini-4-hydrogen',
    label: 'Gemini 4 Hydrogen (Recommended)',
    note: 'Fast, balanced frontier intelligence',
  },
  {
    id: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash-Lite (Fastest / Low Quota)',
    note: 'Lowest latency & highest throughput',
  },
  {
    id: 'gemini-4-argon',
    label: 'Gemini 4 Argon (Deep Reasoning)',
    note: 'Efficient frontier reasoning',
  },
];

export const OLLAMA_SUGGESTED_MODELS = ['gemma3', 'llama3.2', 'qwen2.5', 'mistral'];

export const DEFAULT_SETTINGS: AppSettings = {
  provider: 'gemini',
  geminiApiKey: '',
  geminiModel: 'gemini-4-hydrogen',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'gemma3',
  theme: 'dark',
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
