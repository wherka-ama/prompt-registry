/**
 * Tests for compute-ratings script
 * Rating computation for GitHub Actions
 */

import * as assert from 'assert';
import {
    computeResourceRating,
    parseArgs,
    ResourceRating,
    CollectionMapping
} from '../../scripts/compute-ratings';

suite('compute-ratings script', () => {
    suite('computeResourceRating()', () => {
        test('should compute rating for resource with votes', () => {
            const rating = computeResourceRating(100, 10);
            
            assert.strictEqual(rating.up, 100);
            assert.strictEqual(rating.down, 10);
            assert.ok(rating.wilson_score > 0.8, 'Wilson score should be high for 100:10 ratio');
            assert.ok(rating.wilson_score < 1, 'Wilson score should be less than 1');
            assert.strictEqual(rating.confidence, 'very_high');
        });

        test('should compute rating for resource with no votes', () => {
            const rating = computeResourceRating(0, 0);
            
            assert.strictEqual(rating.up, 0);
            assert.strictEqual(rating.down, 0);
            assert.strictEqual(rating.wilson_score, 0);
            assert.strictEqual(rating.confidence, 'low');
        });

        test('should compute rating for resource with only upvotes', () => {
            const rating = computeResourceRating(3, 0);
            
            assert.strictEqual(rating.up, 3);
            assert.strictEqual(rating.down, 0);
            assert.ok(rating.wilson_score > 0.3, 'Wilson score should be positive');
            assert.ok(rating.wilson_score < 1, 'Wilson score should be penalized for low sample');
            assert.strictEqual(rating.confidence, 'low');
        });

        test('should compute rating for resource with only downvotes', () => {
            const rating = computeResourceRating(0, 3);
            
            assert.strictEqual(rating.up, 0);
            assert.strictEqual(rating.down, 3);
            assert.strictEqual(rating.wilson_score, 0);
            assert.strictEqual(rating.confidence, 'low');
        });

        test('should round scores to 3 decimal places', () => {
            const rating = computeResourceRating(73, 17);
            
            // Check that scores are rounded to 3 decimal places
            const wilsonStr = rating.wilson_score.toString();
            const decimalPart = wilsonStr.split('.')[1] || '';
            assert.ok(decimalPart.length <= 3, 'Wilson score should have at most 3 decimal places');
        });

        test('should assign correct confidence levels', () => {
            // Low: < 5 votes
            assert.strictEqual(computeResourceRating(2, 1).confidence, 'low');
            
            // Medium: 5-19 votes
            assert.strictEqual(computeResourceRating(10, 5).confidence, 'medium');
            
            // High: 20-99 votes
            assert.strictEqual(computeResourceRating(50, 30).confidence, 'high');
            
            // Very high: 100+ votes
            assert.strictEqual(computeResourceRating(80, 30).confidence, 'very_high');
        });

        test('should compute star rating between 1 and 5', () => {
            const rating = computeResourceRating(50, 10);
            
            assert.ok(rating.star_rating >= 1, 'Star rating should be at least 1');
            assert.ok(rating.star_rating <= 5, 'Star rating should be at most 5');
        });
    });

    suite('parseArgs()', () => {
        const originalArgv = process.argv;

        teardown(() => {
            process.argv = originalArgv;
        });

        test('should return default values when no args provided', () => {
            process.argv = ['node', 'script.js'];
            const args = parseArgs();
            
            assert.strictEqual(args.configPath, 'collections.yaml');
            assert.strictEqual(args.outputPath, 'ratings.json');
        });

        test('should parse --config argument', () => {
            process.argv = ['node', 'script.js', '--config', 'custom.yaml'];
            const args = parseArgs();
            
            assert.strictEqual(args.configPath, 'custom.yaml');
            assert.strictEqual(args.outputPath, 'ratings.json');
        });

        test('should parse --output argument', () => {
            process.argv = ['node', 'script.js', '--output', 'custom-ratings.json'];
            const args = parseArgs();
            
            assert.strictEqual(args.configPath, 'collections.yaml');
            assert.strictEqual(args.outputPath, 'custom-ratings.json');
        });

        test('should parse both arguments', () => {
            process.argv = ['node', 'script.js', '--config', 'my-config.yaml', '--output', 'my-ratings.json'];
            const args = parseArgs();
            
            assert.strictEqual(args.configPath, 'my-config.yaml');
            assert.strictEqual(args.outputPath, 'my-ratings.json');
        });

        test('should handle arguments in any order', () => {
            process.argv = ['node', 'script.js', '--output', 'out.json', '--config', 'in.yaml'];
            const args = parseArgs();
            
            assert.strictEqual(args.configPath, 'in.yaml');
            assert.strictEqual(args.outputPath, 'out.json');
        });
    });

    suite('Rating Computation Edge Cases', () => {
        test('should handle very large vote counts', () => {
            const rating = computeResourceRating(10000, 500);
            
            assert.ok(rating.wilson_score > 0.9, 'Should have high score for 10000:500 ratio');
            assert.strictEqual(rating.confidence, 'very_high');
        });

        test('should handle equal up and down votes', () => {
            const rating = computeResourceRating(50, 50);
            
            assert.ok(rating.wilson_score < 0.5, 'Wilson score should be below 0.5 for 50:50');
            assert.ok(rating.wilson_score > 0.3, 'Wilson score should not be too low');
        });

        test('should handle mostly negative votes', () => {
            const rating = computeResourceRating(10, 90);
            
            assert.ok(rating.wilson_score < 0.2, 'Wilson score should be low for 10:90 ratio');
        });
    });
});
