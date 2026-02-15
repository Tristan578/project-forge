import type { DocEntry } from './docsIndex';

export interface SearchResult {
  path: string;
  title: string;
  score: number;
  matchSection?: string;
  snippet: string;
}

interface TermIndex {
  /** term → { docIndex → frequency } */
  termFreqs: Map<string, Map<number, number>>;
  /** docIndex → total term count */
  docLengths: number[];
  docCount: number;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_|>\-=~]/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

export function buildClientIndex(docs: DocEntry[]): TermIndex {
  const termFreqs = new Map<string, Map<number, number>>();
  const docLengths: number[] = [];

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const contentTerms = tokenize(doc.content);
    const titleTerms = tokenize(doc.title);
    // Title gets 2x boost
    const allTerms = [...contentTerms, ...titleTerms, ...titleTerms];
    docLengths.push(allTerms.length);

    for (const term of allTerms) {
      let docFreqs = termFreqs.get(term);
      if (!docFreqs) {
        docFreqs = new Map<number, number>();
        termFreqs.set(term, docFreqs);
      }
      docFreqs.set(i, (docFreqs.get(i) ?? 0) + 1);
    }
  }

  return { termFreqs, docLengths, docCount: docs.length };
}

function extractSnippet(content: string, queryTerms: string[], maxLength: number = 200): string {
  const lower = content.toLowerCase();
  let bestPos = -1;

  for (const term of queryTerms) {
    const pos = lower.indexOf(term);
    if (pos !== -1 && (bestPos === -1 || pos < bestPos)) {
      bestPos = pos;
    }
  }

  if (bestPos === -1) {
    return content.slice(0, maxLength).replace(/\n/g, ' ').trim() + '...';
  }

  const start = Math.max(0, bestPos - 40);
  const end = Math.min(content.length, bestPos + maxLength - 40);
  let snippet = content.slice(start, end).replace(/\n/g, ' ').trim();

  if (start > 0) snippet = '...' + snippet;
  if (end < content.length) snippet = snippet + '...';

  return snippet;
}

export function searchDocs(
  query: string,
  docs: DocEntry[],
  index: TermIndex,
  maxResults: number = 10
): SearchResult[] {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  const scores = new Map<number, number>();

  let totalLength = 0;
  for (const len of index.docLengths) totalLength += len;
  const avgLength = totalLength / Math.max(index.docCount, 1);

  for (const term of queryTerms) {
    const docFreqs = index.termFreqs.get(term);
    if (!docFreqs) continue;

    const idf = Math.log((index.docCount + 1) / (docFreqs.size + 0.5));

    for (const [docIdx, tf] of docFreqs) {
      const docLen = index.docLengths[docIdx] ?? 1;
      const k1 = 1.2;
      const b = 0.75;
      const normalizedTf = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / avgLength)));
      const termScore = normalizedTf * idf;
      scores.set(docIdx, (scores.get(docIdx) ?? 0) + termScore);
    }
  }

  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const results: SearchResult[] = [];

  for (const [docIdx, score] of sorted.slice(0, maxResults)) {
    const doc = docs[docIdx];
    if (!doc) continue;

    // Find matching section
    let matchSection: string | undefined;
    for (const section of doc.sections) {
      const lower = section.content.toLowerCase() + ' ' + section.heading.toLowerCase();
      if (queryTerms.some((t) => lower.includes(t))) {
        matchSection = section.heading;
        break;
      }
    }

    results.push({
      path: doc.path,
      title: doc.title,
      score: Math.round(score * 100) / 100,
      matchSection,
      snippet: extractSnippet(doc.content, queryTerms),
    });
  }

  return results;
}
