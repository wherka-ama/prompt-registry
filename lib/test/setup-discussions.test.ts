/**
 * Tests for setup-discussions
 * GitHub Discussion setup for engagement data collection
 */

import * as assert from 'assert';
import { parseArgs, parseGitHubUrl } from '../src/setup-discussions';

describe('setup-discussions', () => {
    describe('parseArgs', () => {
        it('should parse positional hub URL', () => {
            const args = parseArgs(['https://github.com/owner/repo']);
            assert.strictEqual(args.hubUrl, 'https://github.com/owner/repo');
            assert.strictEqual(args.branch, 'main');
        });

        it('should parse --hub flag', () => {
            const args = parseArgs(['--hub', 'owner/repo']);
            assert.strictEqual(args.hubUrl, 'owner/repo');
        });

        it('should parse --branch flag', () => {
            const args = parseArgs(['--branch', 'develop', 'owner/repo']);
            assert.strictEqual(args.branch, 'develop');
        });

        it('should parse --output flag', () => {
            const args = parseArgs(['--output', 'custom.yaml', 'owner/repo']);
            assert.strictEqual(args.output, 'custom.yaml');
        });

        it('should parse --category flag', () => {
            const args = parseArgs(['--category', 'Feedback', 'owner/repo']);
            assert.strictEqual(args.category, 'Feedback');
        });

        it('should parse --dry-run flag', () => {
            const args = parseArgs(['--dry-run', 'owner/repo']);
            assert.strictEqual(args.dryRun, true);
        });

        it('should parse --help flag', () => {
            const args = parseArgs(['--help']);
            assert.strictEqual(args.help, true);
        });

        it('should parse short flags', () => {
            const args = parseArgs(['-b', 'develop', '-o', 'out.yaml', '-c', 'Custom', '-n', 'owner/repo']);
            assert.strictEqual(args.branch, 'develop');
            assert.strictEqual(args.output, 'out.yaml');
            assert.strictEqual(args.category, 'Custom');
            assert.strictEqual(args.dryRun, true);
        });
    });

    describe('parseGitHubUrl', () => {
        describe('HTTPS URLs', () => {
            it('should parse basic HTTPS URL', () => {
                const result = parseGitHubUrl('https://github.com/owner/repo');
                assert.strictEqual(result.owner, 'owner');
                assert.strictEqual(result.repo, 'repo');
            });

            it('should parse HTTPS URL with .git suffix', () => {
                const result = parseGitHubUrl('https://github.com/owner/repo.git');
                assert.strictEqual(result.owner, 'owner');
                assert.strictEqual(result.repo, 'repo');
            });

            it('should parse HTTPS URL with dots in repo name', () => {
                const result = parseGitHubUrl('https://github.com/Amadeus-xDLC/genai.prompt-registry-config.git');
                assert.strictEqual(result.owner, 'Amadeus-xDLC');
                assert.strictEqual(result.repo, 'genai.prompt-registry-config');
            });

            it('should parse HTTPS URL with trailing slash', () => {
                const result = parseGitHubUrl('https://github.com/owner/repo/');
                assert.strictEqual(result.owner, 'owner');
                assert.strictEqual(result.repo, 'repo');
            });

            it('should parse HTTPS URL with tree/branch path', () => {
                const result = parseGitHubUrl('https://github.com/owner/repo/tree/main');
                assert.strictEqual(result.owner, 'owner');
                assert.strictEqual(result.repo, 'repo');
            });

            it('should parse HTTPS URL with blob/branch/file path', () => {
                const result = parseGitHubUrl('https://github.com/owner/repo/blob/main/README.md');
                assert.strictEqual(result.owner, 'owner');
                assert.strictEqual(result.repo, 'repo');
            });

            it('should parse HTTPS URL with query parameters', () => {
                const result = parseGitHubUrl('https://github.com/owner/repo?ref=develop');
                assert.strictEqual(result.owner, 'owner');
                assert.strictEqual(result.repo, 'repo');
            });

            it('should parse HTTPS URL with fragment', () => {
                const result = parseGitHubUrl('https://github.com/owner/repo#readme');
                assert.strictEqual(result.owner, 'owner');
                assert.strictEqual(result.repo, 'repo');
            });

            it('should parse HTTP URL (not just HTTPS)', () => {
                const result = parseGitHubUrl('http://github.com/owner/repo');
                assert.strictEqual(result.owner, 'owner');
                assert.strictEqual(result.repo, 'repo');
            });
        });

        describe('SSH URLs', () => {
            it('should parse SSH URL', () => {
                const result = parseGitHubUrl('git@github.com:owner/repo.git');
                assert.strictEqual(result.owner, 'owner');
                assert.strictEqual(result.repo, 'repo');
            });

            it('should parse SSH URL without .git suffix', () => {
                const result = parseGitHubUrl('git@github.com:owner/repo');
                assert.strictEqual(result.owner, 'owner');
                assert.strictEqual(result.repo, 'repo');
            });

            it('should parse SSH URL with dots in repo name', () => {
                const result = parseGitHubUrl('git@github.com:Amadeus-xDLC/genai.prompt-registry-config.git');
                assert.strictEqual(result.owner, 'Amadeus-xDLC');
                assert.strictEqual(result.repo, 'genai.prompt-registry-config');
            });
        });

        describe('Short format', () => {
            it('should parse owner/repo format', () => {
                const result = parseGitHubUrl('owner/repo');
                assert.strictEqual(result.owner, 'owner');
                assert.strictEqual(result.repo, 'repo');
            });

            it('should parse owner/repo.git format', () => {
                const result = parseGitHubUrl('owner/repo.git');
                assert.strictEqual(result.owner, 'owner');
                assert.strictEqual(result.repo, 'repo');
            });

            it('should parse short format with dots in repo name', () => {
                const result = parseGitHubUrl('Amadeus-xDLC/genai.prompt-registry-config');
                assert.strictEqual(result.owner, 'Amadeus-xDLC');
                assert.strictEqual(result.repo, 'genai.prompt-registry-config');
            });
        });

        describe('Edge cases', () => {
            it('should handle whitespace', () => {
                const result = parseGitHubUrl('  https://github.com/owner/repo  ');
                assert.strictEqual(result.owner, 'owner');
                assert.strictEqual(result.repo, 'repo');
            });

            it('should handle multiple trailing slashes', () => {
                const result = parseGitHubUrl('https://github.com/owner/repo///');
                assert.strictEqual(result.owner, 'owner');
                assert.strictEqual(result.repo, 'repo');
            });

            it('should throw error for invalid format', () => {
                assert.throws(() => {
                    parseGitHubUrl('not-a-valid-url');
                }, /Invalid GitHub URL format/);
            });

            it('should throw error for non-GitHub URL', () => {
                assert.throws(() => {
                    parseGitHubUrl('https://gitlab.com/owner/repo');
                }, /Invalid GitHub URL format/);
            });
        });
    });
});
