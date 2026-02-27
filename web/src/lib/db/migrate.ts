import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';

/**
 * Run all pending Drizzle migrations against the database.
 *
 * Usage:
 *   npx tsx src/lib/db/migrate.ts
 *
 * Requires DATABASE_URL to be set in the environment.
 * Migrations are read from the ./drizzle directory (relative to web/).
 */
async function runMigrations() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is not set.');
    process.exit(1);
  }

  console.log('Running database migrations...');

  const sql = neon(databaseUrl);
  const db = drizzle(sql);

  try {
    await migrate(db, { migrationsFolder: './drizzle' });
    console.log('Migrations completed successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

runMigrations();
