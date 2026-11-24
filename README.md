# Book Council — Personal AI Advisory Council PWA

Turn your personal **EPUB** and **PDF** library into an AI Advisory Council where each **Author** becomes a dedicated AI Advisor Persona grounded strictly in the books they wrote.

## Key Features

- **100% Client-Side Book Ingestion:** Parses `.epub` (`jszip` + `DOMParser`) and `.pdf` (`pdfjs-dist`) in your browser, splits text into overlapping chunks with chapter/page metadata, and persists everything in **IndexedDB**.
- **Author-Centric Grouping:** Normalizes author names (e.g., `"Clear, James"` and `"James Clear"`) into a single Author Persona managing separate indexes across all of their books. Includes metadata editing & automatic re-grouping.
- **Multi-Agent Council Pipeline:**
  1. **Librarian Agent:** Abstracts the underlying strategic intent of your scenario and routes to 1–4 relevant Authors and their applicable books.
  2. **Author Persona Agents:** Retrieves relevant passages via hybrid BM25/TF-IDF + keyword + bigram scoring and speaks in first-person without verbatim quotes, citing exact Book Title(s) & Chapter/Concept(s), or strictly abstaining when ungrounded.
  3. **Moderator / Synthesizer Agent:** Combines aligned advice into a unified game plan or presents divergent author philosophies as structured options.
- **Dual LLM Support:**
  - **Cloud (Default):** Google Gemini API (`gemini-4-hydrogen` / `gemini-3.5-flash-lite`) via `@google/genai` with exponential backoff & jitter on rate limits.
  - **Local Fallback:** Ollama (`http://localhost:11434/api/chat`) with selectable models (`gemma3`, `llama3.2`, etc.).
- **Device Sync & PWA:** Export/Import your full library + council history as JSON, and install to Home Screen on iOS, Android, or Desktop.

## Local Development

```bash
npm install
npm run dev
```

Run tests and production build:

```bash
npm test
npm run build
```

### Using Local Ollama with the PWA

If running the app from GitHub Pages (or another origin), start Ollama with browser CORS enabled:

```bash
OLLAMA_ORIGINS="*" ollama serve
```

## GitHub Pages Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which runs tests, builds the Vite bundle (`base: '/book-council-pwa/'`), and deploys to GitHub Pages.

In your GitHub repository **Settings → Pages**, set **Source** to **GitHub Actions**.
