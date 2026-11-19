import { describe, expect, it } from 'vitest';
import { MCP_PATH, MCP_SERVER_NAME } from './index.js';

describe('server info', () => {
  it('names the server turnkeel', () => {
    expect(MCP_SERVER_NAME).toBe('turnkeel');
  });

  it('serves MCP at /mcp', () => {
    expect(MCP_PATH).toBe('/mcp');
  });
});
