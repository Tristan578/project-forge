import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FailedRefund } from '../refundQueue';

// We need to stub localStorage before importing the module under test because
// the module reads from localStorage at call time (not at import time).
const localStorageStore: Record<string, string> = {};

const mockLocalStorage = {
  getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageStore[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete localStorageStore[key];
  }),
  clear: vi.fn(() => {
    for (const k of Object.keys(localStorageStore)) delete localStorageStore[k];
  }),
  get length() {
    return Object.keys(localStorageStore).length;
  },
  key: vi.fn((index: number) => Object.keys(localStorageStore)[index] ?? null),
};

vi.stubGlobal('localStorage', mockLocalStorage);

// Also stub fetch for processFailedRefunds tests
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after stubs are in place
import {
  enqueueFailedRefund,
  getFailedRefunds,
  removeFailedRefund,
  processFailedRefunds,
} from '../refundQueue';

const STORAGE_KEY = 'forge-failed-refunds';

function makeRefund(jobId: string, overrides?: Partial<FailedRefund>): FailedRefund {
  return { jobId, provider: 'meshy', amount: 100, timestamp: 1000, ...overrides };
}

beforeEach(() => {
  mockLocalStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('enqueueFailedRefund', () => {
  it('adds an entry to an empty queue', () => {
    enqueueFailedRefund(makeRefund('job-1'));
    const queue = getFailedRefunds();
    expect(queue).toHaveLength(1);
    expect(queue[0].jobId).toBe('job-1');
  });

  it('appends to an existing queue', () => {
    enqueueFailedRefund(makeRefund('job-1'));
    enqueueFailedRefund(makeRefund('job-2'));
    const queue = getFailedRefunds();
    expect(queue).toHaveLength(2);
    expect(queue[1].jobId).toBe('job-2');
  });

  it('evicts the oldest entry (FIFO) when max capacity (50) is reached', () => {
    // Fill the queue to exactly 50
    for (let i = 0; i < 50; i++) {
      enqueueFailedRefund(makeRefund(`job-${i}`));
    }

    // Adding one more should evict job-0
    enqueueFailedRefund(makeRefund('job-overflow'));

    const queue = getFailedRefunds();
    expect(queue).toHaveLength(50);
    expect(queue.find((r) => r.jobId === 'job-0')).toBeUndefined();
    expect(queue[queue.length - 1].jobId).toBe('job-overflow');
  });

  it('handles corrupted localStorage gracefully', () => {
    localStorageStore[STORAGE_KEY] = 'not-valid-json{{';
    expect(() => enqueueFailedRefund(makeRefund('job-1'))).not.toThrow();
    const queue = getFailedRefunds();
    // Corrupted data is treated as empty; the new entry is the only one
    expect(queue).toHaveLength(1);
  });
});

describe('getFailedRefunds', () => {
  it('returns an empty array when nothing is queued', () => {
    expect(getFailedRefunds()).toEqual([]);
  });

  it('returns all queued entries without removing them', () => {
    enqueueFailedRefund(makeRefund('job-1'));
    enqueueFailedRefund(makeRefund('job-2'));
    expect(getFailedRefunds()).toHaveLength(2);
    // Calling again still returns them
    expect(getFailedRefunds()).toHaveLength(2);
  });
});

describe('removeFailedRefund', () => {
  it('removes the matching entry by jobId', () => {
    enqueueFailedRefund(makeRefund('job-1'));
    enqueueFailedRefund(makeRefund('job-2'));
    removeFailedRefund('job-1');
    const queue = getFailedRefunds();
    expect(queue).toHaveLength(1);
    expect(queue[0].jobId).toBe('job-2');
  });

  it('does nothing if the jobId is not in the queue', () => {
    enqueueFailedRefund(makeRefund('job-1'));
    removeFailedRefund('nonexistent');
    expect(getFailedRefunds()).toHaveLength(1);
  });
});

describe('processFailedRefunds', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('does nothing when the queue is empty', async () => {
    await processFailedRefunds();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calls the refund API for each queued entry', async () => {
    enqueueFailedRefund(makeRefund('job-1'));
    enqueueFailedRefund(makeRefund('job-2'));

    mockFetch.mockResolvedValue({ ok: true });

    const promise = processFailedRefunds();
    await vi.runAllTimersAsync();
    await promise;

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('removes entries from the queue on successful refund', async () => {
    enqueueFailedRefund(makeRefund('job-1'));
    enqueueFailedRefund(makeRefund('job-2'));

    mockFetch.mockResolvedValue({ ok: true });

    const promise = processFailedRefunds();
    await vi.runAllTimersAsync();
    await promise;

    expect(getFailedRefunds()).toHaveLength(0);
  });

  it('keeps failed entries in the queue when the API call fails', async () => {
    enqueueFailedRefund(makeRefund('job-1'));
    enqueueFailedRefund(makeRefund('job-2'));

    mockFetch.mockRejectedValue(new Error('Network error'));

    const promise = processFailedRefunds();
    await vi.runAllTimersAsync();
    await promise;

    // Both entries should still be in the queue
    expect(getFailedRefunds()).toHaveLength(2);
  });

  it('removes successful entries and keeps failed ones', async () => {
    enqueueFailedRefund(makeRefund('job-1'));
    enqueueFailedRefund(makeRefund('job-2'));

    mockFetch
      .mockResolvedValueOnce({ ok: true })    // job-1 succeeds
      .mockRejectedValue(new Error('fail'));   // job-2 fails

    const promise = processFailedRefunds();
    await vi.runAllTimersAsync();
    await promise;

    const queue = getFailedRefunds();
    expect(queue).toHaveLength(1);
    expect(queue[0].jobId).toBe('job-2');
  });
});
