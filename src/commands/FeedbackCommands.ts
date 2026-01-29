/**
 * FeedbackCommands - VS Code commands for collecting user feedback
 * 
 * Provides dialogs for users to submit feedback on bundles and profiles.
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { Logger } from '../utils/logger';
import { EngagementService } from '../services/engagement/EngagementService';
import { RatingScore, Feedback, EngagementResourceType } from '../types/engagement';

/**
 * Item that can receive feedback
 */
export interface FeedbackableItem {
    /** Resource ID (bundle ID, profile ID, etc.) */
    resourceId: string;
    /** Resource type */
    resourceType: EngagementResourceType;
    /** Display name for the resource */
    name?: string;
    /** Version of the resource */
    version?: string;
}

/**
 * Feedback submission result
 */
export interface FeedbackResult {
    success: boolean;
    feedback?: Feedback;
    error?: string;
}

/**
 * Commands for feedback collection
 */
export class FeedbackCommands {
    private readonly logger = Logger.getInstance();
    private engagementService?: EngagementService;
    private readonly maxCommentLength: number;

    constructor(engagementService?: EngagementService, maxCommentLength: number = 1000) {
        this.engagementService = engagementService;
        this.maxCommentLength = maxCommentLength;
    }

    /**
     * Set the engagement service (for lazy initialization)
     */
    setEngagementService(service: EngagementService): void {
        this.engagementService = service;
    }

    /**
     * Register feedback commands with VS Code
     */
    registerCommands(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.commands.registerCommand(
                'promptRegistry.submitFeedback',
                (item: FeedbackableItem | any) => this.submitFeedback(this.normalizeFeedbackItem(item))
            ),
            vscode.commands.registerCommand(
                'promptRegistry.submitFeedbackWithRating',
                (item: FeedbackableItem | any) => this.submitFeedbackWithRating(this.normalizeFeedbackItem(item))
            ),
            vscode.commands.registerCommand(
                'promptRegistry.quickFeedback',
                (item: FeedbackableItem | any) => this.quickFeedback(this.normalizeFeedbackItem(item))
            )
        );

        this.logger.debug('FeedbackCommands registered');
    }

    /**
     * Normalize various input types to FeedbackableItem
     * Handles TreeView items, direct FeedbackableItem, or bundleId strings
     */
    private normalizeFeedbackItem(item: any): FeedbackableItem {
        // If it's already a FeedbackableItem
        if (item?.resourceId && item?.resourceType) {
            return item as FeedbackableItem;
        }

        // If it's a TreeView item with data (InstalledBundle)
        if (item?.data?.bundleId) {
            return {
                resourceId: item.data.bundleId,
                resourceType: 'bundle',
                name: item.label || item.data.bundleId,
                version: item.data.version,
            };
        }

        // If it's a direct InstalledBundle or Bundle object
        if (item?.bundleId) {
            return {
                resourceId: item.bundleId,
                resourceType: 'bundle',
                name: item.name || item.bundleId,
                version: item.version,
            };
        }

        // If it's just a string (bundleId)
        if (typeof item === 'string') {
            return {
                resourceId: item,
                resourceType: 'bundle',
                name: item,
            };
        }

        // Default fallback - prompt user to select
        return {
            resourceId: 'unknown',
            resourceType: 'bundle',
            name: 'Unknown Resource',
        };
    }

    /**
     * Submit feedback for a resource (comment only)
     */
    async submitFeedback(item: FeedbackableItem): Promise<FeedbackResult> {
        const resourceName = item.name || item.resourceId;

        // Show input box for feedback comment
        const comment = await vscode.window.showInputBox({
            title: `Feedback for ${resourceName}`,
            prompt: 'Enter your feedback (optional: include suggestions, issues, or praise)',
            placeHolder: 'Your feedback here...',
            validateInput: (value) => {
                if (value.length > this.maxCommentLength) {
                    return `Feedback must be ${this.maxCommentLength} characters or less (currently ${value.length})`;
                }
                return null;
            },
        });

        if (comment === undefined) {
            // User cancelled
            return { success: false, error: 'Cancelled' };
        }

        if (comment.trim().length === 0) {
            vscode.window.showWarningMessage('Feedback cannot be empty');
            return { success: false, error: 'Empty feedback' };
        }

        return this.saveFeedback(item, comment.trim());
    }

    /**
     * Submit feedback with a rating
     */
    async submitFeedbackWithRating(item: FeedbackableItem): Promise<FeedbackResult> {
        const resourceName = item.name || item.resourceId;

        // First, ask for rating
        const ratingOptions: vscode.QuickPickItem[] = [
            { label: '⭐⭐⭐⭐⭐', description: '5 - Excellent', detail: 'This is amazing!' },
            { label: '⭐⭐⭐⭐', description: '4 - Good', detail: 'Works well with minor issues' },
            { label: '⭐⭐⭐', description: '3 - Average', detail: 'Does the job' },
            { label: '⭐⭐', description: '2 - Below Average', detail: 'Needs improvement' },
            { label: '⭐', description: '1 - Poor', detail: 'Does not meet expectations' },
        ];

        const selectedRating = await vscode.window.showQuickPick(ratingOptions, {
            title: `Rate ${resourceName}`,
            placeHolder: 'Select a rating',
        });

        if (!selectedRating) {
            return { success: false, error: 'Cancelled' };
        }

        const rating = this.parseRating(selectedRating.description || '');

        // Then, ask for comment
        const comment = await vscode.window.showInputBox({
            title: `Feedback for ${resourceName}`,
            prompt: 'Add a comment to your rating (optional)',
            placeHolder: 'Your feedback here...',
            validateInput: (value) => {
                if (value.length > this.maxCommentLength) {
                    return `Feedback must be ${this.maxCommentLength} characters or less`;
                }
                return null;
            },
        });

        if (comment === undefined) {
            return { success: false, error: 'Cancelled' };
        }

        return this.saveFeedback(item, comment.trim() || `Rated ${rating} stars`, rating);
    }

    /**
     * Quick feedback with predefined options
     */
    async quickFeedback(item: FeedbackableItem): Promise<FeedbackResult> {
        const resourceName = item.name || item.resourceId;

        const quickOptions: vscode.QuickPickItem[] = [
            { label: '👍 Works great!', description: 'Positive feedback' },
            { label: '💡 Suggestion', description: 'I have an idea for improvement' },
            { label: '🐛 Bug report', description: 'Something is not working' },
            { label: '❓ Question', description: 'I need help understanding this' },
            { label: '✏️ Custom feedback', description: 'Write your own feedback' },
        ];

        const selected = await vscode.window.showQuickPick(quickOptions, {
            title: `Quick Feedback for ${resourceName}`,
            placeHolder: 'Select feedback type',
        });

        if (!selected) {
            return { success: false, error: 'Cancelled' };
        }

        let comment: string;
        let rating: RatingScore | undefined;

        if (selected.label === '✏️ Custom feedback') {
            // Redirect to full feedback dialog
            return this.submitFeedback(item);
        } else if (selected.label === '👍 Works great!') {
            comment = 'Works great!';
            rating = 5;
        } else {
            // Ask for details
            const details = await vscode.window.showInputBox({
                title: `${selected.label} for ${resourceName}`,
                prompt: 'Please provide details',
                placeHolder: selected.description,
                validateInput: (value) => {
                    if (value.length > this.maxCommentLength) {
                        return `Feedback must be ${this.maxCommentLength} characters or less`;
                    }
                    return null;
                },
            });

            if (details === undefined || details.trim().length === 0) {
                return { success: false, error: 'Cancelled or empty' };
            }

            comment = `[${selected.label.split(' ')[0]}] ${details.trim()}`;
        }

        return this.saveFeedback(item, comment, rating);
    }

    /**
     * Save feedback to the engagement service
     */
    private async saveFeedback(
        item: FeedbackableItem,
        comment: string,
        rating?: RatingScore
    ): Promise<FeedbackResult> {
        try {
            if (!this.engagementService) {
                // Store locally without engagement service
                this.logger.info(`Feedback for ${item.resourceId}: ${comment}`);
                vscode.window.showInformationMessage('Thank you for your feedback!');
                return {
                    success: true,
                    feedback: {
                        id: crypto.randomUUID(),
                        resourceType: item.resourceType,
                        resourceId: item.resourceId,
                        comment,
                        rating,
                        version: item.version,
                        timestamp: new Date().toISOString(),
                    },
                };
            }

            const feedback = await this.engagementService.submitFeedback(
                item.resourceType,
                item.resourceId,
                comment,
                { version: item.version, rating }
            );

            vscode.window.showInformationMessage('Thank you for your feedback!');
            this.logger.info(`Feedback submitted for ${item.resourceId}`);

            return { success: true, feedback };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error(`Failed to submit feedback: ${message}`, error as Error);
            vscode.window.showErrorMessage(`Failed to submit feedback: ${message}`);
            return { success: false, error: message };
        }
    }

    /**
     * Parse rating from description string
     */
    private parseRating(description: string): RatingScore {
        const match = description.match(/^(\d)/);
        if (match) {
            const num = parseInt(match[1], 10);
            if (num >= 1 && num <= 5) {
                return num as RatingScore;
            }
        }
        return 3; // Default to average
    }
}
