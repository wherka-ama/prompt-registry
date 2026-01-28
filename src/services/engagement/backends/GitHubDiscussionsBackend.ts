/**
 * GitHubDiscussionsBackend - Engagement backend using GitHub Discussions
 * 
 * Uses GitHub Discussions as the voting surface:
 * - Each collection maps to a Discussion
 * - Reactions (👍/👎) are used for voting
 * - Comments can be used for resource-level voting
 * 
 * This backend is read-heavy and write-light:
 * - Ratings are fetched from pre-computed ratings.json (via RatingService)
 * - Votes are submitted via GitHub REST API
 * - Telemetry and feedback are stored locally (not in GitHub)
 */

import * as vscode from 'vscode';
import axios from 'axios';
import { BaseEngagementBackend } from '../IEngagementBackend';
import {
    TelemetryEvent,
    TelemetryFilter,
    Rating,
    RatingStats,
    Feedback,
    BackendConfig,
    GitHubDiscussionsBackendConfig,
    EngagementResourceType,
} from '../../../types/engagement';
import { Logger } from '../../../utils/logger';
import { FileBackend } from './FileBackend';

/**
 * Mapping of resource IDs to GitHub Discussion numbers
 */
interface DiscussionMapping {
    resourceId: string;
    discussionNumber: number;
    commentId?: number;
}

/**
 * GitHub Discussions Backend implementation
 */
export class GitHubDiscussionsBackend extends BaseEngagementBackend {
    readonly type = 'github-discussions';
    
    private logger: Logger;
    private config?: GitHubDiscussionsBackendConfig;
    private owner: string = '';
    private repo: string = '';
    private discussionMappings: Map<string, DiscussionMapping> = new Map();
    
    // Use FileBackend for local storage of telemetry and feedback
    private localBackend: FileBackend;
    
    // Cache for user's votes
    private userVotes: Map<string, 'up' | 'down'> = new Map();

    // Storage path for local backend (can be set before initialize)
    private storagePath: string = '';

    constructor(storagePath?: string) {
        super();
        this.logger = Logger.getInstance();
        this.localBackend = new FileBackend();
        if (storagePath) {
            this.storagePath = storagePath;
        }
    }

    /**
     * Set storage path for local backend (must be called before initialize)
     */
    setStoragePath(path: string): void {
        this.storagePath = path;
    }

    /**
     * Initialize the backend
     */
    async initialize(config: BackendConfig): Promise<void> {
        if (config.type !== 'github-discussions') {
            throw new Error(`Invalid config type: ${config.type}. Expected 'github-discussions'.`);
        }

        this.config = config as GitHubDiscussionsBackendConfig;
        
        // Parse repository
        const [owner, repo] = this.config.repository.split('/');
        if (!owner || !repo) {
            throw new Error(`Invalid repository format: ${this.config.repository}. Expected 'owner/repo'.`);
        }
        this.owner = owner;
        this.repo = repo;

        // Initialize local backend for telemetry/feedback storage
        if (!this.storagePath) {
            throw new Error('Storage path is required. Call setStoragePath() before initialize().');
        }
        await this.localBackend.initialize({
            type: 'file',
            storagePath: this.storagePath,
        });

        this._initialized = true;
        this.logger.info(`GitHubDiscussionsBackend initialized for ${this.config.repository}`);
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this.localBackend.dispose();
        this.discussionMappings.clear();
        this.userVotes.clear();
        this._initialized = false;
    }

    /**
     * Set discussion mapping for a resource
     */
    setDiscussionMapping(resourceId: string, discussionNumber: number, commentId?: number): void {
        this.discussionMappings.set(resourceId, {
            resourceId,
            discussionNumber,
            commentId
        });
    }

    /**
     * Get GitHub access token via VS Code authentication
     */
    private async getAccessToken(): Promise<string> {
        const session = await vscode.authentication.getSession('github', ['repo'], {
            createIfNone: true
        });
        return session.accessToken;
    }

    // ========================================================================
    // Telemetry Operations (delegated to local backend)
    // ========================================================================

    async recordTelemetry(event: TelemetryEvent): Promise<void> {
        this.ensureInitialized();
        await this.localBackend.recordTelemetry(event);
    }

    async getTelemetry(filter?: TelemetryFilter): Promise<TelemetryEvent[]> {
        this.ensureInitialized();
        return this.localBackend.getTelemetry(filter);
    }

    async clearTelemetry(filter?: TelemetryFilter): Promise<void> {
        this.ensureInitialized();
        await this.localBackend.clearTelemetry(filter);
    }

    // ========================================================================
    // Rating Operations
    // ========================================================================

    /**
     * Submit a rating (vote) via GitHub Discussions reaction
     */
    async submitRating(rating: Rating): Promise<void> {
        this.ensureInitialized();

        const mapping = this.discussionMappings.get(rating.resourceId);
        if (!mapping) {
            this.logger.warn(`No discussion mapping for resource: ${rating.resourceId}`);
            // Fall back to local storage
            await this.localBackend.submitRating(rating);
            return;
        }

        try {
            const token = await this.getAccessToken();
            const reaction = rating.score >= 3 ? '+1' : '-1';

            // Remove existing reaction first (if any)
            await this.removeExistingReaction(mapping, token);

            // Add new reaction
            const url = mapping.commentId
                ? `https://api.github.com/repos/${this.owner}/${this.repo}/discussions/comments/${mapping.commentId}/reactions`
                : `https://api.github.com/repos/${this.owner}/${this.repo}/discussions/${mapping.discussionNumber}/reactions`;

            await axios.post(url, { content: reaction }, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            });

            // Cache the vote
            this.userVotes.set(rating.resourceId, rating.score >= 3 ? 'up' : 'down');

            this.logger.info(`Submitted ${reaction} reaction for ${rating.resourceId}`);
        } catch (error: any) {
            this.logger.error(`Failed to submit rating to GitHub: ${error.message}`, error);
            // Fall back to local storage
            await this.localBackend.submitRating(rating);
        }
    }

    /**
     * Remove existing reaction before adding new one
     */
    private async removeExistingReaction(mapping: DiscussionMapping, token: string): Promise<void> {
        try {
            const url = mapping.commentId
                ? `https://api.github.com/repos/${this.owner}/${this.repo}/discussions/comments/${mapping.commentId}/reactions`
                : `https://api.github.com/repos/${this.owner}/${this.repo}/discussions/${mapping.discussionNumber}/reactions`;

            const response = await axios.get<Array<{ id: number; user: { login: string }; content: string }>>(url, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            });

            // Find user's existing reactions
            const userInfo = await this.getCurrentUser(token);
            const userReactions = response.data.filter(r => 
                r.user.login === userInfo.login && (r.content === '+1' || r.content === '-1')
            );

            // Delete existing reactions
            for (const reaction of userReactions) {
                await axios.delete(
                    `https://api.github.com/repos/${this.owner}/${this.repo}/reactions/${reaction.id}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Accept': 'application/vnd.github+json',
                            'X-GitHub-Api-Version': '2022-11-28'
                        }
                    }
                );
            }
        } catch (error) {
            // Ignore errors - reaction may not exist
            this.logger.debug('No existing reaction to remove');
        }
    }

    /**
     * Get current GitHub user info
     */
    private async getCurrentUser(token: string): Promise<{ login: string }> {
        const response = await axios.get<{ login: string }>('https://api.github.com/user', {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github+json'
            }
        });
        return response.data;
    }

    /**
     * Get user's rating for a resource
     */
    async getRating(
        resourceType: EngagementResourceType,
        resourceId: string
    ): Promise<Rating | undefined> {
        this.ensureInitialized();

        // Check cache first
        const cachedVote = this.userVotes.get(resourceId);
        if (cachedVote) {
            return {
                id: `${resourceId}-vote`,
                resourceType,
                resourceId,
                score: cachedVote === 'up' ? 5 : 1,
                timestamp: new Date().toISOString()
            };
        }

        // Fall back to local backend
        return this.localBackend.getRating(resourceType, resourceId);
    }

    /**
     * Get aggregated rating statistics
     * Note: This returns cached/computed stats, not live data
     */
    async getAggregatedRatings(
        resourceType: EngagementResourceType,
        resourceId: string
    ): Promise<RatingStats | undefined> {
        this.ensureInitialized();
        // Aggregated ratings should come from RatingService/RatingCache
        // which fetches from the pre-computed ratings.json
        return this.localBackend.getAggregatedRatings(resourceType, resourceId);
    }

    /**
     * Delete user's rating (remove reaction)
     */
    async deleteRating(
        resourceType: EngagementResourceType,
        resourceId: string
    ): Promise<void> {
        this.ensureInitialized();

        const mapping = this.discussionMappings.get(resourceId);
        if (!mapping) {
            await this.localBackend.deleteRating(resourceType, resourceId);
            return;
        }

        try {
            const token = await this.getAccessToken();
            await this.removeExistingReaction(mapping, token);
            this.userVotes.delete(resourceId);
            this.logger.info(`Removed rating for ${resourceId}`);
        } catch (error: any) {
            this.logger.error(`Failed to delete rating from GitHub: ${error.message}`, error);
            await this.localBackend.deleteRating(resourceType, resourceId);
        }
    }

    // ========================================================================
    // Feedback Operations (delegated to local backend)
    // ========================================================================

    async submitFeedback(feedback: Feedback): Promise<void> {
        this.ensureInitialized();
        // Feedback is stored locally - could be extended to create GitHub comments
        await this.localBackend.submitFeedback(feedback);
    }

    async getFeedback(
        resourceType: EngagementResourceType,
        resourceId: string,
        limit?: number
    ): Promise<Feedback[]> {
        this.ensureInitialized();
        return this.localBackend.getFeedback(resourceType, resourceId, limit);
    }

    async deleteFeedback(feedbackId: string): Promise<void> {
        this.ensureInitialized();
        await this.localBackend.deleteFeedback(feedbackId);
    }
}
