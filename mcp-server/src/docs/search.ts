/**
 * Full-text keyword search engine for documentation.
 * Uses TF-IDF-style relevance scoring with no external dependencies.
 */

import type { DocIndex, DocEntry, DocSection, TopicMeta } from './loader.js';

export interface SearchResult {
  /** Document path (e.g. "features/physics") */
  path: string;
  /** Document title */
  title: string;
  /** Relevance score (higher = more relevant) */
  score: number;
  /** Matching section heading (if match is in a section) */
  matchSection?: string;
  /** Snippet of matching text */
  snippet: string;
}

interface TermIndex {
  /** term → { docPath → frequency } */
  termFreqs: Map<string, Map<string, number>>;
  /** docPath → total term count */
  docLengths: Map<string, number>;
  /** Total number of documents */
  docCount: number;
}

/**
 * Tokenize text into lowercase terms, removing markdown syntax and punctuation.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    // Remove markdown syntax
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_|>\-=~]/g, ' ')
    // Remove punctuation
    .replace(/[^\w\s]/g, ' ')
    // Split on whitespace
    .split(/\s+/)
    .filter(t => t.length > 1);
}

/**
 * Build a term frequency index from all documents and their metadata.
 */
export function buildIndex(docIndex: DocIndex): TermIndex {
  const termFreqs = new Map<string, Map<string, number>>();
  const docLengths = new Map<string, number>();

  for (const [path, doc] of docIndex.docs) {
    const meta = docIndex.meta.get(path);

    // Tokenize document content
    const contentTerms = tokenize(doc.content);

    // Add tag terms with a boost (count each tag multiple times)
    const tagTerms: string[] = [];
    if (meta?.tags) {
      for (const tag of meta.tags) {
        const tagTokens = tokenize(tag);
        // Tags get 3x boost
        for (let i = 0; i < 3; i++) {
          tagTerms.push(...tagTokens);
        }
      }
    }

    // Title terms get 2x boost
    const titleTerms = tokenize(doc.title);
    const boostedTitleTerms: string[] = [];
    for (let i = 0; i < 2; i++) {
      boostedTitleTerms.push(...titleTerms);
    }

    const allTerms = [...contentTerms, ...tagTerms, ...boostedTitleTerms];
    docLengths.set(path, allTerms.length);

    for (const term of allTerms) {
      let docFreqs = termFreqs.get(term);
      if (!docFreqs) {
        docFreqs = new Map<string, number>();
        termFreqs.set(term, docFreqs);
      }
      docFreqs.set(path, (docFreqs.get(path) ?? 0) + 1);
    }
  }

  return {
    termFreqs,
    docLengths,
    docCount: docIndex.docs.size,
  };
}

/**
 * Extract a snippet from the document near the first occurrence of any query term.
 */
function extractSnippet(doc: DocEntry, queryTerms: string[], maxLength: number = 200): string {
  const lowerContent = doc.content.toLowerCase();
  let bestPos = -1;

  // Find the earliest occurrence of any query term
  for (const term of queryTerms) {
    const pos = lowerContent.indexOf(term);
    if (pos !== -1 && (bestPos === -1 || pos < bestPos)) {
      bestPos = pos;
    }
  }

  if (bestPos === -1) {
    // No direct match found — return the start of the content
    return doc.content.slice(0, maxLength).replace(/\n/g, ' ').trim() + '...';
  }

  // Extract a window around the match
  const start = Math.max(0, bestPos - 40);
  const end = Math.min(doc.content.length, bestPos + maxLength - 40);
  let snippet = doc.content.slice(start, end).replace(/\n/g, ' ').trim();

  if (start > 0) snippet = '...' + snippet;
  if (end < doc.content.length) snippet = snippet + '...';

  return snippet;
}

/**
 * Find which section a query term appears in.
 */
function findMatchSection(doc: DocEntry, queryTerms: string[]): string | undefined {
  for (const section of doc.sections) {
    const lowerContent = section.content.toLowerCase();
    const lowerHeading = section.heading.toLowerCase();
    for (const term of queryTerms) {
      if (lowerContent.includes(term) || lowerHeading.includes(term)) {
        return section.heading;
      }
    }
  }
  return undefined;
}

/**
 * Search documents using TF-IDF scoring.
 */
export function search(
  query: string,
  docIndex: DocIndex,
  termIndex: TermIndex,
  maxResults: number = 10
): SearchResult[] {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  const scores = new Map<string, number>();

  // Average document length for BM25-style normalization
  let totalLength = 0;
  for (const len of termIndex.docLengths.values()) {
    totalLength += len;
  }
  const avgLength = totalLength / Math.max(termIndex.docCount, 1);

  for (const term of queryTerms) {
    const docFreqs = termIndex.termFreqs.get(term);
    if (!docFreqs) continue;

    // IDF: log(N / df)
    const idf = Math.log((termIndex.docCount + 1) / (docFreqs.size + 0.5));

    for (const [docPath, tf] of docFreqs) {
      const docLen = termIndex.docLengths.get(docPath) ?? 1;

      // BM25-style TF normalization
      const k1 = 1.2;
      const b = 0.75;
      const normalizedTf = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / avgLength)));

      const termScore = normalizedTf * idf;
      scores.set(docPath, (scores.get(docPath) ?? 0) + termScore);
    }
  }

  // Sort by score descending
  const results: SearchResult[] = [];
  const sortedEntries = [...scores.entries()].sort((a, b) => b[1] - a[1]);

  for (const [path, score] of sortedEntries.slice(0, maxResults)) {
    const doc = docIndex.docs.get(path);
    if (!doc) continue;

    results.push({
      path,
      title: doc.title,
      score: Math.round(score * 100) / 100,
      matchSection: findMatchSection(doc, queryTerms),
      snippet: extractSnippet(doc, queryTerms),
    });
  }

  return results;
}
