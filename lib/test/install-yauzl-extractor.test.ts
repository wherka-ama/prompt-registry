import * as archiver from 'archiver';
import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  isUnsafeZipPath,
  YauzlBundleExtractor,
} from '../src/infra/extractors/yauzl-extractor';

interface ZipEntry {
  path: string;
  contents: string | Uint8Array;
}

const buildZip = async (entries: ZipEntry[]): Promise<Uint8Array> => {
  const archive = archiver.create('zip');
  const chunks: Buffer[] = [];
  return new Promise<Uint8Array>((resolve, reject) => {
    archive.on('data', (chunk: Buffer): void => {
      chunks.push(chunk);
    });
    archive.on('end', () => {
      const buf = Buffer.concat(chunks);
      resolve(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    });
    archive.on('error', reject);
    for (const e of entries) {
      archive.append(
        typeof e.contents === 'string'
          ? Buffer.from(e.contents, 'utf8')
          : Buffer.from(e.contents),
        { name: e.path }
      );
    }
    void archive.finalize();
  });
};

describe('YauzlBundleExtractor', () => {
  it('decodes a small flat zip into an ExtractedFiles map', async () => {
    const bytes = await buildZip([
      { path: 'deployment-manifest.yml', contents: 'id: foo\nversion: 1.0.0\nname: F\n' },
      { path: 'prompts/a.md', contents: 'A' },
      { path: 'prompts/b.md', contents: 'B' }
    ]);
    const ext = new YauzlBundleExtractor();
    const out = await ext.extract(bytes);
    expect(out.size).toBe(3);
    expect(new TextDecoder().decode(out.get('prompts/a.md'))).toBe('A');
    expect(
      new TextDecoder().decode(out.get('deployment-manifest.yml')).split('\n')[0]
    ).toBe('id: foo');
  });

  it('handles binary entries verbatim', async () => {
    const bin = new Uint8Array([0x00, 0x01, 0x02, 0xFF]);
    const bytes = await buildZip([{ path: 'x.bin', contents: bin }]);
    const ext = new YauzlBundleExtractor();
    const out = await ext.extract(bytes);
    expect([...(out.get('x.bin') ?? [])]).toStrictEqual([0, 1, 2, 255]);
  });

  it('isUnsafeZipPath rejects ../ escape', () => {
    expect(isUnsafeZipPath('../etc/passwd')).toBe(true);
    expect(isUnsafeZipPath('a/../../etc')).toBe(true);
  });

  it('isUnsafeZipPath rejects absolute / drive paths', () => {
    expect(isUnsafeZipPath('/etc/passwd')).toBe(true);
    expect(isUnsafeZipPath('C:/Windows/System32')).toBe(true);
  });

  it('isUnsafeZipPath accepts safe relative paths', () => {
    expect(isUnsafeZipPath('prompts/a.md')).toBe(false);
    expect(isUnsafeZipPath('a/./b')).toBe(false);
    expect(isUnsafeZipPath('a/b/../c')).toBe(false);
  });

  it('skips directory-only entries', async () => {
    const ext = new YauzlBundleExtractor();
    const bytes = await buildZip([
      { path: 'a/b/c.md', contents: 'x' }
    ]);
    const out = await ext.extract(bytes);
    expect(out.size).toBe(1);
    expect(out.has('a/b/c.md')).toBe(true);
  });
});
