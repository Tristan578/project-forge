import { describe, it, expect } from 'vitest';
import { MCP_TOKEN_PARAM } from '../tokenParam';
import { mcpBridgeToken } from '../bridgeOptIn';
import { signInHrefReturningTo, stripNeverCarriedParams } from '@/lib/navigation/authRoutes';

/**
 * The reader (`mcpBridgeToken`) and the strippers (`authRoutes`) must name the
 * same parameter, or the token rides into the sign-in redirect. Asserted as the
 * composition the app performs: a URL the reader accepts must, once stripped,
 * be one the reader rejects. Each fixture goes through the reader first, so a
 * reader that stopped reading `MCP_TOKEN_PARAM` fails here rather than making
 * the "stripped" half pass vacuously.
 */
describe('MCP_TOKEN_PARAM: the bridge reader and the sign-in strippers agree', () => {
  const token = 'secret-token';
  const query = `?tab=scene&${MCP_TOKEN_PARAM}=${token}`;

  it('is the parameter the bridge reads the token from', () => {
    expect(mcpBridgeToken(query)).toBe(token);
  });

  it('is removed from the in-app sign-in return path', () => {
    expect(mcpBridgeToken(query)).toBe(token);
    const href = signInHrefReturningTo(`/editor/p1${query}`);
    const carried = new URL(href, 'https://spawnforge.ai').searchParams.get('redirect_url');
    expect(carried).toBe('/editor/p1?tab=scene');
    expect(mcpBridgeToken(new URL(carried ?? '', 'https://spawnforge.ai').search)).toBeNull();
    expect(href).not.toContain(token);
  });

  it("is removed from the return URL the proxy hands Clerk", () => {
    const requestUrl = `https://spawnforge.ai/editor/p1${query}`;
    expect(mcpBridgeToken(new URL(requestUrl).search)).toBe(token);
    const stripped = stripNeverCarriedParams(requestUrl);
    expect(stripped).toBe('https://spawnforge.ai/editor/p1?tab=scene');
    expect(mcpBridgeToken(new URL(stripped).search)).toBeNull();
  });
});
