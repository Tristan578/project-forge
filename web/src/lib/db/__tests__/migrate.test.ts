import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockNeon = vi.fn().mockReturnValue('mock-sql-fn');
const mockDrizzle = vi.fn().mockReturnValue('mock-db');
const mockMigrate = vi.fn();

vi.mock('@neondatabase/serverless', () => ({
  neon: mockNeon,
}));

vi.mock('drizzle-orm/neon-http', () => ({
  drizzle: mockDrizzle,
}));

vi.mock('drizzle-orm/neon-http/migrator', () => ({
  migrate: mockMigrate,
}));

describe('db/migrate', () => {
  const originalExit = process.exit;
  const exitCodes: number[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    exitCodes.length = 0;
    // Record exit calls without throwing — avoids unhandled rejection from top-level async
    // @ts-expect-error - mocking process.exit
    process.exit = vi.fn((code: number) => {
      exitCodes.push(code);
    });
  });

  afterEach(() => {
    process.exit = originalExit;
  });

  it('exits with code 1 when DATABASE_URL is not set', async () => {
    const savedUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await import('../migrate');
    await vi.waitFor(() => {
      expect(exitCodes).toContain(1);
    });
    expect(consoleSpy).toHaveBeenCalledWith(
      'ERROR: DATABASE_URL environment variable is not set.'
    );
    consoleSpy.mockRestore();
    if (savedUrl) process.env.DATABASE_URL = savedUrl;
  });

  it('runs migrations successfully', async () => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost/testdb';
    mockMigrate.mockResolvedValue(undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await import('../migrate');
    await vi.waitFor(() => {
      expect(mockMigrate).toHaveBeenCalledTimes(1);
    });

    expect(mockNeon).toHaveBeenCalledWith('postgres://test:test@localhost/testdb');
    expect(mockDrizzle).toHaveBeenCalledWith('mock-sql-fn');
    expect(mockMigrate).toHaveBeenCalledWith('mock-db', {
      migrationsFolder: './drizzle',
    });
    expect(logSpy).toHaveBeenCalledWith('Running database migrations...');
    expect(logSpy).toHaveBeenCalledWith('Migrations completed successfully.');
    expect(exitCodes).toHaveLength(0);

    logSpy.mockRestore();
    delete process.env.DATABASE_URL;
  });

  it('exits with code 1 when migration fails', async () => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost/testdb';
    const migrationError = new Error('migration syntax error');
    mockMigrate.mockRejectedValue(migrationError);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await import('../migrate');
    await vi.waitFor(() => {
      expect(exitCodes).toContain(1);
    });

    expect(errorSpy).toHaveBeenCalledWith('Migration failed:', migrationError);

    errorSpy.mockRestore();
    logSpy.mockRestore();
    delete process.env.DATABASE_URL;
  });
});
