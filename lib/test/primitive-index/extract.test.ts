import * as assert from 'node:assert';
import {
  buildBodyPreview,
  computePrimitiveId,
  detectKindFromPath,
  extractFromFile,
  extractMcpPrimitives,
  parseFrontmatter,
} from '../../src/primitive-index/extract';
import type {
  BundleManifest,
  BundleRef,
} from '../../src/primitive-index/types';

const ref: BundleRef = {
  sourceId: 'hub-a',
  sourceType: 'github',
  bundleId: 'b1',
  bundleVersion: '1.0.0',
  installed: true
};

describe('parseFrontmatter()', () => {
  it('returns null frontmatter when none present', () => {
    const r = parseFrontmatter('# just a body');
    assert.strictEqual(r.frontmatter, null);
    assert.strictEqual(r.body, '# just a body');
  });

  it('parses YAML and strips frontmatter from body', () => {
    const content = '---\ntitle: "T"\n---\n\n# H';
    const r = parseFrontmatter(content);
    assert.strictEqual(r.frontmatter?.title, 'T');
    assert.match(r.body, /^# H/);
  });
});

describe('detectKindFromPath()', () => {
  it('maps file suffixes to kinds', () => {
    assert.strictEqual(detectKindFromPath('a/b.prompt.md'), 'prompt');
    assert.strictEqual(detectKindFromPath('a/b.instructions.md'), 'instruction');
    assert.strictEqual(detectKindFromPath('a/b.chatmode.md'), 'chat-mode');
    assert.strictEqual(detectKindFromPath('a/b.agent.md'), 'agent');
    assert.strictEqual(detectKindFromPath('skills/x/SKILL.md'), 'skill');
    assert.strictEqual(detectKindFromPath('README.md'), null);
  });
});

describe('buildBodyPreview()', () => {
  it('strips code fences, links and markdown emphasis', () => {
    const out = buildBodyPreview('**bold** `code` ```ts\nx\n``` [link](http://x) text');
    assert.ok(!out.includes('**'));
    assert.ok(!out.includes('`'));
    assert.ok(!out.includes('['));
    assert.ok(out.includes('link'));
    assert.ok(out.includes('text'));
  });

  it('caps length', () => {
    const long = 'word '.repeat(500);
    const out = buildBodyPreview(long, 100);
    assert.ok(out.length <= 100);
    assert.ok(out.endsWith('…'));
  });
});

describe('extractFromFile()', () => {
  const manifest: BundleManifest = {
    id: 'b1', version: '1.0.0', tags: ['iac'],
    items: [{ path: 'prompts/x.prompt.md', kind: 'prompt', tags: ['iac'] }]
  };

  it('builds a primitive with merged tags and frontmatter title', () => {
    const prim = extractFromFile(
      { ref, manifest },
      {
        path: 'prompts/x.prompt.md',
        content: '---\ntitle: "My Prompt"\ndescription: "d"\ntags: [extra]\n---\n\n# H\nbody'
      }
    );
    assert.ok(prim);
    assert.strictEqual(prim.kind, 'prompt');
    assert.strictEqual(prim.title, 'My Prompt');
    assert.strictEqual(prim.description, 'd');
    assert.deepStrictEqual(prim.tags, ['iac', 'extra']);
    assert.strictEqual(prim.bundle, ref);
    assert.strictEqual(prim.id, computePrimitiveId(ref.sourceId, ref.bundleId, 'prompts/x.prompt.md'));
    assert.ok(prim.contentHash.length === 40);
  });

  it('falls back to first H1 when no frontmatter title', () => {
    const prim = extractFromFile(
      { ref, manifest: { id: 'b1', version: '1.0.0' } },
      { path: 'prompts/y.prompt.md', content: '# Heading Title\n\nbody' }
    );
    assert.strictEqual(prim?.title, 'Heading Title');
  });

  it('returns null when kind cannot be determined', () => {
    const prim = extractFromFile(
      { ref, manifest: { id: 'b1', version: '1.0.0' } },
      { path: 'random.txt', content: 'anything' }
    );
    assert.strictEqual(prim, null);
  });
});

describe('extractMcpPrimitives()', () => {
  it('synthesises records from manifest.mcp.items', () => {
    const manifest: BundleManifest = {
      id: 'b1', version: '1.0.0',
      mcp: { items: { srv: { type: 'stdio', command: 'node', args: ['server.js'] } } }
    };
    const prims = extractMcpPrimitives({ ref, manifest });
    assert.strictEqual(prims.length, 1);
    assert.strictEqual(prims[0].kind, 'mcp-server');
    assert.strictEqual(prims[0].title, 'srv');
    assert.ok(prims[0].bodyPreview.includes('node'));
    assert.ok(prims[0].tags.includes('mcp'));
  });
});
