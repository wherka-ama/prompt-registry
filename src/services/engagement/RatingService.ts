/**
 * RatingService - Fetches and caches bundle ratings from hub sources
 * 
 * Ratings are served as static JSON files from hubs, computed by GitHub Actions.
 * This service fetches, caches, and provides ratings data to UI components.
 */

import axios from 'axios';
import { Logger } from '../../utils/logger';
import { RatingStats } from '../../types/engagement';

/**
 * Rating data for a single bundle
 */
export interface BundleRating {
    bundleId: string;
    upvotes: number;
    downvotes: number;
    wilsonScore: number;
    starRating: number;
    totalVotes: number;
    lastUpdated: string;
}

/**
 * Ratings file structure served by hubs
 */
export interface RatingsData {
    version: string;
    generatedAt: string;
    bundles: Record<string, BundleRating>;
}

/**
 * Service for fetching and caching bundle ratings
 */
export class RatingService {
    private static instance: RatingService;
    private readonly logger = Logger.getInstance();
    private ratingsCache: Map<string, RatingsData> = new Map();
    private cacheExpiry: Map<string, number> = new Map();
    private readonly cacheDurationMs: number;

    private constructor(cacheDurationMinutes: number = 15) {
        this.cacheDurationMs = cacheDurationMinutes * 60 * 1000;
    }

    /**
     * Get singleton instance
     */
    static getInstance(): RatingService {
        if (!RatingService.instance) {
            RatingService.instance = new RatingService();
        }
        return RatingService.instance;
    }

    /**
     * Reset instance (for testing)
     */
    static resetInstance(): void {
        RatingService.instance = undefined as unknown as RatingService;
    }

    /**
     * Fetch ratings from a hub's ratings.json URL
     * @param ratingsUrl URL to the ratings.json file
     * @param forceRefresh Force refresh even if cached
     */
    async fetchRatings(ratingsUrl: string, forceRefresh: boolean = false): Promise<RatingsData | undefined> {
        // Check cache
        if (!forceRefresh && this.ratingsCache.has(ratingsUrl)) {
            const expiry = this.cacheExpiry.get(ratingsUrl) || 0;
            if (Date.now() < expiry) {
                return this.ratingsCache.get(ratingsUrl);
            }
        }

        try {
            // Add cache-busting query parameter
            const urlWithCacheBust = `${ratingsUrl}?t=${Date.now()}`;
            const response = await axios.get<RatingsData>(urlWithCacheBust, {
                timeout: 10000,
                headers: {
                    'Accept': 'application/json',
                },
            });

            const data = response.data;
            
            // Validate structure
            if (!data.bundles || typeof data.bundles !== 'object') {
                this.logger.warn(`Invalid ratings data from ${ratingsUrl}`);
                return undefined;
            }

            // Cache the result
            this.ratingsCache.set(ratingsUrl, data);
            this.cacheExpiry.set(ratingsUrl, Date.now() + this.cacheDurationMs);

            this.logger.debug(`Fetched ratings from ${ratingsUrl}: ${Object.keys(data.bundles).length} bundles`);
            return data;
        } catch (error) {
            const err = error instanceof Error ? error : undefined;
            this.logger.debug(`Failed to fetch ratings from ${ratingsUrl}`, err);
            return undefined;
        }
    }

    /**
     * Get rating for a specific bundle
     * @param ratingsUrl URL to the ratings.json file
     * @param bundleId Bundle identifier
     */
    async getBundleRating(ratingsUrl: string, bundleId: string): Promise<BundleRating | undefined> {
        const ratings = await this.fetchRatings(ratingsUrl);
        return ratings?.bundles[bundleId];
    }

    /**
     * Get rating stats for a bundle (compatible with RatingStats type)
     * @param ratingsUrl URL to the ratings.json file
     * @param bundleId Bundle identifier
     */
    async getRatingStats(ratingsUrl: string, bundleId: string): Promise<RatingStats | undefined> {
        const rating = await this.getBundleRating(ratingsUrl, bundleId);
        if (!rating) {
            return undefined;
        }

        // Convert BundleRating to RatingStats
        // Map upvotes to 5-star, downvotes to 1-star for distribution
        return {
            resourceId: bundleId,
            averageRating: rating.starRating,
            ratingCount: rating.totalVotes,
            distribution: {
                1: rating.downvotes,
                2: 0,
                3: 0,
                4: 0,
                5: rating.upvotes,
            },
        };
    }

    /**
     * Format rating for display in tree view
     * @param rating Bundle rating data
     * @returns Formatted string like "★ 4.2" or "👍 42"
     */
    formatRatingForDisplay(rating: BundleRating): string {
        if (rating.totalVotes === 0) {
            return '';
        }

        // Use star rating if we have enough votes for confidence
        if (rating.totalVotes >= 5) {
            return `★ ${rating.starRating.toFixed(1)}`;
        }

        // For fewer votes, just show thumbs up count
        return `👍 ${rating.upvotes}`;
    }

    /**
     * Get formatted rating string for a bundle
     * @param ratingsUrl URL to the ratings.json file
     * @param bundleId Bundle identifier
     */
    async getFormattedRating(ratingsUrl: string, bundleId: string): Promise<string> {
        const rating = await this.getBundleRating(ratingsUrl, bundleId);
        if (!rating) {
            return '';
        }
        return this.formatRatingForDisplay(rating);
    }

    /**
     * Clear all cached ratings
     */
    clearCache(): void {
        this.ratingsCache.clear();
        this.cacheExpiry.clear();
    }

    /**
     * Clear cached ratings for a specific URL
     */
    clearCacheForUrl(ratingsUrl: string): void {
        this.ratingsCache.delete(ratingsUrl);
        this.cacheExpiry.delete(ratingsUrl);
    }

    /**
     * Check if ratings are cached for a URL
     */
    isCached(ratingsUrl: string): boolean {
        if (!this.ratingsCache.has(ratingsUrl)) {
            return false;
        }
        const expiry = this.cacheExpiry.get(ratingsUrl) || 0;
        return Date.now() < expiry;
    }
}
