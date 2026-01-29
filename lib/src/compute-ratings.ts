/**
 * Rating Computation for GitHub Actions
 * 
 * Fetches reaction counts from GitHub Discussions and computes ratings
 * using Wilson score algorithm. Outputs ratings.json for static hosting.
 */

import * as fs from 'fs';
import * as yaml from 'js-yaml';
import axios from 'axios';

// ============================================================================
// Types
// ============================================================================

/**
 * Resource mapping in collections.yaml
 */
export interface ResourceMapping {
    id: string;
    comment_id?: number;
}

/**
 * Collection mapping in collections.yaml
 */
export interface CollectionMapping {
    id: string;
    source_id?: string;
    discussion_number: number;
    resources?: ResourceMapping[];
}

/**
 * Collections configuration file structure
 */
export interface CollectionsConfig {
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
export interface ResourceRating {
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
export interface CollectionRating {
    source_id?: string;
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
export interface RatingsOutput {
    generated_at: string;
    repository: string;
    collections: Record<string, CollectionRating>;
}

/**
 * Rating metrics calculation result
 */
interface RatingMetrics {
    wilsonScore: number;
    bayesianScore: number;
    starRating: number;
    confidence: string;
}

// ============================================================================
// Rating Algorithms (inline to avoid circular dependencies)
// ============================================================================

/**
 * Calculate Wilson score lower bound (95% confidence)
 */
function wilsonLowerBound(upvotes: number, downvotes: number): number {
    const n = upvotes + downvotes;
    if (n === 0) {
        return 0;
    }
    
    const z = 1.96; // 95% confidence
    const phat = upvotes / n;
    
    return (phat + z * z / (2 * n) - z * Math.sqrt((phat * (1 - phat) + z * z / (4 * n)) / n)) / (1 + z * z / n);
}

/**
 * Calculate Bayesian smoothed rating
 */
function bayesianSmoothing(upvotes: number, downvotes: number, priorMean: number = 3.5, priorWeight: number = 10): number {
    const totalVotes = upvotes + downvotes;
    const observedMean = totalVotes > 0 ? (upvotes / totalVotes) * 5 : priorMean;
    
    return (observedMean * totalVotes + priorMean * priorWeight) / (totalVotes + priorWeight);
}

/**
 * Get confidence level based on vote count
 */
function getConfidenceLevel(voteCount: number): string {
    if (voteCount >= 100) {
        return 'very_high';
    } else if (voteCount >= 20) {
        return 'high';
    } else if (voteCount >= 5) {
        return 'medium';
    } else {
        return 'low';
    }
}

/**
 * Calculate all rating metrics
 */
function calculateRatingMetrics(upvotes: number, downvotes: number): RatingMetrics {
    const wilsonScore = wilsonLowerBound(upvotes, downvotes);
    const bayesianScore = bayesianSmoothing(upvotes, downvotes);
    const starRating = Math.round(bayesianScore * 10) / 10;
    const confidence = getConfidenceLevel(upvotes + downvotes);
    
    return {
        wilsonScore,
        bayesianScore,
        starRating,
        confidence
    };
}

/**
 * Aggregate resource scores into collection score
 */
function aggregateResourceScores(resources: Array<{ score: number; voteCount: number }>): number {
    if (resources.length === 0) {
        return 0;
    }
    
    const totalVotes = resources.reduce((sum, r) => sum + r.voteCount, 0);
    if (totalVotes === 0) {
        return 0;
    }
    
    return resources.reduce((sum, r) => sum + r.score * r.voteCount, 0) / totalVotes;
}

// ============================================================================
// GitHub API Functions
// ============================================================================

/**
 * Fetch all reactions with pagination support
 * GitHub API returns max 100 items per page
 */
async function fetchAllReactions(
    url: string,
    token: string
): Promise<Array<{ content: string }>> {
    const allReactions: Array<{ content: string }> = [];
    let page = 1;
    const perPage = 100;
    
    while (true) {
        const response = await axios.get<Array<{ content: string }>>(
            `${url}?per_page=${perPage}&page=${page}`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            }
        );
        
        const reactions = response.data;
        allReactions.push(...reactions);
        
        // If we got fewer than perPage results, we've reached the end
        if (reactions.length < perPage) {
            break;
        }
        
        page++;
        
        // Safety limit to prevent infinite loops
        if (page > 100) {
            console.warn(`Pagination limit reached for ${url}`);
            break;
        }
    }
    
    return allReactions;
}

/**
 * Fetch reactions for a discussion (with pagination)
 */
async function fetchDiscussionReactions(
    owner: string,
    repo: string,
    discussionNumber: number,
    token: string
): Promise<ReactionCounts> {
    const url = `https://api.github.com/repos/${owner}/${repo}/discussions/${discussionNumber}/reactions`;
    
    try {
        const reactions = await fetchAllReactions(url, token);
        
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
 * Fetch reactions for a comment (resource-level voting, with pagination)
 */
async function fetchCommentReactions(
    owner: string,
    repo: string,
    commentId: number,
    token: string
): Promise<ReactionCounts> {
    const url = `https://api.github.com/repos/${owner}/${repo}/discussions/comments/${commentId}/reactions`;
    
    try {
        const reactions = await fetchAllReactions(url, token);
        
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
export function computeResourceRating(up: number, down: number): ResourceRating {
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
        source_id: collection.source_id,
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
export function parseArgs(args: string[]): { configPath: string; outputPath: string } {
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
export async function computeRatings(configPath: string, outputPath: string, token: string): Promise<void> {
    // Load collections config
    if (!fs.existsSync(configPath)) {
        throw new Error(`Config file not found: ${configPath}`);
    }
    
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = yaml.load(configContent) as CollectionsConfig;
    
    if (!config.repository || !config.collections) {
        throw new Error('Invalid config file. Must have "repository" and "collections" fields.');
    }
    
    const [owner, repo] = config.repository.split('/');
    if (!owner || !repo) {
        throw new Error('Invalid repository format. Expected "owner/repo".');
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
