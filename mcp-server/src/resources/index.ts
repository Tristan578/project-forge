import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EditorBridge } from '../transport/websocket.js';

/**
 * Register MCP resources that expose live editor state.
 * These allow Claude to read the current scene without explicit tool calls.
 */
export function registerResources(server: McpServer, bridge: EditorBridge): void {
  // Scene Graph resource
  server.resource(
    'scene-graph',
    'forge://scene/graph',
    async (uri) => {
      let data = bridge.sceneGraph;

      // If no cached state, query the editor
      if (!data && bridge.isConnected()) {
        try {
          data = await bridge.executeCommand('get_scene_graph', {});
        } catch {
          data = { error: 'Unable to fetch scene graph. Is the editor running?' };
        }
      }

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(data ?? { entities: [], error: 'Not connected to editor' }, null, 2),
          },
        ],
      };
    }
  );

  // Current Selection resource
  server.resource(
    'selection',
    'forge://scene/selection',
    async (uri) => {
      let data = bridge.selection;

      if (!data && bridge.isConnected()) {
        try {
          data = await bridge.executeCommand('get_selection', {});
        } catch {
          data = { selectedIds: [], primaryId: null };
        }
      }

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(data ?? { selectedIds: [], primaryId: null }, null, 2),
          },
        ],
      };
    }
  );

  // Project Info resource
  server.resource(
    'project-info',
    'forge://project/info',
    async (uri) => {
      let data = bridge.projectInfo;

      if (!data && bridge.isConnected()) {
        try {
          data = await bridge.executeCommand('get_project_info', {});
        } catch {
          data = { name: 'Untitled Project', version: '0.1.0' };
        }
      }

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(data ?? { name: 'Untitled Project' }, null, 2),
          },
        ],
      };
    }
  );
}
