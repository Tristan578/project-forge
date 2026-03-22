import { GoogleGenerativeAI } from '@google/generative-ai';
import type { DocEntry } from './docsIndex';
import { AI_MODELS } from '@/lib/ai/models';

export interface SemanticChunk {
  path: string;
  title: string;
  section: string;
  content: string;
  embedding: number[];
}

export interface SemanticIndex {
  chunks: SemanticChunk[];
}

export interface SearchResult {
  path: string;
  title: string;
  section: string;
  snippet: string;
  similarity: number;
}

const EMBEDDING_MODEL = AI_MODELS.embedding;
const DEFAULT_TOP_K = 5;

/** Compute cosine similarity between two equal-length vectors */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;

  return dot / denom;
}

/** Generate an embedding vector for the given text using Google AI */
export async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_AI_API_KEY environment variable is not set');
  }

  const client = new GoogleGenerativeAI(apiKey);
  const model = client.getGenerativeModel({ model: EMBEDDING_MODEL });
  const result = await model.embedContent(text);
  return result.embedding.values;
}

/** Chunk a doc into its title + each section */
function chunkDoc(doc: DocEntry): Array<{ section: string; content: string }> {
  const chunks: Array<{ section: string; content: string }> = [];

  // One chunk for the full doc title + intro (content before first section).
  // We find the intro boundary by locating the first section's heading in the
  // raw content, rather than using indexOf(section.content), which has two bugs:
  // - PF-458: indexOf("") returns 0 when section content is empty, dropping all intro text
  // - PF-443: indexOf returns -1 when section content isn't a direct substring,
  //   causing slice(0, -1) to lose the last character of the intro
  let introContent: string;

  if (doc.sections.length > 0) {
    let introEnd = -1;
    for (const section of doc.sections) {
      // Look for the section heading as a markdown heading line.
      // Check longest prefixes first to avoid partial matches.
      for (const prefix of ['#### ', '### ', '## ']) {
        const pos = doc.content.indexOf(`${prefix}${section.heading}`);
        if (pos !== -1) {
          introEnd = pos;
          break;
        }
      }
      if (introEnd !== -1) break;
    }

    introContent = introEnd > 0
      ? doc.content.slice(0, introEnd)
      : introEnd === -1
        ? doc.content  // No heading found — treat entire content as intro
        : '';          // Heading at position 0 — no intro
  } else {
    introContent = doc.content;
  }

  if (introContent.trim().length > 0) {
    chunks.push({ section: doc.title, content: `${doc.title}\n\n${introContent.trim()}` });
  } else {
    chunks.push({ section: doc.title, content: doc.title });
  }

  // One chunk per section
  for (const section of doc.sections) {
    if (section.content.trim().length > 0) {
      chunks.push({
        section: section.heading,
        content: `${section.heading}\n\n${section.content.trim()}`,
      });
    }
  }

  return chunks;
}

/**
 * Build a semantic index by embedding each chunk of every doc.
 * This calls the Google AI API and should be cached — avoid calling on every request.
 */
export async function buildSemanticIndex(docs: DocEntry[]): Promise<SemanticIndex> {
  const chunks: SemanticChunk[] = [];

  for (const doc of docs) {
    const docChunks = chunkDoc(doc);
    for (const chunk of docChunks) {
      const embedding = await generateEmbedding(chunk.content);
      chunks.push({
        path: doc.path,
        title: doc.title,
        section: chunk.section,
        content: chunk.content,
        embedding,
      });
    }
  }

  return { chunks };
}

/**
 * Semantic search: embed query and rank chunks by cosine similarity.
 * Returns the top-K results sorted by descending similarity.
 */
export async function semanticSearch(
  query: string,
  index: SemanticIndex,
  topK: number = DEFAULT_TOP_K
): Promise<SearchResult[]> {
  if (index.chunks.length === 0) return [];

  const queryEmbedding = await generateEmbedding(query);

  const scored = index.chunks.map((chunk) => ({
    chunk,
    similarity: cosineSimilarity(queryEmbedding, chunk.embedding),
  }));

  scored.sort((a, b) => b.similarity - a.similarity);

  return scored.slice(0, topK).map(({ chunk, similarity }) => ({
    path: chunk.path,
    title: chunk.title,
    section: chunk.section,
    snippet: chunk.content.slice(0, 200).replace(/\n/g, ' ').trim(),
    similarity: Math.round(similarity * 10000) / 10000,
  }));
}
