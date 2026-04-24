/*
 * Unit tests for the pure plugin-manifest helpers used by the hub
 * harvester's forthcoming plugin source support.
 *
 * Mirrors the dual-format design in src/adapters/plugin-adapter-shared.ts
 * from feature/awesome-copilot-plugin-format (PR #245) but stays on the
 * read-only path: the extension owns install/archive, the harvester only
 * needs to turn plugin.json into a list of harvestable "items".
 */

import * as assert from 'node:assert';
import {
  describe,
  it,
} from 'mocha';
import {
  derivePluginItems,
  extractPluginMcpServers,
  parsePluginManifest,
  type PluginItem,
  resolvePluginItemEntryPath,
} from '../../src/primitive-index/hub/plugin-manifest';

describe('primitive-index / plugin-manifest', () => {
  it('parses our explicit items[] format and keeps kinds normalized', () => {
    const raw = JSON.stringify({
      id: 'test-plugin',
      name: 'test-plugin',
      description: 'A test plugin',
      items: [
        { kind: 'skill', path: './skills/my-skill' },
        { kind: 'agent', path: './agents' },
        { kind: 'prompt', path: './prompts/hello.prompt.md' }
      ]
    });
    const manifest = parsePluginManifest(raw);
    assert.strictEqual(manifest.id, 'test-plugin');
    assert.strictEqual(manifest.name, 'test-plugin');
    const items = derivePluginItems(manifest);
    assert.deepStrictEqual(items, [
      { kind: 'skill', path: './skills/my-skill' },
      { kind: 'agent', path: './agents' },
      { kind: 'prompt', path: './prompts/hello.prompt.md' }
    ]);
  });

  it('parses the upstream awesome-copilot format with separate agents[] + skills[] arrays', () => {
    const raw = JSON.stringify({
      name: 'upstream-plugin',
      description: 'A plugin using upstream awesome-copilot format',
      version: '1.1.0',
      skills: ['./skills/java-docs'],
      agents: ['./agents/code-reviewer']
    });
    const manifest = parsePluginManifest(raw);
    const items = derivePluginItems(manifest);
    assert.deepStrictEqual(items, [
      { kind: 'agent', path: './agents/code-reviewer' },
      { kind: 'skill', path: './skills/java-docs' }
    ]);
  });

  it('prefers explicit items[] over agents/skills arrays if both are present', () => {
    const raw = JSON.stringify({
      name: 'hybrid',
      description: 'Has both formats',
      items: [{ kind: 'skill', path: './skills/real' }],
      skills: ['./skills/ignored'],
      agents: ['./agents/ignored']
    });
    const manifest = parsePluginManifest(raw);
    const items = derivePluginItems(manifest);
    assert.deepStrictEqual(items, [{ kind: 'skill', path: './skills/real' }]);
  });

  it('rejects manifests missing name or description (soft-fail with empty items)', () => {
    const raw = JSON.stringify({ items: [] });
    // parsePluginManifest itself is permissive (we can't reject everything
    // upfront since upstream plugins may be minimal); only derivePluginItems
    // is strict about shape.
    const manifest = parsePluginManifest(raw);
    assert.strictEqual(manifest.name, undefined);
    assert.deepStrictEqual(derivePluginItems(manifest), []);
  });

  it('throws on malformed JSON', () => {
    assert.throws(
      () => parsePluginManifest('{ not json'),
      /plugin manifest parse error/u
    );
  });

  it('resolvePluginItemEntryPath normalises ./ prefix + handles directory vs file items', () => {
    const pluginRoot = 'plugins/my-plugin';
    // Skill = directory → SKILL.md inside.
    assert.strictEqual(
      resolvePluginItemEntryPath(pluginRoot, { kind: 'skill', path: './skills/my-skill' }),
      'plugins/my-plugin/skills/my-skill/SKILL.md'
    );
    // Agent = directory → AGENT.md inside (case-insensitive discovery later).
    assert.strictEqual(
      resolvePluginItemEntryPath(pluginRoot, { kind: 'agent', path: './agents/code-reviewer' }),
      'plugins/my-plugin/agents/code-reviewer/AGENT.md'
    );
    // Prompt = file path kept as-is.
    assert.strictEqual(
      resolvePluginItemEntryPath(pluginRoot, { kind: 'prompt', path: './prompts/hello.prompt.md' }),
      'plugins/my-plugin/prompts/hello.prompt.md'
    );
    // Instruction = file path.
    assert.strictEqual(
      resolvePluginItemEntryPath(pluginRoot, { kind: 'instruction', path: './instructions/style.instructions.md' }),
      'plugins/my-plugin/instructions/style.instructions.md'
    );
    // Chat-mode = file path.
    assert.strictEqual(
      resolvePluginItemEntryPath(pluginRoot, { kind: 'chat-mode', path: './modes/debug.chatmode.md' }),
      'plugins/my-plugin/modes/debug.chatmode.md'
    );
  });

  it('extracts MCP servers from either mcp.items (our format) or mcpServers (alternative)', () => {
    // Our format: nested under mcp.items
    const our = parsePluginManifest(JSON.stringify({
      name: 'mcp-plugin',
      description: 'Has an MCP server',
      mcp: {
        items: {
          context7: { type: 'stdio', command: 'npx', args: ['-y', '@upstash/context7'] }
        }
      }
    }));
    const ourServers = extractPluginMcpServers(our);
    assert.deepStrictEqual(Object.keys(ourServers), ['context7']);
    assert.deepStrictEqual(ourServers.context7, { type: 'stdio', command: 'npx', args: ['-y', '@upstash/context7'] });

    // Alternative: top-level mcpServers
    const alt = parsePluginManifest(JSON.stringify({
      name: 'mcp-plugin',
      description: 'Has an MCP server',
      mcpServers: { filesystem: { type: 'stdio', command: 'mcp-filesystem' } }
    }));
    assert.deepStrictEqual(extractPluginMcpServers(alt), {
      filesystem: { type: 'stdio', command: 'mcp-filesystem' }
    });

    // Union when both are present — our format wins on conflict.
    const both = parsePluginManifest(JSON.stringify({
      name: 'mcp-plugin',
      description: '',
      mcp: { items: { shared: { type: 'stdio', command: 'ours' } } },
      mcpServers: { shared: { type: 'stdio', command: 'theirs' }, only: { type: 'http', url: 'x' } }
    }));
    const merged = extractPluginMcpServers(both);
    assert.deepStrictEqual(merged.shared, { type: 'stdio', command: 'ours' });
    assert.deepStrictEqual(merged.only, { type: 'http', url: 'x' });

    // No MCP fields → empty map.
    assert.deepStrictEqual(extractPluginMcpServers(parsePluginManifest('{"name":"x","description":"x"}')), {});
  });

  it('ignores items with non-string path or unknown kind', () => {
    const raw = JSON.stringify({
      name: 'bad-items',
      description: 'Has a bunch of broken entries',
      items: [
        { kind: 'skill', path: './ok' },
        { kind: 'skill' }, // missing path
        { kind: 'unknown-kind', path: './nope' },
        { path: './still-no-kind' },
        { kind: 'prompt', path: 42 as unknown as string }
      ]
    });
    const manifest = parsePluginManifest(raw);
    const items: PluginItem[] = derivePluginItems(manifest);
    assert.deepStrictEqual(items, [{ kind: 'skill', path: './ok' }]);
  });
});
