/**
 * Phase 5 / Iter 15 — extractor + manifest-validator tests.
 */
import * as assert from 'node:assert';
import {
  DictBundleExtractor,
  filesFromRecord,
} from '../../src/install/extractor';
import {
  MANIFEST_FILENAME,
  ManifestValidationError,
  validateManifest,
} from '../../src/install/manifest-validator';

describe('Phase 5 / Iter 15 — extractor + validator', () => {
  describe('DictBundleExtractor', () => {
    it('returns the supplied file map verbatim', async () => {
      const files = filesFromRecord({ 'a.md': 'hi', 'b.md': 'there' });
      const ex = new DictBundleExtractor(files);
      const got = await ex.extract(new Uint8Array());
      assert.strictEqual(got.get('a.md')?.length, 2);
      assert.strictEqual(got.get('b.md')?.length, 5);
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
      assert.strictEqual(m.id, 'foo');
      assert.strictEqual(m.version, '1.0.0');
      assert.strictEqual(m.name, 'Foo bundle');
    });

    it('accepts version=latest as a wildcard', () => {
      const files = filesFromRecord({ [MANIFEST_FILENAME]: goodManifest });
      const m = validateManifest(files, { expectedId: 'foo', expectedVersion: 'latest' });
      assert.strictEqual(m.version, '1.0.0');
    });

    it('throws BUNDLE.MANIFEST_MISSING when the manifest is absent', () => {
      const files = filesFromRecord({ 'random.md': 'no manifest' });
      assert.throws(
        () => validateManifest(files, { expectedId: 'foo' }),
        (err: unknown) => err instanceof ManifestValidationError
          && err.code === 'BUNDLE.MANIFEST_MISSING'
      );
    });

    it('throws BUNDLE.MANIFEST_INVALID on bad YAML', () => {
      const files = filesFromRecord({ [MANIFEST_FILENAME]: 'id: foo\n  bad: : :' });
      assert.throws(
        () => validateManifest(files, { expectedId: 'foo' }),
        (err: unknown) => err instanceof ManifestValidationError
          && err.code === 'BUNDLE.MANIFEST_INVALID'
      );
    });

    it('throws BUNDLE.MANIFEST_INVALID when the manifest is a YAML scalar', () => {
      const files = filesFromRecord({ [MANIFEST_FILENAME]: 'just-a-string' });
      assert.throws(
        () => validateManifest(files, { expectedId: 'foo' }),
        /must be a YAML mapping/
      );
    });

    it('throws BUNDLE.MANIFEST_INVALID when id/version/name is missing', () => {
      const files = filesFromRecord({ [MANIFEST_FILENAME]: 'id: foo\nversion: 1.0.0\n' });
      assert.throws(
        () => validateManifest(files, { expectedId: 'foo' }),
        /"name"/
      );
    });

    it('throws BUNDLE.ID_MISMATCH when manifest id differs from expected', () => {
      const files = filesFromRecord({ [MANIFEST_FILENAME]: goodManifest });
      assert.throws(
        () => validateManifest(files, { expectedId: 'bar' }),
        (err: unknown) => err instanceof ManifestValidationError
          && err.code === 'BUNDLE.ID_MISMATCH'
      );
    });

    it('throws BUNDLE.VERSION_MISMATCH when manifest version differs from expected', () => {
      const files = filesFromRecord({ [MANIFEST_FILENAME]: goodManifest });
      assert.throws(
        () => validateManifest(files, { expectedId: 'foo', expectedVersion: '9.9.9' }),
        (err: unknown) => err instanceof ManifestValidationError
          && err.code === 'BUNDLE.VERSION_MISMATCH'
      );
    });
  });
});
