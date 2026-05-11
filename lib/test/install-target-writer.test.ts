import * as path from 'node:path';
import {
  describe,
  expect,
  it,
} from 'vitest';
import type {
  Target,
} from '../src/domain/install';
import {
  expandPath,
  FileTreeTargetWriter,
  resolveLayout,
  type WriterFs,
} from '../src/infra/writers/file-tree-writer';
import {
  filesFromRecord,
} from './helpers/install-test-helpers';

interface RecordingFs extends WriterFs {
  writes: Map<string, string>;
  mkdirs: Set<string>;
}

const makeFs = (): RecordingFs => {
  const writes = new Map<string, string>();
  const mkdirs = new Set<string>();
  return {
    writes,
    mkdirs,
    writeFile: (p: string, b: string): Promise<void> => {
      writes.set(p, b);
      return Promise.resolve();
    },
    mkdir: (p: string): Promise<void> => {
      mkdirs.add(p);
      return Promise.resolve();
    },
    remove: (): Promise<void> => Promise.resolve(),
    exists: (): Promise<boolean> => Promise.resolve(true)
  };
};

const ENV = { HOME: '/home/me' };

describe('FileTreeTargetWriter', () => {
  it('expandPath handles ${HOME} and tilde', () => {
    expect(expandPath('${HOME}/x', ENV)).toBe('/home/me/x');
    expect(expandPath('~/x', ENV)).toBe('/home/me/x');
  });

  it('vscode default layout writes into User dir', () => {
    const layout = resolveLayout({ name: 'v', type: 'vscode', scope: 'user' });
    expect(layout.baseDir).toBe('${HOME}/.config/Code/User');
    expect(Object.keys(layout.kindRoutes).toSorted()).toStrictEqual([
      'chatmodes/', 'instructions/', 'prompts/', 'skills/'
    ]);
  });

  it('windsurf maps prompts/instructions -> rules, skills -> skills, no agents route', () => {
    const layout = resolveLayout({ name: 'w', type: 'windsurf', scope: 'user' });
    expect(layout.kindRoutes['prompts/']).toBe('rules/');
    expect(layout.kindRoutes['instructions/']).toBe('rules/');
    expect(layout.kindRoutes['skills/']).toBe('skills/');
    expect(layout.kindRoutes['agents/']).toBeUndefined();
  });

  it('writes routed files and skips non-routed extras', async () => {
    const fs = makeFs();
    const writer = new FileTreeTargetWriter({ fs, env: ENV });
    const target: Target = {
      name: 'dev', type: 'vscode', scope: 'user',
      path: '/tmp/vscode-user'
    };
    const files = filesFromRecord({
      'deployment-manifest.yml': 'id: foo\n',
      'README.md': '# Foo',
      'prompts/a.md': 'A',
      'chatmodes/b.md': 'B',
      'extra/uncovered.md': 'X'
    });
    const result = await writer.write(target, files);
    expect(result.written.toSorted()).toStrictEqual([
      path.join('/tmp/vscode-user/chatmodes', 'b.md'),
      path.join('/tmp/vscode-user/prompts', 'a.md')
    ]);
    expect(result.skipped).toStrictEqual(['extra/uncovered.md']);
    expect(fs.writes.has(path.join('/tmp/vscode-user/prompts', 'a.md'))).toBe(true);
    expect(fs.writes.has(path.join('/tmp/vscode-user', 'README.md'))).toBe(false);
  });

  it('honors allowedKinds (skips chatmodes when not in the list)', async () => {
    const fs = makeFs();
    const writer = new FileTreeTargetWriter({ fs, env: ENV });
    const target: Target = {
      name: 'dev', type: 'vscode', scope: 'user',
      path: '/tmp/v',
      allowedKinds: ['prompts']
    };
    const files = filesFromRecord({
      'prompts/a.md': 'A',
      'chatmodes/b.md': 'B'
    });
    const result = await writer.write(target, files);
    expect(result.written).toStrictEqual([path.join('/tmp/v/prompts', 'a.md')]);
    expect(result.skipped).toStrictEqual(['chatmodes/b.md']);
  });

  it('windsurf collapses prompts and instructions into rules/, skips unrouted agents/', async () => {
    const fs = makeFs();
    const writer = new FileTreeTargetWriter({ fs, env: ENV });
    const target: Target = {
      name: 'w', type: 'windsurf', scope: 'user',
      path: '/tmp/ws'
    };
    const files = filesFromRecord({
      'prompts/p.md': 'P',
      'instructions/i.md': 'I',
      'agents/a.md': 'A',
      'skills/s.md': 'S'
    });
    const result = await writer.write(target, files);
    expect(result.written.toSorted()).toStrictEqual([
      path.join('/tmp/ws/rules', 'i.md'),
      path.join('/tmp/ws/rules', 'p.md'),
      path.join('/tmp/ws/skills', 's.md')
    ]);
    expect(result.skipped).toStrictEqual(['agents/a.md']);
  });

  it('claude-code routes prompts/ to commands/ and chatmodes/ to modes/ (D18)', async () => {
    const fs = makeFs();
    const writer = new FileTreeTargetWriter({ fs, env: ENV });
    const target: Target = {
      name: 'cc', type: 'claude-code', scope: 'user', path: '/tmp/cc'
    };
    const files = filesFromRecord({
      'prompts/a.md': 'A',
      'agents/b.md': 'B',
      'instructions/c.md': 'C',
      'chatmodes/d.md': 'D',
      'deployment-manifest.yml': 'manifest'
    });
    const result = await writer.write(target, files);
    expect(result.written.toSorted()).toStrictEqual([
      '/tmp/cc/agents/b.md',
      '/tmp/cc/commands/a.md',
      '/tmp/cc/instructions/c.md',
      '/tmp/cc/modes/d.md'
    ]);
  });

  it('claude-code default base dir expands $HOME', () => {
    const layout = resolveLayout({ name: 'cc', type: 'claude-code', scope: 'user' });
    expect(layout.baseDir).toBe('${HOME}/.claude');
    expect(layout.kindRoutes['prompts/']).toBe('commands/');
    expect(layout.kindRoutes['chatmodes/']).toBe('modes/');
  });

  it('kiro user scope routes prompts/instructions to steering/ and agents to agents/', () => {
    const layout = resolveLayout({ name: 'k', type: 'kiro', scope: 'user' });
    expect(layout.kindRoutes['prompts/']).toBe('steering/');
    expect(layout.kindRoutes['instructions/']).toBe('steering/');
    expect(layout.kindRoutes['agents/']).toBe('agents/');
    expect(layout.kindRoutes['chatmodes/']).toBeUndefined();
  });

  it('kiro repository scope routes into .kiro/ subdirs', () => {
    const layout = resolveLayout({ name: 'k', type: 'kiro', scope: 'repository', workspaceRoot: '/repo' });
    expect(layout.baseDir).toBe('/repo');
    expect(layout.kindRoutes['prompts/']).toBe('.kiro/steering/');
    expect(layout.kindRoutes['agents/']).toBe('.kiro/agents/');
    expect(layout.kindRoutes['instructions/']).toBe('.kiro/steering/');
  });

  it('mkdir-recursive creates the routed kind subdirs (kiro uses steering/)', async () => {
    const fs = makeFs();
    const writer = new FileTreeTargetWriter({ fs, env: ENV });
    const target: Target = { name: 'k', type: 'kiro', scope: 'user', path: '/tmp/k' };
    await writer.write(target, filesFromRecord({}));
    const has = (p: string): boolean => fs.mkdirs.has(p) || fs.mkdirs.has(p + '/');
    expect(has('/tmp/k/steering')).toBe(true);
    expect(has('/tmp/k/agents')).toBe(true);
  });

  it('copilot-cli default base dir is ~/.copilot; skills routed, agents not (plugin-distributed)', () => {
    const layout = resolveLayout({ name: 'c', type: 'copilot-cli', scope: 'user' });
    expect(layout.baseDir).toBe('${HOME}/.copilot');
    expect(layout.kindRoutes['prompts/']).toBe('prompts/');
    expect(layout.kindRoutes['skills/']).toBe('skills/');
    expect(layout.kindRoutes['agents/']).toBeUndefined();
  });

  it('vscode repository scope: skills go to .github/skills/, agents not routed', () => {
    const layout = resolveLayout({ name: 'v', type: 'vscode', scope: 'repository', workspaceRoot: '/repo' });
    expect(layout.baseDir).toBe('/repo');
    expect(layout.kindRoutes['prompts/']).toBe('.github/prompts/');
    expect(layout.kindRoutes['instructions/']).toBe('.github/instructions/');
    expect(layout.kindRoutes['skills/']).toBe('.github/skills/');
    expect(layout.kindRoutes['agents/']).toBeUndefined();
  });

  it('windsurf repository scope: rules and skills routed, agents not (no native agent concept)', () => {
    const layout = resolveLayout({ name: 'w', type: 'windsurf', scope: 'repository', workspaceRoot: '/repo' });
    expect(layout.baseDir).toBe('/repo');
    expect(layout.kindRoutes['prompts/']).toBe('.windsurf/rules/');
    expect(layout.kindRoutes['skills/']).toBe('.windsurf/skills/');
    expect(layout.kindRoutes['agents/']).toBeUndefined();
  });

  it('claude-code repository scope routes skills to .claude/skills/ and agents to .claude/agents/', () => {
    const layout = resolveLayout({ name: 'cc', type: 'claude-code', scope: 'repository', workspaceRoot: '/repo' });
    expect(layout.baseDir).toBe('/repo');
    expect(layout.kindRoutes['prompts/']).toBe('.claude/commands/');
    expect(layout.kindRoutes['agents/']).toBe('.claude/agents/');
    expect(layout.kindRoutes['skills/']).toBe('.claude/skills/');
  });
});
