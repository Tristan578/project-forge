/**
 * The versioned reference games (#10159): the 2D and 3D members of #9878's
 * `qa-score3-v1` fixture set, each paired with its expected-state record.
 *
 * #9878 adds the third member (a sandbox with no win condition) here. Nothing
 * else in the set changes when it does: the winnability suite, the integrity
 * suite and the engine spec all iterate this list.
 */
import type { ReferenceGameEntry } from './referenceGame';
import { platformer2d, platformer2dExpected } from './platformer-2d';
import { collectAndWin3d, collectAndWin3dExpected } from './collect-and-win-3d';

export const REFERENCE_GAMES: readonly ReferenceGameEntry[] = [
  { game: platformer2d, expected: platformer2dExpected },
  { game: collectAndWin3d, expected: collectAndWin3dExpected },
];
