-- THROWAWAY MIGRATION FOR THE #10161 MUTATION RUN. MUST NEVER MERGE.
-- It references a table that does not exist, so `npm run db:migrate` must fail
-- at this migration, naming it, before Playwright starts in
-- test-e2e-engine-journeys. The commit that adds it is reverted once that log
-- is on record.
CREATE TABLE "throwaway_mutation_probe" ("id" integer NOT NULL REFERENCES "table_that_does_not_exist"("id"));
