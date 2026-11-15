/**
 * The id of the editor's engine canvas — the `<canvas>` `CanvasArea` renders
 * and `init_engine` attaches winit to. Shared so that everything that must
 * find that element (engine recovery, the replay runner's input injection)
 * names the same id as the component that renders it.
 *
 * Before this constant existed, two consumers looked for `#forge-canvas`, an
 * id nothing renders, and every unit test fabricated that element — so the
 * checks passed against an element the app never has, and the first live run
 * of `e2e/engine/inputReplay.spec.ts` failed on "Replay requires the active
 * engine canvas" (#10007). `CanvasArea.test.tsx` pins that the rendered id is
 * this value; `replayInvocation.test.ts` pins that the boundary targets it.
 *
 * The published-game player (`components/play/GamePlayer.tsx`) uses its own
 * `play-canvas`; it has no editor, no recovery overlay and no replay.
 */
export const EDITOR_CANVAS_ID = 'game-canvas';
