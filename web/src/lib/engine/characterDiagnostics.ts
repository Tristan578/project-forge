/**
 * Reading the engine's character-controller diagnostics into something a player
 * can act on (PF-1214).
 *
 * `manage_character_controller_lifecycle` attaches Rapier's kinematic controller
 * on Edit->Play, and an entity with no collider never enters its query at all —
 * it is not rejected, it is never considered. Such a character keeps the legacy
 * raw-translation path: no gravity, no ground contact, no collision response. It
 * walks through walls in a scene that looks healthy from every angle, which is
 * the golden-path failure this ticket exists for.
 *
 * The engine records those entities in `CharacterControllerDiagnostics` and the
 * bridge emits them as `CHARACTER_CONTROLLER_DIAGNOSTICS`. That event is the
 * ONLY runtime signal — there is no `CHARACTER_GROUNDED_CHANGED` for a character
 * that was never attached, so silence on this channel is indistinguishable from
 * a working game. This module turns the payload into a sentence; the caller
 * (`hooks/events/gameEvents.ts`) raises it as a toast.
 *
 * Deliberately holds NO state. The engine emits on CHANGE only, including the
 * change to an empty list, so each emission is already the whole truth about the
 * transition that just happened; a mirror here would be a second copy with no
 * reader.
 */

/** How many names the message spells out before collapsing the rest into a count. */
const MAX_NAMED = 3;

/**
 * The entity ids the engine skipped, or `null` if this is not that payload.
 *
 * `null` and `[]` are different answers and the caller must not conflate them:
 * `[]` is the engine reporting that every character got its controller (the
 * emission that says a previously-broken scene is now fixed), while `null` means
 * the payload was unreadable and nothing at all is known.
 */
export function parseSkippedCharacters(data: unknown): string[] | null {
  if (typeof data !== 'object' || data === null) return null;
  // `Object.hasOwn` rather than a bare read: a bare read walks the prototype
  // chain, so an object that merely INHERITS the key would be accepted as an
  // engine payload and its list shown to the user as fact.
  if (!Object.hasOwn(data, 'skippedWithoutCollider')) return null;
  const raw = (data as { skippedWithoutCollider?: unknown }).skippedWithoutCollider;
  if (!Array.isArray(raw)) return null;

  // An INDEXED loop, not `.every`/`.filter`. A callback form skips array holes
  // entirely, so `[valid, , valid].every(isString)` is `true` with the callback
  // called twice — a validator that reports itself satisfied on input it never
  // looked at. A hole also degrades to `null` across a serialization round trip,
  // which is the shape that actually reaches here.
  const ids: string[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const entry: unknown = raw[i];
    if (typeof entry !== 'string' || entry === '') return null;
    ids.push(entry);
  }
  return ids;
}

/**
 * The sentence shown to the player.
 *
 * `nameOf` resolves an engine entity id to its scene-graph name; an id with no
 * node keeps the id, because an unhelpful name beats naming the wrong entity.
 * The engine sorts the ids, so the order here is stable across emissions.
 */
export function describeSkippedCharacters(
  ids: readonly string[],
  nameOf: (entityId: string) => string | undefined,
): string {
  const labels = ids.map(id => {
    const name = nameOf(id);
    return name === undefined || name === '' ? id : name;
  });

  // A comma-joined list reads as an unfinished sentence the moment it meets a
  // verb — "Player, Enemy have no physics" is a fragment, and this string is a
  // sentence shown to a player, not a log line. The overflow count is just the
  // last item in the list, so it gets the same conjunction as a name.
  const parts = labels.slice(0, MAX_NAMED);
  const rest = labels.length - MAX_NAMED;
  if (rest > 0) parts.push(`${rest} more`);
  const who =
    parts.length === 1
      ? parts[0]!
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]!}`;

  // Two whole clauses rather than a per-word plural switch: mixing them is how a
  // message ends up reading "it falls through the floor and walk through walls".
  const consequence =
    labels.length === 1
      ? 'has no physics, so it falls through the floor and walks through walls'
      : 'have no physics, so they fall through the floor and walk through walls';
  // "Physics > Enabled" is the real Inspector control (a section headed Physics
  // with an Enabled checkbox), so the instruction can be followed literally.
  const remedy =
    labels.length === 1
      ? 'Select it and tick Physics > Enabled in the Inspector, then press Play again.'
      : 'Select each one and tick Physics > Enabled in the Inspector, then press Play again.';

  return `${who} ${consequence}. ${remedy}`;
}
