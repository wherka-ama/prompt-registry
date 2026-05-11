import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  MANIFEST_FILENAME,
  ManifestValidationError,
  validateManifest,
} from '../src/domain/collection/manifest-validator';
import {
  DictBundleExtractor,
  filesFromRecord,
} from './helpers/install-test-helpers';

describe('extractor + validator', () => {
  describe('DictBundleExtractor', () => {
    it('returns the supplied file map verbatim', async () => {
      const ex = new DictBundleExtractor({ 'a.md': 'hi', 'b.md': 'there' });
      const got = await ex.extract(new Uint8Array());
      expect(got.get('a.md')?.length).toBe(2);
      expect(got.get('b.md')?.length).toBe(5);
    });
  });

  describe('validateManifest', () => {
    const goodManifest = `
id: foo
version: 1.0.0
name: Foo bundle
items:
  - prompts/a.md
  - prompts/b.md
`;

    it('returns the parsed manifest on success', () => {
      const files = filesFromRecord({ [MANIFEST_FILENAME]: goodManifest });
      const m = validateManifest(files, { expectedId: 'foo', expectedVersion: '1.0.0' });
      expect(m.id).toBe('foo');
      expect(m.version).toBe('1.0.0');
      expect(m.name).toBe('Foo bundle');
    });

    it('accepts version=latest as a wildcard', () => {
      const files = filesFromRecord({ [MANIFEST_FILENAME]: goodManifest });
      const m = validateManifest(files, { expectedId: 'foo', expectedVersion: 'latest' });
      expect(m.version).toBe('1.0.0');
    });

    it('throws BUNDLE.MANIFEST_MISSING when the manifest is absent', () => {
      const files = filesFromRecord({ 'random.md': 'no manifest' });
      expect(() => validateManifest(files, { expectedId: 'foo' })).toThrow(ManifestValidationError);
      try {
        validateManifest(files, { expectedId: 'foo' });
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as ManifestValidationError).code).toBe('BUNDLE.MANIFEST_MISSING');
      }
    });

    it('throws BUNDLE.MANIFEST_INVALID on bad YAML', () => {
      const files = filesFromRecord({ [MANIFEST_FILENAME]: 'id: foo\n  bad: : :' });
      expect(() => validateManifest(files, { expectedId: 'foo' })).toThrow(ManifestValidationError);
      try {
        validateManifest(files, { expectedId: 'foo' });
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as ManifestValidationError).code).toBe('BUNDLE.MANIFEST_INVALID');
      }
    });

    it('throws BUNDLE.MANIFEST_INVALID when the manifest is a YAML scalar', () => {
      const files = filesFromRecord({ [MANIFEST_FILENAME]: 'just-a-string' });
      expect(() => validateManifest(files, { expectedId: 'foo' })).toThrow(/must be a YAML mapping/);
    });

    it('throws BUNDLE.MANIFEST_INVALID when id/version/name is missing', () => {
      const files = filesFromRecord({ [MANIFEST_FILENAME]: 'id: foo\nversion: 1.0.0\n' });
      expect(() => validateManifest(files, { expectedId: 'foo' })).toThrow(/"name"/);
    });

    it('throws BUNDLE.ID_MISMATCH when manifest id differs from expected', () => {
      const files = filesFromRecord({ [MANIFEST_FILENAME]: goodManifest });
      expect(() => validateManifest(files, { expectedId: 'bar' })).toThrow(ManifestValidationError);
      try {
        validateManifest(files, { expectedId: 'bar' });
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as ManifestValidationError).code).toBe('BUNDLE.ID_MISMATCH');
      }
    });

    it('throws BUNDLE.VERSION_MISMATCH when manifest version differs from expected', () => {
      const files = filesFromRecord({ [MANIFEST_FILENAME]: goodManifest });
      expect(() => validateManifest(files, { expectedId: 'foo', expectedVersion: '9.9.9' })).toThrow(ManifestValidationError);
      try {
        validateManifest(files, { expectedId: 'foo', expectedVersion: '9.9.9' });
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as ManifestValidationError).code).toBe('BUNDLE.VERSION_MISMATCH');
      }
    });
  });
});
