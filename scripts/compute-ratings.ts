#!/usr/bin/env npx ts-node
/**
 * Rating Computation Script for GitHub Actions
 * 
 * Fetches reaction counts from GitHub Discussions and computes ratings
 * using Wilson score algorithm. Outputs ratings.json for static hosting.
 * 
 * Usage:
 *   npx ts-node scripts/compute-ratings.ts --config collections.yaml --output ratings.json
 *   
 * Environment:
 *   GITHUB_TOKEN - GitHub token with repo read access
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import axios from 'axios';

// Import rating algorithms (relative path for script execution)
import {
    wilsonLowerBound,
    bayesianSmoothing,
    aggregateResourceScores,
    getConfidenceLevel,
    calculateRatingMetrics,
    RatingMetrics
} from '../src/utils/ratingAlgorithms';

// ============================================================================
// Types
// ============================================================================

/**
 * Resource mapping in collections.yaml
 */
interface ResourceMapping {
    id: string;
    comment_id?: number;
}

/**
 * Collection mapping in collections.yaml
 */
interface CollectionMapping {
    id: string;
    discussion_number: number;
    resources?: ResourceMapping[];
}

/**
 * Collections configuration file structure
 */
interface CollectionsConfig {
    repository: string;
    collections: CollectionMapping[];
}

/**
 * Reaction counts from GitHub API
 */
interface ReactionCounts {
    '+1': number;
    '-1': number;
    laugh?: number;
    hooray?: number;
    confused?: number;
    heart?: number;
    rocket?: number;
    eyes?: number;
}

/**
 * Resource rating in output
 */
interface ResourceRating {
    up: number;
    down: number;
    wilson_score: number;
    bayesian_score: number;
    star_rating: number;
    confidence: string;
}

/**
 * Collection rating in output
 */
interface CollectionRating {
    discussion_number: number;
    up: number;
    down: number;
    wilson_score: number;
    bayesian_score: number;
    aggregated_score: number;
    star_rating: number;
    confidence: string;
    resources: Record<string, ResourceRating>;
}

/**
 * Output ratings.json structure
 */
interface RatingsOutput {
    generated_at: string;
    repository: string;
    collections: Record<string, CollectionRating>;
}

// ============================================================================
// GitHub API Functions
// ============================================================================

/**
 * Fetch reactions for a discussion
 */
async function fetchDiscussionReactions(
    owner: string,
    repo: string,
    discussionNumber: number,
    token: string
): Promise<ReactionCounts> {
    const url = `https://api.github.com/repos/${owner}/${repo}/discussions/${discussionNumber}/reactions`;
    
    try {
        const response = await axios.get<Array<{ content: string }>>(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28'
            }
        });

        const reactions = response.data;
        
        // Count reactions by type
        const counts: ReactionCounts = { '+1': 0, '-1': 0 };
        for (const reaction of reactions) {
            const content = reaction.content as keyof ReactionCounts;
            counts[content] = (counts[content] || 0) + 1;
        }
        
        return counts;
    } catch (error: any) {
        if (error.response?.status === 404) {
            console.warn(`Discussion #${discussionNumber} not found, using zero counts`);
            return { '+1': 0, '-1': 0 };
        }
        throw new Error(`GitHub API error: ${error.response?.status || 'unknown'} ${error.message}`);
    }
}

/**
 * Fetch reactions for a comment (resource-level voting)
 */
async function fetchCommentReactions(
    owner: string,
    repo: string,
    commentId: number,
    token: string
): Promise<ReactionCounts> {
    const url = `https://api.github.com/repos/${owner}/${repo}/discussions/comments/${commentId}/reactions`;
    
    try {
        const response = await axios.get<Array<{ content: string }>>(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28'
            }
        });

        const reactions = response.data;
        
        const counts: ReactionCounts = { '+1': 0, '-1': 0 };
        for (const reaction of reactions) {
            const content = reaction.content as keyof ReactionCounts;
            counts[content] = (counts[content] || 0) + 1;
        }
        
        return counts;
    } catch (error: any) {
        if (error.response?.status === 404) {
            console.warn(`Comment #${commentId} not found, using zero counts`);
            return { '+1': 0, '-1': 0 };
        }
        throw new Error(`GitHub API error: ${error.response?.status || 'unknown'} ${error.message}`);
    }
}

// ============================================================================
// Rating Computation
// ============================================================================

/**
 * Compute ratings for a single resource
 */
function computeResourceRating(up: number, down: number): ResourceRating {
    const metrics = calculateRatingMetrics(up, down);
    return {
        up,
        down,
        wilson_score: Math.round(metrics.wilsonScore * 1000) / 1000,
        bayesian_score: Math.round(metrics.bayesianScore * 1000) / 1000,
        star_rating: metrics.starRating,
        confidence: metrics.confidence
    };
}

/**
 * Compute ratings for a collection including all resources
 */
async function computeCollectionRating(
    collection: CollectionMapping,
    owner: string,
    repo: string,
    token: string
): Promise<CollectionRating> {
    console.log(`  Processing collection: ${collection.id}`);
    
    // Fetch discussion-level reactions
    const discussionReactions = await fetchDiscussionReactions(
        owner, repo, collection.discussion_number, token
    );
    
    const collectionUp = discussionReactions['+1'];
    const collectionDown = discussionReactions['-1'];
    const collectionMetrics = calculateRatingMetrics(collectionUp, collectionDown);
    
    // Process resources
    const resources: Record<string, ResourceRating> = {};
    const resourceScores: Array<{ score: number; voteCount: number }> = [];
    
    if (collection.resources && collection.resources.length > 0) {
        for (const resource of collection.resources) {
            if (resource.comment_id) {
                const reactions = await fetchCommentReactions(
                    owner, repo, resource.comment_id, token
                );
                const rating = computeResourceRating(reactions['+1'], reactions['-1']);
                resources[resource.id] = rating;
                resourceScores.push({
                    score: rating.wilson_score,
                    voteCount: rating.up + rating.down
                });
            }
        }
    }
    
    // Compute aggregated score from resources (if any)
    let aggregatedScore = collectionMetrics.wilsonScore;
    if (resourceScores.length > 0) {
        const resourceAggregated = aggregateResourceScores(resourceScores);
        // Blend collection-level and resource-level scores (70/30 split)
        aggregatedScore = 0.7 * collectionMetrics.wilsonScore + 0.3 * resourceAggregated;
    }
    
    return {
        discussion_number: collection.discussion_number,
        up: collectionUp,
        down: collectionDown,
        wilson_score: Math.round(collectionMetrics.wilsonScore * 1000) / 1000,
        bayesian_score: Math.round(collectionMetrics.bayesianScore * 1000) / 1000,
        aggregated_score: Math.round(aggregatedScore * 1000) / 1000,
        star_rating: collectionMetrics.starRating,
        confidence: collectionMetrics.confidence,
        resources
    };
}

// ============================================================================
// Main Script
// ============================================================================

/**
 * Parse command line arguments
 */
function parseArgs(): { configPath: string; outputPath: string } {
    const args = process.argv.slice(2);
    let configPath = 'collections.yaml';
    let outputPath = 'ratings.json';
    
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--config' && args[i + 1]) {
            configPath = args[i + 1];
            i++;
        } else if (args[i] === '--output' && args[i + 1]) {
            outputPath = args[i + 1];
            i++;
        }
    }
    
    return { configPath, outputPath };
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
    const { configPath, outputPath } = parseArgs();
    
    // Check for GitHub token
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
        console.error('Error: GITHUB_TOKEN environment variable is required');
        process.exit(1);
    }
    
    // Load collections config
    if (!fs.existsSync(configPath)) {
        console.error(`Error: Config file not found: ${configPath}`);
        process.exit(1);
    }
    
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = yaml.load(configContent) as CollectionsConfig;
    
    if (!config.repository || !config.collections) {
        console.error('Error: Invalid config file. Must have "repository" and "collections" fields.');
        process.exit(1);
    }
    
    const [owner, repo] = config.repository.split('/');
    if (!owner || !repo) {
        console.error('Error: Invalid repository format. Expected "owner/repo".');
        process.exit(1);
    }
    
    console.log(`Computing ratings for ${config.repository}`);
    console.log(`Processing ${config.collections.length} collections...`);
    
    // Process all collections
    const collections: Record<string, CollectionRating> = {};
    
    for (const collection of config.collections) {
        try {
            collections[collection.id] = await computeCollectionRating(
                collection, owner, repo, token
            );
        } catch (error) {
            console.error(`  Error processing ${collection.id}:`, error);
            // Continue with other collections
        }
    }
    
    // Generate output
    const output: RatingsOutput = {
        generated_at: new Date().toISOString(),
        repository: config.repository,
        collections
    };
    
    // Write output
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`\nRatings written to: ${outputPath}`);
    
    // Summary
    const totalCollections = Object.keys(collections).length;
    const totalResources = Object.values(collections).reduce(
        (sum, c) => sum + Object.keys(c.resources).length, 0
    );
    console.log(`Summary: ${totalCollections} collections, ${totalResources} resources`);
}

// Run if executed directly (not when imported for testing)
if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

// Export for testing
export {
    CollectionsConfig,
    CollectionMapping,
    ResourceMapping,
    RatingsOutput,
    CollectionRating,
    ResourceRating,
    computeResourceRating,
    parseArgs
};
