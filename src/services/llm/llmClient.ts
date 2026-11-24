import { GoogleGenAI } from '@google/genai';
import type { AppSettings } from '../../types';

export interface LLMCallOptions {
  systemInstruction: string;
  prompt: string;
  jsonSchema?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
}

export class LLMError extends Error {
  status?: number;
  isRateLimit: boolean;

  constructor(message: string, status?: number, isRateLimit = false) {
    super(message);
    this.name = 'LLMError';
    this.status = status;
    this.isRateLimit = isRateLimit;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(err: unknown): { retryable: boolean; status?: number; message: string } {
  const msg = err instanceof Error ? err.message : String(err);
  const status =
    typeof err === 'object' && err !== null && 'status' in err
      ? Number((err as { status?: unknown }).status)
      : undefined;

  const lower = msg.toLowerCase();
  const retryable =
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    lower.includes('429') ||
    lower.includes('rate limit') ||
    lower.includes('resource_exhausted') ||
    lower.includes('quota') ||
    lower.includes('temporarily unavailable') ||
    lower.includes('overloaded');

  return { retryable, status, message: msg };
}

/**
 * Extracts valid JSON from raw LLM text, stripping markdown code fences if present.
 */
export function extractJsonFromText<T = unknown>(raw: string): T {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // Strip ```json ... ``` fences
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) {
      return JSON.parse(fenced[1].trim()) as T;
    }
    // Locate outermost JSON object or array
    const firstObj = trimmed.indexOf('{');
    const lastObj = trimmed.lastIndexOf('}');
    if (firstObj !== -1 && lastObj > firstObj) {
      return JSON.parse(trimmed.slice(firstObj, lastObj + 1)) as T;
    }
    throw new Error('Model did not return valid JSON.');
  }
}

async function callGemini(settings: AppSettings, options: LLMCallOptions): Promise<string> {
  const apiKey = settings.geminiApiKey.trim();
  if (!apiKey) {
    throw new LLMError(
      'Gemini API key is missing. Add your free Google AI Studio key in Settings, or switch to Local Ollama.',
    );
  }

  const ai = new GoogleGenAI({ apiKey });
  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const interaction = await ai.interactions.create({
        model: settings.geminiModel || 'gemini-4-hydrogen',
        input: options.prompt,
        system_instruction: options.systemInstruction,
        store: false,
        generation_config: {
          temperature: options.temperature ?? 0.4,
          ...(options.maxOutputTokens ? { max_output_tokens: options.maxOutputTokens } : {}),
        },
        ...(options.jsonSchema
          ? {
              response_format: {
                type: 'text' as const,
                mime_type: 'application/json' as const,
                schema: options.jsonSchema,
              },
            }
          : {}),
      });

      const text = interaction.output_text?.trim();
      if (!text) {
        throw new LLMError('Gemini returned an empty response.');
      }
      return text;
    } catch (err) {
      const info = isRetryableError(err);
      if (info.retryable && attempt < maxAttempts) {
        const baseDelay = 1500 * Math.pow(2, attempt - 1);
        const jitter = Math.floor(Math.random() * 600);
        await sleep(baseDelay + jitter);
        continue;
      }
      throw new LLMError(
        info.retryable
          ? `Gemini rate limit / temporary error after ${attempt} attempts: ${info.message}. Try switching to Gemini 3.5 Flash-Lite or Local Ollama in Settings.`
          : `Gemini API error: ${info.message}`,
        info.status,
        info.status === 429 || info.message.toLowerCase().includes('rate'),
      );
    }
  }

  throw new LLMError('Gemini request failed.');
}

async function callOllama(settings: AppSettings, options: LLMCallOptions): Promise<string> {
  const baseUrl = (settings.ollamaUrl || 'http://localhost:11434').replace(/\/+$/, '');
  const model = settings.ollamaModel || 'gemma3';

  const systemContent = options.jsonSchema
    ? `${options.systemInstruction}\n\nIMPORTANT: Respond ONLY with valid JSON matching the requested schema. Do not include markdown fences or commentary.`
    : options.systemInstruction;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        ...(options.jsonSchema ? { format: 'json' } : {}),
        options: {
          temperature: options.temperature ?? 0.4,
        },
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: options.prompt },
        ],
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new LLMError(
      `Could not connect to Ollama at ${baseUrl}. Ensure Ollama is running and OLLAMA_ORIGINS="*" is enabled for browser access. (${msg})`,
    );
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new LLMError(
      `Ollama error (${response.status}): ${errText || response.statusText}`,
      response.status,
    );
  }

  const data = (await response.json()) as {
    message?: { content?: string };
    response?: string;
  };
  const content = (data.message?.content ?? data.response ?? '').trim();
  if (!content) {
    throw new LLMError('Ollama returned an empty response.');
  }
  return content;
}

export async function generateLLMText(
  settings: AppSettings,
  options: LLMCallOptions,
): Promise<string> {
  if (settings.provider === 'ollama') {
    return callOllama(settings, options);
  }
  return callGemini(settings, options);
}

export async function generateLLMJson<T>(
  settings: AppSettings,
  options: LLMCallOptions,
): Promise<T> {
  const raw = await generateLLMText(settings, options);
  return extractJsonFromText<T>(raw);
}

export async function testLLMConnection(settings: AppSettings): Promise<{ ok: boolean; message: string }> {
  try {
    const reply = await generateLLMText(settings, {
      systemInstruction: 'Reply with a single short sentence confirming connectivity.',
      prompt: 'Respond with: Ready.',
      temperature: 0,
      maxOutputTokens: 32,
    });
    return {
      ok: true,
      message:
        settings.provider === 'ollama'
          ? `Connected to Ollama (${settings.ollamaModel}): "${reply.slice(0, 60)}"`
          : `Connected to Gemini (${settings.geminiModel}): "${reply.slice(0, 60)}"`,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export function isLLMConfigured(settings: AppSettings): boolean {
  if (settings.provider === 'ollama') {
    return Boolean(settings.ollamaUrl.trim() && settings.ollamaModel.trim());
  }
  return Boolean(settings.geminiApiKey.trim());
}
