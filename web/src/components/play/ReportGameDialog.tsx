'use client';

import { useCallback, useState } from 'react';
import { Flag } from 'lucide-react';
import { Button, Dialog, Select, Textarea } from '@spawnforge/ui';
import {
  GAME_REPORT_REASONS,
  GAME_REPORT_REASON_LABELS,
  REPORT_DETAILS_MAX_LENGTH,
  type GameReportReason,
} from '@/lib/config/moderation';

interface ReportGameDialogProps {
  gameId: string;
}

type Outcome =
  | { kind: 'hidden' }
  | { kind: 'recorded' }
  | { kind: 'duplicate' }
  | { kind: 'error'; message: string };

const REASON_OPTIONS = GAME_REPORT_REASONS.map((value) => ({
  value,
  label: GAME_REPORT_REASON_LABELS[value],
}));

/**
 * Report button + dialog for the play page (#8354).
 *
 * Submitting reports the game to POST /api/community/games/[id]/report. When
 * the response carries `hidden: true` the report crossed the auto-hide
 * threshold and the game is no longer publicly playable — we say so rather
 * than tearing down the already-running engine session, which is deliberately
 * out of scope (the viewer keeps the session they already loaded).
 */
export function ReportGameDialog({ gameId }: ReportGameDialogProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<GameReportReason | ''>('');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setSubmitting(false);
    setReason('');
    setDetails('');
    setOutcome(null);
  }, []);

  const submit = useCallback(async () => {
    if (!reason || submitting) return;
    setSubmitting(true);
    setOutcome(null);
    try {
      const res = await fetch(`/api/community/games/${gameId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason,
          ...(details.trim() ? { details: details.trim() } : {}),
        }),
      });

      if (res.status === 429) {
        setOutcome({
          kind: 'error',
          message: 'Too many reports. Please wait a minute and try again.',
        });
        return;
      }
      if (res.status === 401) {
        setOutcome({ kind: 'error', message: 'Sign in to report a game.' });
        return;
      }
      if (!res.ok) {
        setOutcome({ kind: 'error', message: 'Could not submit your report. Please try again.' });
        return;
      }

      const data = (await res.json()) as {
        hidden?: boolean;
        duplicate?: boolean;
      };
      if (data.hidden) setOutcome({ kind: 'hidden' });
      else if (data.duplicate) setOutcome({ kind: 'duplicate' });
      else setOutcome({ kind: 'recorded' });
    } catch {
      setOutcome({ kind: 'error', message: 'Could not submit your report. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  }, [gameId, reason, details, submitting]);

  const settled = outcome !== null && outcome.kind !== 'error';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
        title="Report this game"
        aria-label="Report this game"
      >
        <Flag size={16} />
      </button>

      <Dialog
        open={open}
        onClose={close}
        title="Report this game"
        description="Tell us what is wrong with this game. Reports are reviewed by a moderator."
        actions={
          settled ? (
            <Button variant="outline" onClick={close}>
              Close
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={close} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={!reason || submitting}>
                {submitting ? 'Reporting…' : 'Submit report'}
              </Button>
            </>
          )
        }
      >
        {settled ? (
          <p role="status" className="text-[var(--sf-text)]">
            {outcome.kind === 'hidden' &&
              'Thanks — this game has been hidden pending review.'}
            {outcome.kind === 'recorded' &&
              'Thanks — your report has been sent to our moderators.'}
            {outcome.kind === 'duplicate' &&
              'You have already reported this game. Our moderators are on it.'}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-[var(--sf-text-secondary)]">Reason</span>
              <Select
                aria-label="Reason"
                value={reason}
                placeholder="Choose a reason"
                options={REASON_OPTIONS}
                onChange={(e) => setReason(e.target.value as GameReportReason)}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-[var(--sf-text-secondary)]">
                Details (optional)
              </span>
              <Textarea
                aria-label="Details"
                value={details}
                maxLength={REPORT_DETAILS_MAX_LENGTH}
                placeholder="Anything a moderator should know"
                onChange={(e) => setDetails(e.target.value)}
              />
            </label>

            {outcome?.kind === 'error' && (
              <p role="alert" className="text-[var(--sf-destructive)]">
                {outcome.message}
              </p>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
