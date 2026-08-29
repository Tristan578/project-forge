import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLASS_SPECS,
  LOOKUP_LABEL,
  RECURRENCE_CAP,
  REPORT_CLASSES,
  RUNS_HEADING,
  appendRecurrence,
  buildIssueBody,
  buildRecurrenceComment,
  findLegacyIssues,
  findMatchingIssue,
  isRecurrenceComment,
  markerFor,
  normalizeClass,
  recurrenceMarkerFor,
  reportFailure,
} from './pitr-report-failure.mjs';

const NOW = () => Date.parse('2026-09-01T08:00:00Z');
const TODAY = '2026-09-01';
const RUN_URL = 'https://github.com/Tristan578/project-forge/actions/runs/999';

// Assert on the whole rendered entry line rather than searching the body for a
// URL substring: an exact line match is the stronger assertion (it pins the
// date and the separator too) and does not read as URL sanitisation.
function hasRunEntry(body, date, runUrl) {
  return String(body).split('\n').includes(`- ${date} \u2014 ${runUrl}`);
}

function makeEnv(overrides = {}) {
  return {
    GITHUB_TOKEN: 'ghs_test',
    GITHUB_REPOSITORY: 'Tristan578/project-forge',
    GITHUB_RUN_ID: '999',
    GITHUB_SERVER_URL: 'https://github.com',
    PITR_FAILURE_CLASS: 'config',
    HOURS_AGO: '24',
    ...overrides,
  };
}

/**
 * Minimal GitHub REST double. Routes by method + pathname; records every call
 * so tests can assert on what was NOT sent (the dedupe property) as well as
 * what was.
 */
function makeGithub({ issues = [], comments = {} } = {}) {
  const calls = [];
  const fetchFn = async (url, init) => {
    const u = new URL(url);
    const p = u.pathname;
    const method = init.method;
    const page = Number(u.searchParams.get('page') ?? '1');
    calls.push({
      method,
      path: p,
      search: u.search,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    });
    const json = (obj, status = 200) => ({
      ok: status < 400,
      status,
      statusText: '',
      text: async () => JSON.stringify(obj),
    });

    let m;
    if (method === 'GET' && (m = p.match(/\/issues\/(\d+)\/comments$/))) {
      return json(page === 1 ? (comments[Number(m[1])] ?? []) : []);
    }
    if (method === 'GET' && p.endsWith('/issues')) {
      return json(page === 1 ? issues : []);
    }
    if (method === 'POST' && p.match(/\/issues\/(\d+)\/comments$/)) {
      return json({ id: 4242 });
    }
    if (method === 'POST' && p.endsWith('/issues')) {
      return json({ number: 5001 });
    }
    if (method === 'PATCH' && p.match(/\/issues\/comments\/(\d+)$/)) {
      return json({ id: 4242 });
    }
    if (method === 'PATCH' && p.match(/\/issues\/(\d+)$/)) {
      return json({ number: 1 });
    }
    return json({ message: `unrouted ${method} ${p}` }, 500);
  };
  const of = (method, re) => calls.filter(c => c.method === method && re.test(c.path));
  return { fetchFn, calls, of };
}

function issue(overrides) {
  return {
    number: 1,
    title: 'x',
    state: 'open',
    body: '',
    updated_at: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

describe('normalizeClass', () => {
  for (const cls of REPORT_CLASSES) {
    test(`passes through known class "${cls}"`, () => {
      assert.equal(normalizeClass(cls), cls);
    });
  }

  test('is case- and whitespace-insensitive', () => {
    assert.equal(normalizeClass('  CONFIG '), 'config');
  });

  test('empty string becomes unknown, never a real class', () => {
    assert.equal(normalizeClass(''), 'unknown');
  });

  test('undefined becomes unknown', () => {
    assert.equal(normalizeClass(undefined), 'unknown');
  });

  test('unrecognized value becomes unknown, not infra', () => {
    assert.equal(normalizeClass('transient'), 'unknown');
  });
});

describe('CLASS_SPECS', () => {
  test('every class has a distinct title', () => {
    const titles = REPORT_CLASSES.map(c => CLASS_SPECS[c].title);
    assert.equal(new Set(titles).size, titles.length);
  });

  test('every class has a distinct runbook anchor', () => {
    const books = REPORT_CLASSES.map(c => CLASS_SPECS[c].runbook);
    assert.equal(new Set(books).size, books.length);
  });

  test('every class carries the lookup label so dedupe can find it', () => {
    for (const cls of REPORT_CLASSES) {
      assert.ok(
        CLASS_SPECS[cls].labels.includes(LOOKUP_LABEL),
        `class ${cls} is missing the ${LOOKUP_LABEL} lookup label`,
      );
    }
  });

  test('ONLY the pitr class is labelled disaster-recovery', () => {
    for (const cls of REPORT_CLASSES) {
      const labelled = CLASS_SPECS[cls].labels.includes('disaster-recovery');
      assert.equal(labelled, cls === 'pitr', `class ${cls} disaster-recovery label is wrong`);
    }
  });

  test('config class points at the configuration runbook, not the recovery one', () => {
    assert.match(CLASS_SPECS.config.runbook, /#triage-configuration-fault$/);
    assert.doesNotMatch(CLASS_SPECS.config.runbook, /pitr-restore/);
  });
});

describe('buildIssueBody', () => {
  const args = { runUrl: RUN_URL, hoursAgo: '24', date: TODAY };

  test('config body carries the class marker and forbids data recovery', () => {
    const body = buildIssueBody({ cls: 'config', ...args });
    assert.ok(body.includes(markerFor('config')));
    assert.match(body, /Do NOT run the data-recovery procedure/);
    assert.match(body, /#triage-configuration-fault/);
    assert.doesNotMatch(body, /#triage-pitr-restore-fault/);
  });

  test('config body says no backup was tested', () => {
    const body = buildIssueBody({ cls: 'config', ...args });
    assert.match(body, /no backup was tested/);
  });

  test('pitr body points at the restore runbook and does not forbid recovery', () => {
    const body = buildIssueBody({ cls: 'pitr', ...args });
    assert.ok(body.includes(markerFor('pitr')));
    assert.match(body, /#triage-pitr-restore-fault/);
    assert.doesNotMatch(body, /Do NOT run the data-recovery procedure/);
  });

  test('records the run URL under the recurrence heading', () => {
    const body = buildIssueBody({ cls: 'infra', ...args });
    assert.ok(body.includes(RUNS_HEADING));
    assert.ok(body.includes(`- ${TODAY} — ${RUN_URL}`));
  });

  test('lists superseded legacy issues when given', () => {
    const body = buildIssueBody({ cls: 'config', ...args, supersedes: [9036, 8881] });
    assert.match(body, /Superseded reports/);
    assert.match(body, /#9036, #8881/);
  });

  test('omits the superseded section when there are none', () => {
    const body = buildIssueBody({ cls: 'config', ...args, supersedes: [] });
    assert.doesNotMatch(body, /Superseded reports/);
  });
});

describe('findMatchingIssue', () => {
  test('prefers an open issue over a closed one', () => {
    const open = issue({ number: 10, state: 'open', body: markerFor('config') });
    const closed = issue({ number: 11, state: 'closed', body: markerFor('config') });
    assert.equal(findMatchingIssue([closed, open], 'config').number, 10);
  });

  test('returns the most recently updated closed issue when none are open', () => {
    const older = issue({
      number: 11,
      state: 'closed',
      body: markerFor('config'),
      updated_at: '2026-01-01T00:00:00Z',
    });
    const newer = issue({
      number: 12,
      state: 'closed',
      body: markerFor('config'),
      updated_at: '2026-07-01T00:00:00Z',
    });
    assert.equal(findMatchingIssue([older, newer], 'config').number, 12);
  });

  test('sorts an issue with an unparseable updated_at last, not unpredictably', () => {
    const dated = issue({
      number: 21,
      state: 'closed',
      body: markerFor('config'),
      updated_at: '2026-01-01T00:00:00Z',
    });
    const undated = issue({
      number: 22,
      state: 'closed',
      body: markerFor('config'),
      updated_at: 'not-a-date',
    });
    const missing = issue({
      number: 23,
      state: 'closed',
      body: markerFor('config'),
      updated_at: undefined,
    });
    // Both argument orders must agree: a NaN comparator would not guarantee that.
    assert.equal(findMatchingIssue([undated, dated], 'config').number, 21);
    assert.equal(findMatchingIssue([dated, undated], 'config').number, 21);
    assert.equal(findMatchingIssue([missing, dated], 'config').number, 21);
    assert.equal(findMatchingIssue([dated, missing], 'config').number, 21);
  });

  test('does not match a different failure class', () => {
    const other = issue({ number: 13, body: markerFor('pitr') });
    assert.equal(findMatchingIssue([other], 'config'), null);
  });

  test('ignores pull requests carrying the marker', () => {
    const pr = issue({ number: 14, body: markerFor('config'), pull_request: { url: 'x' } });
    assert.equal(findMatchingIssue([pr], 'config'), null);
  });

  test('returns null for an empty list', () => {
    assert.equal(findMatchingIssue([], 'config'), null);
  });
});

describe('findLegacyIssues', () => {
  test('matches the pre-fix dated generic title, newest first', () => {
    const list = [
      issue({ number: 8881, title: 'PITR verification failed (2026-07-01)' }),
      issue({ number: 9036, title: 'PITR verification failed (2026-08-01)' }),
    ];
    assert.deepEqual(findLegacyIssues(list), [9036, 8881]);
  });

  test('excludes issues that already carry a class marker', () => {
    const list = [
      issue({
        number: 1,
        title: 'PITR verification failed (2026-08-01)',
        body: markerFor('config'),
      }),
    ];
    assert.deepEqual(findLegacyIssues(list), []);
  });

  test('excludes unrelated titles', () => {
    assert.deepEqual(findLegacyIssues([issue({ number: 2, title: 'Something else' })]), []);
  });
});

describe('recurrence comments', () => {
  test('isRecurrenceComment matches its own class only', () => {
    const c = { body: buildRecurrenceComment({ cls: 'config', runUrl: RUN_URL, date: TODAY }) };
    assert.equal(isRecurrenceComment(c, 'config'), true);
    assert.equal(isRecurrenceComment(c, 'pitr'), false);
  });

  test('isRecurrenceComment is false for a human comment', () => {
    assert.equal(isRecurrenceComment({ body: 'looking into it' }, 'config'), false);
  });

  test('isRecurrenceComment tolerates a missing comment', () => {
    assert.equal(isRecurrenceComment(undefined, 'config'), false);
  });

  test('buildRecurrenceComment carries the class marker and the run URL', () => {
    const body = buildRecurrenceComment({ cls: 'infra', runUrl: RUN_URL, date: TODAY });
    assert.ok(body.includes(recurrenceMarkerFor('infra')));
    assert.ok(hasRunEntry(body, TODAY, RUN_URL), 'records the run as a dated entry');
  });
});

describe('appendRecurrence', () => {
  test('appends a new run under the existing heading', () => {
    const base = buildRecurrenceComment({ cls: 'config', runUrl: RUN_URL, date: TODAY });
    const next = appendRecurrence(base, {
      runUrl: 'https://example.test/runs/1000',
      date: '2026-10-01',
    });
    assert.ok(hasRunEntry(next, TODAY, RUN_URL), 'keeps the original entry');
    assert.ok(
      hasRunEntry(next, '2026-10-01', 'https://example.test/runs/1000'),
      'adds the new entry',
    );
  });

  test('is idempotent for a run URL already recorded', () => {
    const base = buildRecurrenceComment({ cls: 'config', runUrl: RUN_URL, date: TODAY });
    assert.equal(appendRecurrence(base, { runUrl: RUN_URL, date: TODAY }), base);
  });

  test('keeps only the newest `cap` entries', () => {
    let body = buildRecurrenceComment({ cls: 'config', runUrl: 'https://r/0', date: '2026-01-01' });
    for (let i = 1; i <= RECURRENCE_CAP + 5; i += 1) {
      body = appendRecurrence(body, { runUrl: `https://r/${i}`, date: '2026-01-01' });
    }
    const entries = body.split('\n').filter(l => l.startsWith('- '));
    assert.equal(entries.length, RECURRENCE_CAP);
    assert.ok(body.includes(`https://r/${RECURRENCE_CAP + 5}`));
    assert.ok(!hasRunEntry(body, '2026-01-01', 'https://r/0'), 'evicted the oldest entry');
  });

  test('does not mistake a run id that is a prefix of a recorded one', () => {
    const long = 'https://github.com/Tristan578/project-forge/actions/runs/999';
    const short = 'https://github.com/Tristan578/project-forge/actions/runs/99';
    const base = buildRecurrenceComment({ cls: 'config', runUrl: long, date: TODAY });
    const next = appendRecurrence(base, { runUrl: short, date: '2026-10-01' });
    assert.ok(hasRunEntry(next, TODAY, long), 'keeps the longer run');
    assert.ok(hasRunEntry(next, '2026-10-01', short), 'records the shorter run too');
  });

  test('adds the heading when the body has none', () => {
    const next = appendRecurrence('plain text', { runUrl: RUN_URL, date: TODAY });
    assert.ok(next.includes(RUNS_HEADING));
    assert.ok(hasRunEntry(next, TODAY, RUN_URL), 'records the run under the new heading');
  });
});

describe('reportFailure — input validation', () => {
  test('rejects a missing GITHUB_TOKEN', async () => {
    const { fetchFn } = makeGithub();
    await assert.rejects(
      reportFailure({ fetchFn, env: makeEnv({ GITHUB_TOKEN: undefined }), now: NOW }),
      /GITHUB_TOKEN is required/,
    );
  });

  test('rejects a malformed GITHUB_REPOSITORY', async () => {
    const { fetchFn } = makeGithub();
    await assert.rejects(
      reportFailure({ fetchFn, env: makeEnv({ GITHUB_REPOSITORY: 'nope' }), now: NOW }),
      /owner\/name/,
    );
  });

  test('surfaces a GitHub API error rather than reporting silently', async () => {
    const fetchFn = async () => ({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: async () => 'no perms',
    });
    await assert.rejects(reportFailure({ fetchFn, env: makeEnv(), now: NOW }), /403/);
  });
});

describe('reportFailure — first report', () => {
  test('a config failure opens a config issue, not a data-recovery one', async () => {
    const gh = makeGithub({ issues: [] });
    const res = await reportFailure({ fetchFn: gh.fetchFn, env: makeEnv(), now: NOW });
    assert.equal(res.action, 'created');
    assert.equal(res.cls, 'config');
    const [post] = gh.of('POST', /\/issues$/);
    assert.equal(post.body.title, CLASS_SPECS.config.title);
    assert.deepEqual(post.body.labels, CLASS_SPECS.config.labels);
    assert.ok(!post.body.labels.includes('disaster-recovery'));
    assert.match(post.body.body, /Do NOT run the data-recovery procedure/);
    assert.match(post.body.body, /#triage-configuration-fault/);
  });

  test('a pitr failure opens a disaster-recovery issue', async () => {
    const gh = makeGithub({ issues: [] });
    const res = await reportFailure({
      fetchFn: gh.fetchFn,
      env: makeEnv({ PITR_FAILURE_CLASS: 'pitr' }),
      now: NOW,
    });
    assert.equal(res.cls, 'pitr');
    const [post] = gh.of('POST', /\/issues$/);
    assert.equal(post.body.title, CLASS_SPECS.pitr.title);
    assert.ok(post.body.labels.includes('disaster-recovery'));
    assert.match(post.body.body, /#triage-pitr-restore-fault/);
  });

  test('an absent class is reported as unclassified, never as config or infra', async () => {
    const gh = makeGithub({ issues: [] });
    const res = await reportFailure({
      fetchFn: gh.fetchFn,
      env: makeEnv({ PITR_FAILURE_CLASS: '' }),
      now: NOW,
    });
    assert.equal(res.cls, 'unknown');
    const [post] = gh.of('POST', /\/issues$/);
    assert.equal(post.body.title, CLASS_SPECS.unknown.title);
  });

  test('links the pre-fix duplicate issues instead of editing them', async () => {
    const gh = makeGithub({
      issues: [
        issue({ number: 9036, title: 'PITR verification failed (2026-08-01)' }),
        issue({ number: 8881, title: 'PITR verification failed (2026-07-01)' }),
      ],
    });
    const res = await reportFailure({ fetchFn: gh.fetchFn, env: makeEnv(), now: NOW });
    assert.deepEqual(res.supersedes, [9036, 8881]);
    const [post] = gh.of('POST', /\/issues$/);
    assert.match(post.body.body, /#9036, #8881/);
    assert.equal(gh.of('PATCH', /\/issues\/\d+$/).length, 0);
  });

  test('the run URL is built from the server, repo and run id', async () => {
    const gh = makeGithub({ issues: [] });
    await reportFailure({ fetchFn: gh.fetchFn, env: makeEnv({ GITHUB_RUN_ID: '777' }), now: NOW });
    const [post] = gh.of('POST', /\/issues$/);
    assert.match(post.body.body, /actions\/runs\/777/);
  });
});

describe('reportFailure — dedupe', () => {
  test('does NOT open a second issue when a matching one is already open', async () => {
    const gh = makeGithub({
      issues: [issue({ number: 42, state: 'open', body: markerFor('config') })],
      comments: { 42: [] },
    });
    const res = await reportFailure({ fetchFn: gh.fetchFn, env: makeEnv(), now: NOW });
    assert.equal(res.action, 'commented');
    assert.equal(res.number, 42);
    assert.equal(gh.of('POST', /\/issues$/).length, 0, 'must not create a duplicate issue');
    assert.equal(gh.of('POST', /\/issues\/42\/comments$/).length, 1);
  });

  test('matches only its own class — a pitr failure does not land on the config issue', async () => {
    const gh = makeGithub({
      issues: [issue({ number: 42, state: 'open', body: markerFor('config') })],
    });
    const res = await reportFailure({
      fetchFn: gh.fetchFn,
      env: makeEnv({ PITR_FAILURE_CLASS: 'pitr' }),
      now: NOW,
    });
    assert.equal(res.action, 'created');
    assert.equal(gh.of('POST', /\/issues\/42\/comments$/).length, 0);
  });

  test('reopens a closed matching issue instead of opening a new one', async () => {
    const gh = makeGithub({
      issues: [issue({ number: 43, state: 'closed', body: markerFor('config') })],
      comments: { 43: [] },
    });
    const res = await reportFailure({ fetchFn: gh.fetchFn, env: makeEnv(), now: NOW });
    assert.equal(res.reopened, true);
    assert.equal(gh.of('POST', /\/issues$/).length, 0);
    const [patch] = gh.of('PATCH', /\/issues\/43$/);
    assert.equal(patch.body.state, 'open');
  });

  test('updates the last recurrence comment rather than adding another', async () => {
    const existing = buildRecurrenceComment({
      cls: 'config',
      runUrl: 'https://github.com/o/r/actions/runs/1',
      date: '2026-08-01',
    });
    const gh = makeGithub({
      issues: [issue({ number: 44, state: 'open', body: markerFor('config') })],
      comments: { 44: [{ id: 900, body: existing }] },
    });
    const res = await reportFailure({ fetchFn: gh.fetchFn, env: makeEnv(), now: NOW });
    assert.equal(res.action, 'comment-updated');
    assert.equal(gh.of('POST', /\/issues\/44\/comments$/).length, 0, 'must not spam a new comment');
    const [patch] = gh.of('PATCH', /\/issues\/comments\/900$/);
    assert.ok(patch.body.body.includes('actions/runs/1'), 'keeps the earlier run');
    assert.ok(patch.body.body.includes('actions/runs/999'), 'records this run');
  });

  test('adds a fresh comment when the last comment is a human reply', async () => {
    const gh = makeGithub({
      issues: [issue({ number: 45, state: 'open', body: markerFor('config') })],
      comments: {
        45: [
          { id: 900, body: buildRecurrenceComment({ cls: 'config', runUrl: 'x', date: '2026-08-01' }) },
          { id: 901, body: 'I am looking at the secret now' },
        ],
      },
    });
    const res = await reportFailure({ fetchFn: gh.fetchFn, env: makeEnv(), now: NOW });
    assert.equal(res.action, 'commented');
    assert.equal(gh.of('PATCH', /\/issues\/comments\/\d+$/).length, 0);
  });

  test('re-running the reporting step for the same run changes nothing', async () => {
    const existing = buildRecurrenceComment({ cls: 'config', runUrl: RUN_URL, date: TODAY });
    const gh = makeGithub({
      issues: [issue({ number: 46, state: 'open', body: markerFor('config') })],
      comments: { 46: [{ id: 902, body: existing }] },
    });
    const res = await reportFailure({ fetchFn: gh.fetchFn, env: makeEnv(), now: NOW });
    assert.equal(res.action, 'noop');
    assert.equal(gh.of('PATCH', /\/issues\/comments\/\d+$/).length, 0);
    assert.equal(gh.of('POST', /\/issues\/46\/comments$/).length, 0);
    assert.equal(gh.of('POST', /\/issues$/).length, 0);
  });

  test('looks issues up by the shared label, including closed ones', async () => {
    const gh = makeGithub({ issues: [] });
    await reportFailure({ fetchFn: gh.fetchFn, env: makeEnv(), now: NOW });
    const [list] = gh.of('GET', /\/issues$/);
    assert.match(list.search, /state=all/);
    assert.match(list.search, new RegExp(`labels=${LOOKUP_LABEL}`));
  });
});
