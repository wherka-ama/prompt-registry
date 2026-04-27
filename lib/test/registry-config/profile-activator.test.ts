/**
 * Phase 6 / Iter 66-70 — ProfileActivator tests.
 *
 * Uses LOCAL sources (no network) so the suite is fully offline.
 * Builds bundle dirs on disk + a profile that points at them, then
 * activates against a vscode + claude-code target pair.
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  type Profile,
  type RegistrySource,
  type Target,
} from '../../src/domain';
import {
  NULL_TOKEN_PROVIDER,
} from '../../src/install/http';
import {
  ProfileActivator,
} from '../../src/registry-config';
import {
  createNodeFsAdapter,
} from '../cli/helpers/node-fs-adapter';

const realFs = createNodeFsAdapter();

const stubHttp = {
  fetch: () => {
    throw new Error('http should not be called for local-only test');
  }
};

const writeBundle = async (dir: string, id: string, version: string, files: Record<string, string>): Promise<void> => {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'deployment-manifest.yml'),
    `id: ${id}\nversion: ${version}\nname: ${id}\n`
  );
  for (const [p, c] of Object.entries(files)) {
    await fs.mkdir(path.join(dir, path.dirname(p)), { recursive: true });
    await fs.writeFile(path.join(dir, p), c);
  }
};

let work: string;
beforeEach(async () => {
  work = await fs.mkdtemp(path.join(os.tmpdir(), 'prc-activator-'));
});
afterEach(async () => {
  await fs.rm(work, { recursive: true, force: true });
});

describe('Phase 6 / iter 66-70 - ProfileActivator', () => {
  it('activates a profile across multiple targets atomically', async () => {
    const fooDir = path.join(work, 'bundles', 'foo');
    const barDir = path.join(work, 'bundles', 'bar');
    await writeBundle(fooDir, 'foo', '1.0.0', { 'prompts/a.md': 'A' });
    await writeBundle(barDir, 'bar', '2.0.0', { 'prompts/b.md': 'B' });

    const profile: Profile = {
      id: 'backend', name: 'Backend',
      bundles: [
        { id: 'foo', version: '1.0.0', source: 'local-foo', required: true },
        { id: 'bar', version: '2.0.0', source: 'local-bar', required: false }
      ]
    };
    const sources: Record<string, RegistrySource> = {
      'local-foo': {
        id: 'local-foo', name: 'foo', type: 'local', url: fooDir,
        enabled: true, priority: 0, hubId: 'h'
      },
      'local-bar': {
        id: 'local-bar', name: 'bar', type: 'local', url: barDir,
        enabled: true, priority: 0, hubId: 'h'
      }
    };
    const vscodeDir = path.join(work, 'vscode');
    const claudeDir = path.join(work, 'claude');
    const targets: Target[] = [
      { name: 't1', type: 'vscode', scope: 'user', path: vscodeDir },
      { name: 't2', type: 'claude-code', scope: 'user', path: claudeDir }
    ];

    const activator = new ProfileActivator({
      fs: realFs, env: {},
      http: stubHttp as any,
      tokens: NULL_TOKEN_PROVIDER
    });
    const out = await activator.activate({ hubId: 'h', profile, sources, targets });

    assert.deepStrictEqual(
      out.state.syncedBundles.toSorted(),
      ['bar', 'foo']
    );
    assert.deepStrictEqual(out.state.syncedTargets.toSorted(), ['t1', 't2']);
    assert.strictEqual(out.state.syncedBundleVersions.foo, '1.0.0');
    assert.strictEqual(out.state.syncedBundleVersions.bar, '2.0.0');

    // Files actually landed in BOTH targets (D21 + agnosticism).
    const aVscode = await fs.readFile(path.join(vscodeDir, 'prompts', 'a.md'), 'utf8');
    assert.strictEqual(aVscode, 'A');
    // claude-code routes prompts/ -> commands/
    const aClaude = await fs.readFile(path.join(claudeDir, 'commands', 'a.md'), 'utf8');
    assert.strictEqual(aClaude, 'A');
  });

  it('throws on missing source (no IO writes)', async () => {
    const profile: Profile = {
      id: 'x', name: 'x',
      bundles: [{ id: 'foo', version: '1.0.0', source: 'missing', required: true }]
    };
    const targets: Target[] = [
      { name: 't', type: 'vscode', scope: 'user', path: path.join(work, 'v') }
    ];
    const activator = new ProfileActivator({
      fs: realFs, env: {}, http: stubHttp as any, tokens: NULL_TOKEN_PROVIDER
    });
    await assert.rejects(
      () => activator.activate({ hubId: 'h', profile, sources: {}, targets }),
      /SOURCE_MISSING/
    );
    // No vscode dir was created.
    const exists = await fs.stat(path.join(work, 'v')).catch(() => null);
    assert.strictEqual(exists, null);
  });

  it('refuses zero-target activations (PROFILE.ACTIVATION_NO_TARGETS)', async () => {
    const profile: Profile = { id: 'x', name: 'x', bundles: [] };
    const activator = new ProfileActivator({
      fs: realFs, env: {}, http: stubHttp as any, tokens: NULL_TOKEN_PROVIDER
    });
    await assert.rejects(
      () => activator.activate({ hubId: 'h', profile, sources: {}, targets: [] }),
      /NO_TARGETS/
    );
  });

  it('rolls back partial writes when a later target fails', async () => {
    const fooDir = path.join(work, 'bundles', 'foo');
    await writeBundle(fooDir, 'foo', '1.0.0', { 'prompts/a.md': 'A' });
    const profile: Profile = {
      id: 'p', name: 'P',
      bundles: [{ id: 'foo', version: '1.0.0', source: 'local-foo', required: true }]
    };
    const sources: Record<string, RegistrySource> = {
      'local-foo': {
        id: 'local-foo', name: 'foo', type: 'local', url: fooDir,
        enabled: true, priority: 0, hubId: 'h'
      }
    };
    const vscodeDir = path.join(work, 'vscode');
    // Second target type unsupported -> writer throws.
    const targets: Target[] = [
      { name: 't1', type: 'vscode', scope: 'user', path: vscodeDir },
      { name: 't2', type: 'unknown' as any, scope: 'user', path: '/nope' }
    ];
    const activator = new ProfileActivator({
      fs: realFs, env: {}, http: stubHttp as any, tokens: NULL_TOKEN_PROVIDER
    });
    await assert.rejects(
      () => activator.activate({ hubId: 'h', profile, sources, targets }),
      /ACTIVATION_FAILED/
    );
    // Rollback: vscode/prompts/a.md should be GONE.
    const exists = await fs.stat(path.join(vscodeDir, 'prompts', 'a.md')).catch(() => null);
    assert.strictEqual(exists, null, 'rolled-back file must not exist on disk');
  });
});
