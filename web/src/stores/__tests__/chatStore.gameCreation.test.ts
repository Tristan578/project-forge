/**
 * Chat -> game-creation pipeline routing.
 *
 * A direct "make me a game" request must reach the creation pipeline rather
 * than the chat tool loop. Before this wiring existed, `detectGameCreationIntent`
 * had zero callers and `OrchestratorPanel` told users to "use chat" for a route
 * that did not exist — the whole Phase 2A pipeline was unreachable from the
 * product.
 *
 * The two collaborating stores are stubbed via `setState` rather than
 * `vi.mock`, so the normal-chat control cases still exercise the real scene
 * context builder — a wholesale module mock makes those cases pass for the
 * wrong reason.
 *
 * Spec: specs/2026-04-12-e1-pipeline-integration.md (Deliverable 5)
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useChatStore } from '../chatStore';
import { useEditorStore } from '../editorStore';
import { useWorkspaceStore } from '../workspaceStore';
import { mockSSEResponse, makeChatSSEEvents } from '@/test/utils/streamingTestUtils';

const startDecomposition = vi.fn<(prompt: string, projectType: string) => Promise<void>>();
const openPanel = vi.fn();

let restoreEditor: () => void;
let restoreWorkspace: () => void;

describe('chatStore — game-creation routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startDecomposition.mockResolvedValue(undefined);
    localStorage.clear();

    const prevStart = useEditorStore.getState().startDecomposition;
    const prevOpen = useWorkspaceStore.getState().openPanel;
    restoreEditor = () => useEditorStore.setState({ startDecomposition: prevStart });
    restoreWorkspace = () => useWorkspaceStore.setState({ openPanel: prevOpen });

    useEditorStore.setState({ startDecomposition, projectType: '3d' });
    useWorkspaceStore.setState({ openPanel });

    useChatStore.setState({
      messages: [],
      isStreaming: false,
      error: null,
      abortController: null,
      loopIteration: 0,
      hasUnreadMessages: false,
      rightPanelTab: 'chat',
    });

    global.fetch = vi.fn().mockResolvedValue(mockSSEResponse(makeChatSSEEvents({ text: 'ok' })));
  });

  afterEach(() => {
    restoreEditor();
    restoreWorkspace();
  });

  it('routes an explicit game-creation request to the pipeline instead of /api/chat', async () => {
    await useChatStore.getState().sendMessage('make me a 3D platformer where you collect gems');

    expect(startDecomposition).toHaveBeenCalledTimes(1);
    expect(startDecomposition).toHaveBeenCalledWith(expect.stringContaining('platformer'), '3d');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(useChatStore.getState().isStreaming).toBe(false);
  });

  it('opens the Game Creator panel — it owns the approval gate', async () => {
    await useChatStore.getState().sendMessage('make me a game about racing');

    // The plan cannot be approved from anywhere else, so a pipeline that starts
    // without surfacing the panel strands the user at `awaiting_approval`.
    expect(openPanel).toHaveBeenCalledWith('orchestrator');
  });

  it('records the request and an acknowledgement in the transcript', async () => {
    await useChatStore.getState().sendMessage('build me a puzzle game');

    const { messages } = useChatStore.getState();
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('build me a puzzle game');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content).toMatch(/Game Creator/);
  });

  it('leaves editing requests on the normal chat path', async () => {
    await useChatStore.getState().sendMessage('change the player color to red');

    expect(startDecomposition).not.toHaveBeenCalled();
    expect(openPanel).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalled();
  });

  it('leaves questions on the normal chat path', async () => {
    await useChatStore.getState().sendMessage('what is a game engine?');

    expect(startDecomposition).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalled();
  });

  it('surfaces a decomposition failure as a chat error rather than throwing', async () => {
    startDecomposition.mockRejectedValueOnce(new Error('Decomposition failed (503)'));

    await expect(
      useChatStore.getState().sendMessage('create a game about space mining'),
    ).resolves.toBeUndefined();

    expect(useChatStore.getState().error).toBe('Decomposition failed (503)');
    expect(useChatStore.getState().isStreaming).toBe(false);
  });

  it('does not start a pipeline while another turn is streaming', async () => {
    useChatStore.setState({ isStreaming: true });

    await useChatStore.getState().sendMessage('make me a game');

    expect(startDecomposition).not.toHaveBeenCalled();
  });
});
