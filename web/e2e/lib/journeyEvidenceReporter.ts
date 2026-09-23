/**
 * Playwright reporter that writes the `journey-evidence` artifact (#10157).
 *
 * For every test tagged {@link JOURNEY_TAG} in the run it collects each
 * attempt's `journey-evidence` attachment (the record the journey fixture
 * attached) and its trace and video, then writes:
 *
 *   <outputDir>/index.json                        every journey-tagged test the
 *                                                 run selected, and where its
 *                                                 record is (or why there is none)
 *   <outputDir>/<slug>/evidence.json              the folded record — see
 *                                                 `buildJourneyEvidence`
 *   <outputDir>/<slug>/attempt-<n>/trace.zip      copied from test-results/
 *   <outputDir>/<slug>/attempt-<n>/<video>.webm
 *
 * It never decides pass or fail: `scripts/check-journey-evidence.ts` reads the
 * index afterwards and does. The index lists the tests from the run's own
 * suite, so a journey test whose attempts attached no record still appears —
 * with a problem instead of a record — and the check fails on it.
 *
 * The directory is emptied in `onBegin`, so a record left by an earlier local
 * run can never stand in for this one (lessons-learned #8).
 *
 * Registered in `playwright.engine.config.ts`.
 */
import fs from 'node:fs';
import path from 'node:path';
import type {
  FullConfig,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import {
  JOURNEY_ANNOTATION_TYPE,
  JOURNEY_EVIDENCE_ATTACHMENT,
  JOURNEY_EVIDENCE_SCHEMA_VERSION,
  JOURNEY_TAG,
  buildJourneyEvidence,
  evidenceSlug,
  specPath,
  zJourneyEvidenceIndex,
  type JourneyEvidenceIndex,
  type JourneyTestIdentity,
  type ReportedAttempt,
} from './journeyEvidence';

/** Default output directory, relative to the Playwright config's directory. */
export const DEFAULT_JOURNEY_EVIDENCE_DIR = 'journey-evidence';

export interface JourneyEvidenceReporterOptions {
  /** Relative to the config file's directory; must stay inside it. */
  outputDir?: string;
}

interface RawAttempt {
  retry: number;
  status: TestResult['status'];
  recordTexts: string[];
  tracePath: string | null;
  videoPaths: string[];
}

/** The journey id a test declares statically, for a readable directory name. */
function declaredJourneyId(test: TestCase): string | null {
  return test.annotations.find((a) => a.type === JOURNEY_ANNOTATION_TYPE)?.description ?? null;
}

export default class JourneyEvidenceReporter implements Reporter {
  private outputDir = '';
  private baseDir = '';
  private journeyTests: TestCase[] = [];
  private readonly attempts = new Map<string, RawAttempt[]>();

  constructor(private readonly options: JourneyEvidenceReporterOptions = {}) {}

  printsToStdio(): boolean {
    return false;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    this.baseDir = config.configFile ? path.dirname(config.configFile) : config.rootDir;
    this.outputDir = path.resolve(this.baseDir, this.options.outputDir ?? DEFAULT_JOURNEY_EVIDENCE_DIR);
    const rel = path.relative(this.baseDir, this.outputDir);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(
        `[journeyEvidenceReporter] outputDir ${this.outputDir} must be inside ${this.baseDir}; ` +
          'refusing to empty a directory the reporter does not own',
      );
    }
    fs.rmSync(this.outputDir, { recursive: true, force: true });
    this.journeyTests = suite.allTests().filter((t) => t.tags.includes(JOURNEY_TAG));
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (!test.tags.includes(JOURNEY_TAG)) return;
    const recordTexts: string[] = [];
    let tracePath: string | null = null;
    const videoPaths: string[] = [];
    for (const a of result.attachments) {
      if (a.name === JOURNEY_EVIDENCE_ATTACHMENT) {
        if (a.body) recordTexts.push(a.body.toString('utf8'));
        else if (a.path) recordTexts.push(fs.readFileSync(a.path, 'utf8'));
      } else if (a.name === 'trace' && a.path) {
        tracePath = a.path;
      } else if (a.name === 'video' && a.path) {
        videoPaths.push(a.path);
      }
    }
    const list = this.attempts.get(test.id) ?? [];
    list.push({ retry: result.retry, status: result.status, recordTexts, tracePath, videoPaths });
    this.attempts.set(test.id, list);
  }

  async onEnd(): Promise<void> {
    await fs.promises.mkdir(this.outputDir, { recursive: true });
    const index: JourneyEvidenceIndex = {
      schemaVersion: JOURNEY_EVIDENCE_SCHEMA_VERSION,
      kind: 'journey-evidence-index',
      tag: JOURNEY_TAG,
      generatedAt: new Date().toISOString(),
      tests: [],
    };

    for (const test of this.journeyTests) {
      const identity = this.identify(test);
      const slug = evidenceSlug(declaredJourneyId(test), test.id);
      const reported: ReportedAttempt[] = [];
      for (const raw of this.attempts.get(test.id) ?? []) {
        const attemptDir = `${slug}/attempt-${raw.retry}`;
        reported.push({
          retry: raw.retry,
          status: raw.status,
          recordTexts: raw.recordTexts,
          trace: raw.tracePath ? await this.copy(raw.tracePath, `${attemptDir}/trace.zip`) : null,
          video: (
            await Promise.all(raw.videoPaths.map((v) => this.copy(v, `${attemptDir}/${path.basename(v)}`)))
          ).filter((v): v is string => v !== null),
        });
      }
      const built = buildJourneyEvidence(identity, reported);
      if (built.ok) {
        const rel = `${slug}/evidence.json`;
        await fs.promises.mkdir(path.join(this.outputDir, slug), { recursive: true });
        await fs.promises.writeFile(path.join(this.outputDir, rel), `${JSON.stringify(built.evidence, null, 2)}\n`);
        index.tests.push({ test: identity, evidence: rel, problem: null });
      } else {
        index.tests.push({ test: identity, evidence: null, problem: built.problem });
      }
    }

    await fs.promises.writeFile(
      path.join(this.outputDir, 'index.json'),
      `${JSON.stringify(zJourneyEvidenceIndex.parse(index), null, 2)}\n`,
    );
  }

  private identify(test: TestCase): JourneyTestIdentity {
    // titlePath(): ['', <project>, <file relative to testDir>, ...describes, title]
    // — the same tail `testInfo.titlePath` gives the fixture.
    const titlePath = test.titlePath().slice(2);
    return {
      id: test.id,
      title: titlePath.slice(1).join(' › '),
      titlePath,
      file: specPath(this.baseDir, test.location.file),
      project: test.parent.project()?.name ?? '',
    };
  }

  /** Copy an artifact into the evidence dir; null when the source is gone. */
  private async copy(source: string, rel: string): Promise<string | null> {
    try {
      const dest = path.join(this.outputDir, rel);
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await fs.promises.copyFile(source, dest);
      return rel;
    } catch {
      return null;
    }
  }
}
