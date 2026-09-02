/**
 * Tests for ReportGameDialog (#8354).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@/test/utils/componentTestUtils';
import { ReportGameDialog } from '../ReportGameDialog';

vi.mock('lucide-react', () => ({
  Flag: (props: Record<string, unknown>) => <span data-testid="flag-icon" {...props} />,
}));

const GAME_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

function mockFetch(response: { status?: number; body?: unknown }) {
  const fn = vi.fn().mockResolvedValue({
    status: response.status ?? 200,
    ok: (response.status ?? 200) < 400,
    json: async () => response.body ?? {},
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function openDialog() {
  render(<ReportGameDialog gameId={GAME_ID} />);
  fireEvent.click(screen.getByLabelText('Report this game'));
}

function submitButton(): HTMLButtonElement {
  return screen.getByText('Submit report').closest('button') as HTMLButtonElement;
}

describe('ReportGameDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders nothing but the trigger until the button is clicked', () => {
    render(<ReportGameDialog gameId={GAME_ID} />);
    expect(screen.queryByText('Report this game', { selector: 'h2' })).toBeNull();

    fireEvent.click(screen.getByLabelText('Report this game'));
    expect(screen.getByText('Report this game', { selector: 'h2' })).toBeDefined();
  });

  it('disables submit until a reason is chosen', () => {
    openDialog();
    expect(submitButton().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'copyright' } });
    expect(submitButton().disabled).toBe(false);
  });

  it('posts the selected reason and trimmed details to the report route', async () => {
    const fetchMock = mockFetch({ body: { reported: true, hidden: true } });
    openDialog();

    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'hate_speech' } });
    fireEvent.change(screen.getByLabelText('Details'), { target: { value: '  slurs in the HUD  ' } });
    fireEvent.click(submitButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/community/games/${GAME_ID}/report`);
    expect(init.method).toBe('POST');
    // The BODY is what the server acts on — assert the reason travelled, not
    // merely that a request was made.
    expect(JSON.parse(init.body)).toEqual({
      reason: 'hate_speech',
      details: 'slurs in the HUD',
    });
  });

  it('omits details entirely when the field is left blank', async () => {
    const fetchMock = mockFetch({ body: { reported: true, hidden: true } });
    openDialog();

    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'spam' } });
    fireEvent.click(submitButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ reason: 'spam' });
  });

  it('shows the hidden-pending-review copy when the response says hidden', async () => {
    mockFetch({ body: { reported: true, hidden: true } });
    openDialog();

    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'copyright' } });
    fireEvent.click(submitButton());

    await waitFor(() =>
      expect(screen.getByText(/hidden pending review/i)).toBeDefined()
    );
    // Settled state replaces the form.
    expect(screen.queryByText('Submit report')).toBeNull();
  });

  it('shows a sent-to-moderators message when the report did not cross the threshold', async () => {
    mockFetch({ body: { reported: true, hidden: false, reportCount: 2 } });
    openDialog();

    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'violence' } });
    fireEvent.click(submitButton());

    await waitFor(() => expect(screen.getByText(/sent to our moderators/i)).toBeDefined());
    expect(screen.queryByText(/hidden pending review/i)).toBeNull();
  });

  it('tells a repeat reporter they already reported the game', async () => {
    mockFetch({ body: { reported: true, hidden: false, duplicate: true } });
    openDialog();

    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'other' } });
    fireEvent.click(submitButton());

    await waitFor(() => expect(screen.getByText(/already reported this game/i)).toBeDefined());
  });

  it('renders an error and keeps the form on a 429, rather than a success state', async () => {
    mockFetch({ status: 429, body: {} });
    openDialog();

    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'spam' } });
    fireEvent.click(submitButton());

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.getByRole('alert').textContent).toMatch(/too many reports/i);
    expect(screen.queryByText(/hidden pending review/i)).toBeNull();
    // The form must survive so the viewer can retry.
    expect(submitButton()).toBeDefined();
  });

  it('renders an error when the network call throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    openDialog();

    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'spam' } });
    fireEvent.click(submitButton());

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    expect(screen.getByRole('alert').textContent).toMatch(/could not submit/i);
  });

  it('resets the form when the dialog is closed and reopened', async () => {
    mockFetch({ body: { reported: true, hidden: true } });
    openDialog();

    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'copyright' } });
    fireEvent.click(submitButton());
    await waitFor(() => expect(screen.getByText(/hidden pending review/i)).toBeDefined());

    fireEvent.click(screen.getByText('Close'));
    fireEvent.click(screen.getByLabelText('Report this game'));

    expect(screen.queryByText(/hidden pending review/i)).toBeNull();
    expect(submitButton().disabled).toBe(true);
  });
});
