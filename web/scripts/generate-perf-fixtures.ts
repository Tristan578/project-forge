/**
 * Rewrite the pinned performance fixtures from their builders (#10013).
 *
 *   npm run perf:fixtures        (from web/)
 *
 * A rewrite that changes bytes changes the fixture checksum, and
 * `src/lib/perf/__tests__/perfFixtures.test.ts` then fails until the new
 * checksum is registered in `src/lib/perf/perfFixtures.ts` under a NEW fixture
 * version. Never change what an existing `@N` id measures.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PERF_FIXTURE_FILES,
  buildPerfFixtureScene,
  serializeFixtureScene,
} from '../src/lib/perf/fixtures/fixtureScenes';
import { computeSceneFixtureChecksum } from '../src/lib/config/measurementManifest';

const dir = join(__dirname, '..', 'src', 'lib', 'perf', 'fixtures');
for (const [id, file] of Object.entries(PERF_FIXTURE_FILES)) {
  const scene = buildPerfFixtureScene(id);
  writeFileSync(join(dir, file), serializeFixtureScene(scene), 'utf8');
  console.log(`${id} -> ${file}  entities=${scene.entities.length}  checksum=${computeSceneFixtureChecksum(scene)}`);
}
