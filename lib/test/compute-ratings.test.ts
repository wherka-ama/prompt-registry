/**
 * Tests for compute-ratings
 * Rating computation for GitHub Actions
 */

import * as assert from 'assert';
import {
    computeResourceRating,
    parseArgs,
    ResourceRating,
    CollectionMapping
} from '../src/compute-ratings';

describe('compute-ratings', () => {
    describe('computeResourceRating()', () => {
        it('should compute rating for resource with votes', () => {
            const rating = computeResourceRating(100, 10);
            
            assert.strictEqual(rating.up, 100);
            assert.strictEqual(rating.down, 10);
            assert.ok(rating.wilson_score > 0.8, 'Wilson score should be high for 100:10 ratio');
            assert.ok(rating.wilson_score < 1, 'Wilson score should be less than 1');
            assert.strictEqual(rating.confidence, 'very_high');
        });

        it('should compute rating for resource with no votes', () => {
            const rating = computeResourceRating(0, 0);
            
            assert.strictEqual(rating.up, 0);
            assert.strictEqual(rating.down, 0);
            assert.strictEqual(rating.wilson_score, 0);
            assert.strictEqual(rating.confidence, 'low');
        });

        it('should compute rating for resource with only upvotes', () => {
            const rating = computeResourceRating(3, 0);
            
            assert.strictEqual(rating.up, 3);
            assert.strictEqual(rating.down, 0);
            assert.ok(rating.wilson_score > 0.3, 'Wilson score should be positive');
            assert.ok(rating.wilson_score < 1, 'Wilson score should be penalized for low sample');
            assert.strictEqual(rating.confidence, 'low');
        });

        it('should compute rating for resource with only downvotes', () => {
            const rating = computeResourceRating(0, 3);
            
            assert.strictEqual(rating.up, 0);
            assert.strictEqual(rating.down, 3);
            assert.strictEqual(rating.wilson_score, 0);
            assert.strictEqual(rating.confidence, 'low');
        });

        it('should round scores to 3 decimal places', () => {
            const rating = computeResourceRating(73, 17);
            
            // Check that scores are rounded to 3 decimal places
            const wilsonStr = rating.wilson_score.toString();
            const decimalPart = wilsonStr.split('.')[1] || '';
            assert.ok(decimalPart.length <= 3, 'Wilson score should have at most 3 decimal places');
        });

        it('should assign correct confidence levels', () => {
            // Low: < 5 votes
            assert.strictEqual(computeResourceRating(2, 1).confidence, 'low');
            
            // Medium: 5-19 votes
            assert.strictEqual(computeResourceRating(10, 5).confidence, 'medium');
            
            // High: 20-99 votes
            assert.strictEqual(computeResourceRating(50, 30).confidence, 'high');
            
            // Very high: 100+ votes
            assert.strictEqual(computeResourceRating(80, 30).confidence, 'very_high');
        });

        it('should compute star rating between 1 and 5', () => {
            const rating = computeResourceRating(50, 10);
            
            assert.ok(rating.star_rating >= 1, 'Star rating should be at least 1');
            assert.ok(rating.star_rating <= 5, 'Star rating should be at most 5');
        });
    });

    describe('parseArgs()', () => {
        it('should parse config and output paths', () => {
            const result = parseArgs([]);
            
            assert.strictEqual(result.configPath, 'collections.yaml');
            assert.strictEqual(result.outputPath, 'ratings.json');
        });
        
        it('should parse --config flag', () => {
            const result = parseArgs(['--config', 'custom.yaml']);
            
            assert.strictEqual(result.configPath, 'custom.yaml');
        });
        
        it('should parse --output flag', () => {
            const result = parseArgs(['--output', 'custom.json']);
            
            assert.strictEqual(result.outputPath, 'custom.json');
        });
        
        it('should parse both flags', () => {
            const result = parseArgs(['--config', 'custom.yaml', '--output', 'custom.json']);
            
            assert.strictEqual(result.configPath, 'custom.yaml');
            assert.strictEqual(result.outputPath, 'custom.json');
        });
        
        it('should handle missing flags', () => {
            const result = parseArgs([]);
            
            assert.strictEqual(result.configPath, 'collections.yaml');
            assert.strictEqual(result.outputPath, 'ratings.json');
        });
    });

    describe('Rating Computation Edge Cases', () => {
        it('should handle very large vote counts', () => {
            const rating = computeResourceRating(10000, 500);
            
            assert.ok(rating.wilson_score > 0.9, 'Should have high score for 10000:500 ratio');
            assert.strictEqual(rating.confidence, 'very_high');
        });

        it('should handle equal up and down votes', () => {
            const rating = computeResourceRating(50, 50);
            
            assert.ok(rating.wilson_score < 0.5, 'Wilson score should be below 0.5 for 50:50');
            assert.ok(rating.wilson_score > 0.3, 'Wilson score should not be too low');
        });

        it('should handle mostly negative votes', () => {
            const rating = computeResourceRating(10, 90);
            
            assert.ok(rating.wilson_score < 0.2, 'Wilson score should be low for 10:90 ratio');
        });
    });
});
