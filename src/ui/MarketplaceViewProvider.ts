/**
 * Marketplace View Provider
 * Displays a visual marketplace for browsing and installing prompt bundles
 * Similar to open-vsx.org marketplace experience
 */

import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { RegistryManager } from '../services/RegistryManager';
import { Bundle, InstalledBundle, RegistrySource } from '../types/registry';
import { UI_CONSTANTS } from '../utils/constants';
import { extractAllTags, extractBundleSources } from '../utils/filterUtils';
import { VersionManager } from '../utils/versionManager';
import { BundleIdentityMatcher } from '../utils/bundleIdentityMatcher';
import { McpServerConfig, McpStdioServerConfig, McpRemoteServerConfig, isStdioServerConfig, isRemoteServerConfig } from '../types/mcp';
import { RatingCache } from '../services/engagement/RatingCache';
import { FeedbackCache } from '../services/engagement/FeedbackCache';

/**
 * Message types sent from webview to extension
 */
interface WebviewMessage {
    type: 'refresh' | 'install' | 'update' | 'uninstall' | 'openDetails' | 'openPromptFile' | 'installVersion' | 'getVersions' | 'toggleAutoUpdate' | 'openSourceRepository' | 'getFeedbacks';
    bundleId?: string;
    installPath?: string;
    filePath?: string;
    version?: string;
    enabled?: boolean;
    sourceId?: string;
}

/**
 * Content breakdown showing count of each resource type
 */
interface ContentBreakdown {
    prompts: number;
    instructions: number;
    chatmodes: number;
    agents: number;
    skills: number;
    mcpServers: number;
}

export class MarketplaceViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'promptregistry.marketplace';

    private _view?: vscode.WebviewView;
    private readonly logger: Logger;
    private sourceSyncDebounceTimer?: NodeJS.Timeout;
    private isLoadingBundles = false;
    private disposables: vscode.Disposable[] = [];

    /**
     * Escape HTML special characters to prevent XSS
     */
    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly registryManager: RegistryManager
    ) {
        this.logger = Logger.getInstance();

        // Listen to bundle and source events to refresh marketplace
        this.disposables.push(
            this.registryManager.onBundleInstalled((installation) => {
                this.handleBundleEvent('installed', installation.bundleId, () => this.loadBundles());
            }),
            this.registryManager.onBundleUninstalled((bundleId) => {
                this.handleBundleEvent('uninstalled', bundleId, () => this.loadBundles());
            }),
            this.registryManager.onBundleUpdated((installation) => {
                this.handleBundleEvent('updated', installation.bundleId, () => this.loadBundles());
            }),
            this.registryManager.onBundlesInstalled((installations) => {
                this.handleBundleEvent('installed', `${installations.length} bundles`, () => this.loadBundles());
            }),
            this.registryManager.onBundlesUninstalled((bundleIds) => {
                this.handleBundleEvent('uninstalled', `${bundleIds.length} bundles`, () => this.loadBundles());
            }),
            // Source sync events with debouncing
            this.registryManager.onSourceSynced((event) => this.handleSourceSynced(event)),
            // Auto-update preference changes
            this.registryManager.onAutoUpdatePreferenceChanged(() => this.loadBundles()),
            // Repository bundle changes (lockfile changes, workspace folder changes)
            this.registryManager.onRepositoryBundlesChanged(() => this.loadBundles())
        );
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri]
        };

        webviewView.webview.html = this.getHtmlContent(webviewView.webview);

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            await this.handleMessage(message);
        });

        // Load bundles with a small delay to ensure webview JavaScript is ready
        // The webview also sends a refresh request when ready as a backup
        setTimeout(() => {
            this.loadBundles();
        }, UI_CONSTANTS.WEBVIEW_READY_DELAY_MS);
    }

    /**
     * Handle bundle events with error handling and user notification
     */
    private handleBundleEvent(
        eventType: 'installed' | 'uninstalled' | 'updated',
        bundleId: string,
        action: () => void | Promise<void>
    ): void {
        try {
            this.logger.debug(`Bundle ${eventType} event received: ${bundleId}, refreshing marketplace`);
            action();
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.logger.error(`Error handling bundle ${eventType} event`, error as Error);
            
            // Show user-facing error notification
            vscode.window.showErrorMessage(
                `Failed to refresh marketplace after bundle ${eventType}: ${errorMsg}`
            );
        }
    }

    /**
     * Handle source synced event with leading-edge debouncing
     * Fires immediately on first event, then debounces subsequent events
     * This ensures progressive loading - UI updates as soon as first source syncs
     */
    private handleSourceSynced(event: { sourceId: string; bundleCount: number }): void {
        this.logger.debug(`Source synced: ${event.sourceId} (${event.bundleCount} bundles)`);

        const isFirstEvent = !this.sourceSyncDebounceTimer;

        // Clear existing timer if any
        if (this.sourceSyncDebounceTimer) {
            clearTimeout(this.sourceSyncDebounceTimer);
        }

        // Fire immediately on first event (leading edge)
        if (isFirstEvent) {
            this.loadBundles();
        }

        // Set trailing edge timer
        this.sourceSyncDebounceTimer = setTimeout(() => {
            this.sourceSyncDebounceTimer = undefined;
            this.loadBundles();
        }, UI_CONSTANTS.SOURCE_SYNC_DEBOUNCE_MS);
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        // Clear debounce timer
        if (this.sourceSyncDebounceTimer) {
            clearTimeout(this.sourceSyncDebounceTimer);
        }

        // Dispose all event listeners
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }

    /**
     * Find installed bundle by marketplace bundle ID using identity matching
     * 
     * @param bundleId - Marketplace bundle ID
     * @returns Bundle info including marketplace bundle, installed bundle, and source
     * @throws Error if marketplace bundle not found
     */
    private async findInstalledBundleByMarketplaceId(bundleId: string): Promise<{
        bundle: Bundle;
        installed: InstalledBundle | undefined;
        source: RegistrySource | undefined;
    }> {
        const [installedBundles, sources, bundles] = await Promise.all([
            this.registryManager.listInstalledBundles(),
            this.registryManager.listSources(),
            this.registryManager.searchBundles({ cacheOnly: true })
        ]);
        
        const bundle = bundles.find(b => b.id === bundleId);
        if (!bundle) {
            throw new Error('Bundle not found');
        }
        
        const source = sources.find(s => s.id === bundle.sourceId);
        const installed = installedBundles.find(ib => 
            this.matchesBundleIdentity(ib.bundleId, bundle.id, source?.type || 'local')
        );
        
        return { bundle, installed, source };
    }

    /**
     * Determine button state based on installation status and version comparison
     * 
     * @param bundle - The bundle to check
     * @param installed - The installed bundle info (if installed)
     * @returns Button state: 'install', 'update', or 'uninstall'
     */
    private determineButtonState(
        bundle: Bundle,
        installed: InstalledBundle | undefined
    ): 'install' | 'update' | 'uninstall' {
        if (!installed) {
            return 'install';
        }

        try {
            // Check if an update is available
            if (VersionManager.isUpdateAvailable(installed.version, bundle.version)) {
                return 'update';
            }
        } catch (error) {
            // If version comparison fails, fall back to string comparison
            this.logger.warn(`Version comparison failed for ${bundle.id}: ${(error as Error).message}`);
            if (installed.version !== bundle.version) {
                return 'update';
            }
        }

        return 'uninstall';
    }

    /**
     * Check if installed bundle matches the marketplace bundle identity
     * 
     * For GitHub bundles, compares without version suffix (owner-repo)
     * For other sources, requires exact match
     * 
     * @param installedId - Bundle ID from installed bundle
     * @param bundleId - Bundle ID from marketplace
     * @param sourceType - Source type of the bundle
     * @returns True if the bundles match
     */
    private matchesBundleIdentity(
        installedId: string,
        bundleId: string,
        sourceType: string
    ): boolean {
        return BundleIdentityMatcher.matches(installedId, bundleId, sourceType as any);
    }

    /**
     * Load bundles from registries and send to webview
     * Uses cacheOnly mode for fast initial load, then updates progressively via onSourceSynced events
     */
    private async loadBundles(): Promise<void> {
        // Prevent concurrent loads to avoid UI flicker
        if (this.isLoadingBundles) {
            this.logger.debug('Skipping loadBundles - already loading');
            return;
        }
        
        this.isLoadingBundles = true;
        try {
            // Search for all bundles using cache only (non-blocking)
            // This ensures fast initial load - network fetches happen via syncSource which fires onSourceSynced
            const bundles = await this.registryManager.searchBundles({ cacheOnly: true });
            const installedBundles = await this.registryManager.listInstalledBundles();
            const sources = await this.registryManager.listSources();
            const autoUpdateService = this.registryManager.autoUpdateService;

            // Preload auto-update preferences once per refresh
            const autoUpdatePreferences = autoUpdateService
                ? await autoUpdateService.getAllAutoUpdatePreferences()
                : {};

            const enhancedBundles = await Promise.all(bundles.map(async bundle => {
                // Find matching installed bundle using identity matching
                const source = sources.find(s => s.id === bundle.sourceId);
                const installed = installedBundles.find(ib => 
                    this.matchesBundleIdentity(ib.bundleId, bundle.id, source?.type || 'local')
                );
                
                // Use manifest from installed bundle if available
                const contentBreakdown = this.getContentBreakdown(bundle, installed?.manifest);

                // Check if bundle is from a curated hub
                const isCurated = source?.hubId !== undefined;
                const hubName = isCurated && source?.hubId ? source.metadata?.description || source.name : undefined;

                // Determine button state based on installation status and version
                const buttonState = this.determineButtonState(bundle, installed);

                // Get available versions if this is a consolidated bundle
                let availableVersions: Array<{version: string}> | undefined;
                if ((bundle as any).isConsolidated && (bundle as any).availableVersions) {
                    availableVersions = (bundle as any).availableVersions.map((v: any) => ({
                        version: v.version
                    }));
                }

                // Get auto-update status if bundle is installed (from preloaded preferences)
                const autoUpdateEnabled = installed
                    ? autoUpdatePreferences[installed.bundleId] ?? false
                    : false;

                // Get rating from cache if available
                const ratingCache = RatingCache.getInstance();
                const ratingDisplay = ratingCache.getRatingDisplay(bundle.sourceId, bundle.id);
                const cachedRating = ratingCache.getRating(bundle.sourceId, bundle.id);

                return {
                    ...bundle,
                    installed: !!installed,
                    installedVersion: installed?.version,
                    buttonState,
                    isCurated,
                    hubName,
                    contentBreakdown,
                    availableVersions,
                    autoUpdateEnabled,
                    rating: cachedRating ? {
                        starRating: cachedRating.starRating,
                        voteCount: cachedRating.voteCount,
                        confidence: cachedRating.confidence,
                        displayText: ratingDisplay?.text
                    } : undefined,
                };
            }));

            // Extract dynamic filter options
            const availableTags = extractAllTags(bundles);
            const availableSources = extractBundleSources(bundles, sources);

            // Send to webview (only if view is available)
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'bundlesLoaded',
                    bundles: enhancedBundles,
                    filterOptions: {
                        tags: availableTags,
                        sources: availableSources
                    }
                });
            }

            this.logger.debug(`Loaded ${enhancedBundles.length} bundles for marketplace`);

        } catch (error) {
            this.logger.error('Failed to load marketplace bundles', error as Error);
        } finally {
            this.isLoadingBundles = false;
        }
    }

    /**
     * Count prompts by type from an array of prompt objects
     */
    private countPromptsByType(prompts: any[], mcpServersCount: number = 0): ContentBreakdown {
        const breakdown: ContentBreakdown = {
            prompts: 0,
            instructions: 0,
            chatmodes: 0,
            agents: 0,
            skills: 0,
            mcpServers: mcpServersCount
        };

        for (const prompt of prompts) {
            const type = prompt.type || 'prompt';
            switch (type) {
                case 'prompt':
                    breakdown.prompts++;
                    break;
                case 'instructions':
                    breakdown.instructions++;
                    break;
                case 'chatmode':
                    breakdown.chatmodes++;
                    break;
                case 'agent':
                    breakdown.agents++;
                    break;
                case 'skill':
                    breakdown.skills++;
                    break;
            }
        }

        return breakdown;
    }

    /**
     * Calculate content breakdown from bundle metadata
     */
    private getContentBreakdown(bundle: Bundle, manifest?: any): ContentBreakdown {
        const bundleData = bundle as any;
        const mcpCount = manifest?.mcpServers ? Object.keys(manifest.mcpServers).length : this.countMcpServers(bundleData);

        // First: Use manifest if provided (from installed bundle)
        if (manifest?.prompts && Array.isArray(manifest.prompts)) {
            return this.countPromptsByType(manifest.prompts, mcpCount);
        }

        // Second: Try to parse from bundle data (some sources embed this)
        if (bundleData.prompts && Array.isArray(bundleData.prompts)) {
            return this.countPromptsByType(bundleData.prompts, mcpCount);
        }

        // Third: Use pre-calculated breakdown from adapters (AwesomeCopilot, LocalAwesomeCopilot)
        if (bundleData.breakdown) {
            return {
                prompts: bundleData.breakdown.prompts || 0,
                instructions: bundleData.breakdown.instructions || 0,
                chatmodes: bundleData.breakdown.chatmodes || 0,
                agents: bundleData.breakdown.agents || 0,
                skills: bundleData.breakdown.skills || 0,
                mcpServers: bundleData.breakdown.mcpServers || this.countMcpServers(bundleData)
            };
        }

        // Fourth: For local OLAF bundles, show skills separately
        if (bundleData.skills && Array.isArray(bundleData.skills)) {
            return {
                prompts: 0,
                instructions: 0,
                chatmodes: 0,
                agents: 0,
                skills: bundleData.skills.length,
                mcpServers: this.countMcpServers(bundleData)
            };
        }

        // Fallback: Don't show estimates for uninstalled bundles
        // If we don't have manifest data, return zeros instead of misleading estimates
        // Users can install the bundle to see accurate counts
        return {
            prompts: 0,
            instructions: 0,
            chatmodes: 0,
            agents: 0,
            skills: 0,
            mcpServers: this.countMcpServers(bundleData)
        };
    }

    /**
     * Count MCP servers from bundle data
     */
    private countMcpServers(bundleData: any): number {
        // Check manifest.mcpServers
        if (bundleData.mcpServers && typeof bundleData.mcpServers === 'object') {
            return Object.keys(bundleData.mcpServers).length;
        }
        // Check mcp.items (collection format)
        if (bundleData.mcp?.items && typeof bundleData.mcp.items === 'object') {
            return Object.keys(bundleData.mcp.items).length;
        }
        return 0;
    }

    /**
     * Handle messages from webview
     */
    private async handleMessage(message: WebviewMessage): Promise<void> {
        switch (message.type) {
            case 'refresh':
                await this.loadBundles();
                break;
            case 'install':
                if (message.bundleId) {
                    await this.handleInstall(message.bundleId);
                }
                break;
            case 'update':
                if (message.bundleId) {
                    await this.handleUpdate(message.bundleId);
                }
                break;
            case 'uninstall':
                if (message.bundleId) {
                    await this.handleUninstall(message.bundleId);
                }
                break;
            case 'openDetails':
                if (message.bundleId) {
                    await this.openBundleDetails(message.bundleId);
                }
                break;
            case 'openPromptFile':
                if (message.installPath && message.filePath) {
                    await this.openPromptFileInEditor(message.installPath, message.filePath);
                }
                break;
            case 'installVersion':
                if (message.bundleId && message.version) {
                    await this.handleInstallVersion(message.bundleId, message.version);
                }
                break;
            case 'getVersions':
                if (message.bundleId) {
                    await this.handleGetVersions(message.bundleId);
                }
                break;
            case 'toggleAutoUpdate':
                if (message.bundleId !== undefined && message.enabled !== undefined) {
                    await this.handleToggleAutoUpdate(message.bundleId, message.enabled);
                }
                break;
            case 'openSourceRepository':
                if (message.bundleId) {
                    await this.handleOpenSourceRepository(message.bundleId);
                }
                break;
            case 'getFeedbacks':
                if (message.bundleId) {
                    await this.handleGetFeedbacks(message.bundleId);
                }
                break;
            default:
                this.logger.warn(`Unknown message type: ${message.type}`);
        }
    }

    /**
     * Open the source repository for a bundle
     */
    private async handleOpenSourceRepository(bundleId: string): Promise<void> {
        try {
            const { bundle, source } = await this.findInstalledBundleByMarketplaceId(bundleId);
            
            // Create a fake tree item to pass to the command
            const item = {
                type: 'bundle',
                data: {
                    ...bundle,
                    sourceId: bundle.sourceId
                }
            };
            
            await vscode.commands.executeCommand('promptregistry.openItemRepository', item);
        } catch (error) {
            this.logger.error('Failed to open source repository', error as Error);
            vscode.window.showErrorMessage(`Failed to open repository: ${(error as Error).message}`);
        }
    }

    /**
     * Get feedbacks for a bundle and send to webview
     */
    private async handleGetFeedbacks(bundleId: string): Promise<void> {
        try {
            const feedbackCache = FeedbackCache.getInstance();
            const ratingCache = RatingCache.getInstance();
            
            // Get feedbacks from cache
            const feedbacks = feedbackCache.getFeedbacks(bundleId) || [];
            
            // Get rating data for the bundle
            // Note: We need sourceId to look up ratings, but bundleId alone is insufficient
            // For now, we'll need to find the bundle to get its sourceId
            const bundles = await this.registryManager.searchBundles({ text: bundleId });
            const bundle = bundles.find(b => b.id === bundleId);
            const rating = bundle ? ratingCache.getRating(bundle.sourceId, bundleId) : undefined;
            
            // Send data to webview
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'feedbacksLoaded',
                    bundleId: bundleId,
                    feedbacks: feedbacks,
                    rating: rating
                });
            }
        } catch (error) {
            this.logger.error('Failed to get feedbacks', error as Error);
            // Send empty feedbacks on error
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'feedbacksLoaded',
                    bundleId: bundleId,
                    feedbacks: [],
                    rating: null
                });
            }
        }
    }

    /**
     * Open a prompt file in the editor
     */
    private async openPromptFileInEditor(installPath: string, filePath: string): Promise<void> {
        try {
            const path = require('path');
            const fullPath = path.join(installPath, filePath);
            
            this.logger.debug(`Opening prompt file: ${fullPath}`);
            
            // Open the file in the editor using Uri for cross-platform compatibility
            const fileUri = vscode.Uri.file(fullPath);
            const document = await vscode.workspace.openTextDocument(fileUri);
            await vscode.window.showTextDocument(document, {
                preview: false,
                viewColumn: vscode.ViewColumn.One
            });
            
        } catch (error) {
            this.logger.error('Failed to open prompt file', error as Error);
            vscode.window.showErrorMessage(`Failed to open file: ${(error as Error).message}`);
        }
    }

    /**
     * Show scope selection dialog and return result
     * @returns Scope selection result or undefined if cancelled
     */
    private async promptForScope(): Promise<import('../utils/scopeSelectionUI').ScopeSelectionResult | undefined> {
        const { showScopeSelectionDialog } = await import('../utils/scopeSelectionUI');
        return showScopeSelectionDialog();
    }

    /**
     * Install a bundle
     */
    private async handleInstall(bundleId: string): Promise<void> {
        try {
            this.logger.info(`Installing bundle from marketplace: ${bundleId}`);

            // Show scope selection dialog
            const scopeResult = await this.promptForScope();
            
            if (!scopeResult) {
                // User cancelled the dialog
                this.logger.debug('Installation cancelled by user');
                return;
            }

            // Use RegistryManager to install with selected scope
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Installing bundle...`,
                cancellable: false
            }, async () => {
                await this.registryManager.installBundle(bundleId, {
                    scope: scopeResult.scope,
                    version: 'latest',
                    commitMode: scopeResult.commitMode
                });
            });

            vscode.window.showInformationMessage(`✅ Bundle installed successfully!`);

            // Refresh marketplace
            await this.loadBundles();

        } catch (error) {
            this.logger.error('Failed to install bundle from marketplace', error as Error);
            vscode.window.showErrorMessage(`Failed to install bundle: ${(error as Error).message}`);
        }
    }

    /**
     * Uninstall a bundle
     */
    private async handleUninstall(bundleId: string): Promise<void> {
        try {
            this.logger.info(`Uninstalling bundle from marketplace: ${bundleId}`);

            // Find the actual installed bundle using identity matching
            const { installed } = await this.findInstalledBundleByMarketplaceId(bundleId);

            if (!installed) {
                throw new Error(`Bundle '${bundleId}' is not installed`);
            }

            // Use the stored bundle ID from the installation record
            await this.registryManager.uninstallBundle(installed.bundleId, installed.scope || 'user');

            vscode.window.showInformationMessage(`✅ Bundle uninstalled successfully!`);

            // Refresh marketplace
            await this.loadBundles();

        } catch (error) {
            this.logger.error('Failed to uninstall bundle from marketplace', error as Error);
            vscode.window.showErrorMessage(`Failed to uninstall bundle: ${(error as Error).message}`);
        }
    }

    /**
     * Update a bundle to the latest version
     * 
     * This method performs a two-step process:
     * 1. Uninstall the current version
     * 2. Install the latest version
     * 
     * If uninstall fails, the update is aborted.
     * If install fails after successful uninstall, the bundle will be left uninstalled.
     */
    private async handleUpdate(bundleId: string): Promise<void> {
        try {
            this.logger.info(`Updating bundle from marketplace: ${bundleId}`);

            // Get current installation info to preserve scope
            const { installed } = await this.findInstalledBundleByMarketplaceId(bundleId);

            if (!installed) {
                // Bundle not installed, just install it
                this.logger.warn(`Bundle ${bundleId} not installed, performing fresh install`);
                await this.handleInstall(bundleId);
                return;
            }

            // Use the unified update flow from RegistryManager
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Updating bundle...`,
                cancellable: false
            }, async (progress) => {
                progress.report({ message: 'Updating bundle...' });
                await this.registryManager.updateBundle(installed.bundleId);
            });

            vscode.window.showInformationMessage(`✅ Bundle updated successfully!`);

            // Refresh marketplace to show updated state
            await this.loadBundles();

        } catch (error) {
            this.logger.error('Failed to update bundle from marketplace', error as Error);
            vscode.window.showErrorMessage(`Failed to update bundle: ${(error as Error).message}`);
        }
    }

    /**
     * Handle installation of a specific version
     * 
     * @param bundleId - The bundle to install
     * @param version - The specific version to install
     */
    private async handleInstallVersion(bundleId: string, version: string): Promise<void> {
        try {
            this.logger.info(`Installing specific version of bundle: ${bundleId} v${version}`);

            // Show scope selection dialog
            const scopeResult = await this.promptForScope();
            
            if (!scopeResult) {
                // User cancelled the dialog
                this.logger.debug('Installation cancelled by user');
                return;
            }

            // Use RegistryManager to install with specific version and selected scope
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Installing bundle v${version}...`,
                cancellable: false
            }, async () => {
                await this.registryManager.installBundle(bundleId, {
                    scope: scopeResult.scope,
                    version: version,
                    commitMode: scopeResult.commitMode
                });
            });

            vscode.window.showInformationMessage(`✅ Bundle v${version} installed successfully!`);

            // Refresh marketplace
            await this.loadBundles();

        } catch (error) {
            this.logger.error('Failed to install specific version from marketplace', error as Error);
            vscode.window.showErrorMessage(`Failed to install bundle v${version}: ${(error as Error).message}`);
        }
    }

    /**
     * Handle request to get available versions for a bundle
     * 
     * @param bundleId - The bundle to get versions for
     */
    private async handleGetVersions(bundleId: string): Promise<void> {
        try {
            this.logger.debug(`Getting available versions for bundle: ${bundleId}`);

            // Get the bundle to determine its identity
            const { bundle } = await this.findInstalledBundleByMarketplaceId(bundleId);

            // Get available versions
            const versions = await this.getAvailableVersions(bundle);

            // Send versions back to webview
            this._view?.webview.postMessage({
                type: 'versionsLoaded',
                bundleId: bundleId,
                versions: versions
            });

            this.logger.debug(`Sent ${versions.length} versions for bundle ${bundleId}`);

        } catch (error) {
            this.logger.error('Failed to get available versions', error as Error);
        }
    }

    /**
     * Get all available versions for a bundle
     * 
     * @param bundle - The bundle to get versions for
     * @returns Array of version strings in descending order
     */
    private async getAvailableVersions(bundle: Bundle): Promise<string[]> {
        try {
            // Use public API from RegistryManager
            return await this.registryManager.getAvailableVersions(bundle.id);
        } catch (error) {
            this.logger.error('Failed to get available versions', error as Error);
            return [bundle.version];
        }
    }

    /**
     * Handle toggle auto-update request from webview
     *
     * @param bundleId - The bundle to toggle auto-update for
     * @param enabled - Whether auto-update should be enabled
     */
    private async handleToggleAutoUpdate(bundleId: string, enabled: boolean): Promise<void> {
        try {
            this.logger.info(`Toggling auto-update for bundle '${bundleId}' to ${enabled}`);

            // Use RegistryManager facade methods to ensure event is emitted
            if (enabled) {
                await this.registryManager.enableAutoUpdate(bundleId);
            } else {
                await this.registryManager.disableAutoUpdate(bundleId);
            }

            // Show confirmation
            const status = enabled ? 'enabled' : 'disabled';
            vscode.window.showInformationMessage(`Auto-update ${status} for ${bundleId}`);

            // Note: UI refresh is handled automatically by event listener registered in activateBundleListeners()

        } catch (error) {
            this.logger.error('Failed to toggle auto-update', error as Error);
            vscode.window.showErrorMessage(`Failed to toggle auto-update: ${(error as Error).message}`);
        }
    }

    /**
     * Open bundle details in a new webview panel
     */
    async openBundleDetails(bundleId: string): Promise<void> {
        try {
            this.logger.debug(`Opening details for bundle: ${bundleId}`);

            // Use getBundleDetails which handles identity matching for versioned IDs
            // (e.g., "bundle-name-1.0.17" gets matched to consolidated "bundle-name")
            let bundle: Bundle;
            try {
                bundle = await this.registryManager.getBundleDetails(bundleId);
            } catch (error) {
                this.logger.error(`Failed to get bundle details for ${bundleId}`, error as Error);
                vscode.window.showErrorMessage('Bundle not found');
                return;
            }

            // Check if installed to get manifest - use identity matching for GitHub bundles
            const installedBundles = await this.registryManager.listInstalledBundles();
            const sources = await this.registryManager.listSources();
            const source = sources.find(s => s.id === bundle.sourceId);
            const installed = installedBundles.find(ib => 
                this.matchesBundleIdentity(ib.bundleId, bundle.id, source?.type || 'local')
            );
            const breakdown = this.getContentBreakdown(bundle, installed?.manifest);

            // Get auto-update status if bundle is installed (using preloaded preferences API)
            let autoUpdateEnabled = false;
            if (installed) {
                const autoUpdateService = this.registryManager.autoUpdateService;
                if (autoUpdateService) {
                    const autoUpdatePreferences = await autoUpdateService.getAllAutoUpdatePreferences();
                    autoUpdateEnabled = autoUpdatePreferences[installed.bundleId] ?? false;
                }
            }

            // Get rating from cache
            const ratingCache = RatingCache.getInstance();
            const ratingDisplay = ratingCache.getRatingDisplay(bundle.sourceId, bundle.id);
            const cachedRating = ratingCache.getRating(bundle.sourceId, bundle.id);

            // Create webview panel
            const panel = vscode.window.createWebviewPanel(
                'bundleDetails',
                `📦 ${bundle.name}`,
                vscode.ViewColumn.One,
                {
                    enableScripts: true
                }
            );

            // Set HTML content
            panel.webview.html = this.getBundleDetailsHtml(bundle, installed, breakdown, autoUpdateEnabled, cachedRating, ratingDisplay);

            // Handle messages from the details panel
            panel.webview.onDidReceiveMessage(
                async (message) => {
                    if (message.type === 'openPromptFile') {
                        await this.openPromptFileInEditor(message.installPath, message.filePath);
                    } else if (message.type === 'toggleAutoUpdate') {
                        await this.handleToggleAutoUpdate(message.bundleId, message.enabled);
                        // Update the panel with new status
                        if (installed) {
                            const newStatus = await this.registryManager.autoUpdateService?.isAutoUpdateEnabled(installed.bundleId) || false;
                            panel.webview.postMessage({ type: 'autoUpdateStatusChanged', enabled: newStatus });
                        }
                    } else if (message.type === 'submitFeedback') {
                        // Execute the feedback command with bundle info
                        await vscode.commands.executeCommand('promptRegistry.submitFeedback', {
                            resourceId: message.bundleId,
                            resourceType: 'bundle',
                            name: bundle.name,
                            version: bundle.version
                        });
                    } else if (message.type === 'quickFeedback') {
                        // Execute the quick feedback command with bundle info
                        await vscode.commands.executeCommand('promptRegistry.quickFeedback', {
                            resourceId: message.bundleId,
                            resourceType: 'bundle',
                            name: bundle.name,
                            version: bundle.version
                        });
                    }
                },
                undefined,
                this.context.subscriptions
            );

            // Listen to auto-update preference changes from other UI components (e.g., tree view context menu)
            this.disposables.push(
                this.registryManager.onAutoUpdatePreferenceChanged((event) => {
                    // Update the webview if this event is for the bundle being displayed
                    if (event.bundleId === bundleId || (installed && event.bundleId === installed.bundleId)) {
                        panel.webview.postMessage({ type: 'autoUpdateStatusChanged', enabled: event.enabled });
                    }
                })
            );

        } catch (error) {
            this.logger.error('Failed to open bundle details', error as Error);
            vscode.window.showErrorMessage('Failed to open bundle details');
        }
    }

    /**
     * Get HTML for bundle details panel
     */
    private getBundleDetailsHtml(
        bundle: Bundle, 
        installed: InstalledBundle | undefined, 
        breakdown: ContentBreakdown, 
        autoUpdateEnabled: boolean = false,
        rating?: { starRating: number; voteCount: number; confidence: string } | null,
        ratingDisplay?: { text: string; tooltip: string } | null
    ): string {
        const isInstalled = !!installed;
        const installPath = installed?.installPath || 'Not installed';
        // Escape backslashes and quotes for safe embedding in HTML onclick attributes
        const escapedInstallPath = installPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${bundle.name}</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            line-height: 1.6;
        }
        .header {
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 20px;
            margin-bottom: 24px;
        }
        h1 {
            font-size: 28px;
            margin: 0 0 8px 0;
        }
        .meta {
            color: var(--vscode-descriptionForeground);
            font-size: 14px;
        }
        .badge {
            display: inline-block;
            background: var(--vscode-gitDecoration-addedResourceForeground);
            color: white;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
            margin-left: 12px;
        }
        .auto-update-toggle {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 16px;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 6px;
            margin-bottom: 16px;
        }
        .auto-update-label {
            flex: 1;
            font-size: 14px;
            font-weight: 500;
        }
        .auto-update-description {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-top: 4px;
        }
        .toggle-switch {
            position: relative;
            width: 44px;
            height: 24px;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 12px;
            cursor: pointer;
            transition: background 0.2s;
        }
        .toggle-switch.enabled {
            background: var(--vscode-button-background);
            border-color: var(--vscode-button-background);
        }
        .toggle-slider {
            position: absolute;
            top: 2px;
            left: 2px;
            width: 18px;
            height: 18px;
            background: white;
            border-radius: 50%;
            transition: transform 0.2s;
        }
        .toggle-switch.enabled .toggle-slider {
            transform: translateX(20px);
        }
        .section {
            margin-bottom: 32px;
        }
        .section h2 {
            font-size: 20px;
            margin-bottom: 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 8px;
        }
        .breakdown {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-top: 16px;
        }
        .breakdown-item {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 8px;
            padding: 16px;
            text-align: center;
        }
        .breakdown-icon {
            font-size: 32px;
            margin-bottom: 8px;
        }
        .breakdown-count {
            font-size: 24px;
            font-weight: 600;
            margin-bottom: 4px;
        }
        .breakdown-label {
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
        }
        .tags {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 12px;
        }
        .tag {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 12px;
        }
        .info-grid {
            display: grid;
            gap: 12px;
            margin-top: 12px;
        }
        .info-row {
            display: grid;
            grid-template-columns: 140px 1fr;
            gap: 16px;
        }
        .info-label {
            font-weight: 600;
            color: var(--vscode-descriptionForeground);
        }
        .info-value {
            color: var(--vscode-foreground);
        }
        code {
            background: var(--vscode-textCodeBlock-background);
            padding: 2px 6px;
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
        }
        .prompt-item:hover {
            background: var(--vscode-list-hoverBackground);
            border-radius: 4px;
        }
        .mcp-server-card {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 12px;
            margin-bottom: 12px;
        }
        .mcp-server-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
            font-weight: 600;
            font-size: 14px;
        }
        .mcp-server-command {
            background: var(--vscode-textCodeBlock-background);
            padding: 8px 12px;
            border-radius: 4px;
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
            margin-bottom: 8px;
            word-break: break-all;
        }
        .mcp-env-vars {
            margin-top: 8px;
            padding-left: 12px;
        }
        .mcp-env-var {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin: 4px 0;
        }
        .mcp-status-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 500;
        }
        .mcp-status-enabled {
            background: var(--vscode-testing-iconPassed);
            color: var(--vscode-editor-background);
        }
        .mcp-status-disabled {
            background: var(--vscode-descriptionForeground);
            color: var(--vscode-editor-background);
        }
        .rating-section {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 24px;
        }
        .rating-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 12px;
        }
        .rating-display {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .rating-stars {
            font-size: 24px;
            color: var(--vscode-charts-yellow);
        }
        .rating-score {
            font-size: 28px;
            font-weight: 600;
        }
        .rating-meta {
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
        }
        .feedback-actions {
            display: flex;
            gap: 8px;
        }
        .btn-feedback {
            padding: 8px 16px;
            border: 1px solid var(--vscode-button-border, var(--vscode-input-border));
            border-radius: 4px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            cursor: pointer;
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .btn-feedback:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .no-rating {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
    </style>
    <script>
        const vscode = acquireVsCodeApi();
        let autoUpdateEnabled = ${autoUpdateEnabled};
        
        function openPromptFile(installPath, filePath) {
            vscode.postMessage({
                type: 'openPromptFile',
                installPath: installPath,
                filePath: filePath
            });
        }
        
        function toggleAutoUpdate() {
            autoUpdateEnabled = !autoUpdateEnabled;
            updateToggleUI();
            vscode.postMessage({
                type: 'toggleAutoUpdate',
                bundleId: '${installed?.bundleId || bundle.id}',
                enabled: autoUpdateEnabled
            });
        }
        
        function updateToggleUI() {
            const toggle = document.getElementById('autoUpdateToggle');
            if (toggle) {
                if (autoUpdateEnabled) {
                    toggle.classList.add('enabled');
                } else {
                    toggle.classList.remove('enabled');
                }
            }
        }
        
        function submitFeedback() {
            vscode.postMessage({
                type: 'submitFeedback',
                bundleId: '${installed?.bundleId || bundle.id}'
            });
        }
        
        function quickFeedback() {
            vscode.postMessage({
                type: 'quickFeedback',
                bundleId: '${installed?.bundleId || bundle.id}'
            });
        }
        
        // Listen for status updates from extension
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'autoUpdateStatusChanged') {
                autoUpdateEnabled = message.enabled;
                updateToggleUI();
            }
        });
    </script>
</head>
<body>
    <div class="header">
        <h1>
            📦 ${bundle.name}
            ${isInstalled ? '<span class="badge">✓ Installed</span>' : ''}
        </h1>
        <div class="meta">
            by ${bundle.author || 'Unknown'} • Version ${bundle.version}
        </div>
    </div>

    ${isInstalled ? `
    <div class="auto-update-toggle">
        <div style="flex: 1;">
            <div class="auto-update-label">🔄 Auto-Update</div>
            <div class="auto-update-description">Automatically install updates when available</div>
        </div>
        <div class="toggle-switch ${autoUpdateEnabled ? 'enabled' : ''}" id="autoUpdateToggle" onclick="toggleAutoUpdate()">
            <div class="toggle-slider"></div>
        </div>
    </div>
    ` : ''}

    <div class="rating-section">
        <div class="rating-header">
            <div class="rating-display">
                ${rating ? `
                    <span class="rating-stars">${'★'.repeat(Math.round(rating.starRating))}${'☆'.repeat(5 - Math.round(rating.starRating))}</span>
                    <span class="rating-score">${rating.starRating.toFixed(1)}</span>
                    <span class="rating-meta">${rating.voteCount} votes (${rating.confidence} confidence)</span>
                ` : `
                    <span class="no-rating">No ratings yet</span>
                `}
            </div>
            <div class="feedback-actions">
                <button class="btn-feedback" onclick="quickFeedback()">👍 Quick Feedback</button>
                <button class="btn-feedback" onclick="submitFeedback()">✏️ Write Feedback</button>
            </div>
        </div>
    </div>

    <div class="section">
        <h2>Description</h2>
        <p>${bundle.description || 'No description available'}</p>
    </div>

    <div class="section">
        <h2>📊 Content Breakdown</h2>
        ${isInstalled ? `
        <div class="breakdown">
            <div class="breakdown-item">
                <div class="breakdown-icon">💬</div>
                <div class="breakdown-count">${breakdown.prompts}</div>
                <div class="breakdown-label">Prompts</div>
            </div>
            <div class="breakdown-item">
                <div class="breakdown-icon">📋</div>
                <div class="breakdown-count">${breakdown.instructions}</div>
                <div class="breakdown-label">Instructions</div>
            </div>
            <div class="breakdown-item">
                <div class="breakdown-icon">🤖</div>
                <div class="breakdown-count">${breakdown.agents}</div>
                <div class="breakdown-label">Agents</div>
            </div>
            <div class="breakdown-item">
                <div class="breakdown-icon">🛠️</div>
                <div class="breakdown-count">${breakdown.skills}</div>
                <div class="breakdown-label">Skills</div>
            </div>
            <div class="breakdown-item">
                <div class="breakdown-icon">🔌</div>
                <div class="breakdown-count">${breakdown.mcpServers}</div>
                <div class="breakdown-label">MCP Servers</div>
            </div>
        </div>
        ` : `
        <div class="info-message">
            <p style="text-align: center; padding: 20px; color: var(--vscode-descriptionForeground);">
                📦 Install this bundle to see the detailed content breakdown.
            </p>
        </div>
        `}
    </div>
    <div class="section">
        <h2>ℹ️ Information</h2>
        <div class="info-grid">
            <div class="info-row">
                <div class="info-label">Bundle ID:</div>
                <div class="info-value"><code>${isInstalled ? installed!.bundleId : bundle.id}</code></div>
            </div>
            <div class="info-row">
                <div class="info-label">Version:</div>
                <div class="info-value">${isInstalled ? installed!.version : bundle.version}</div>
            </div>
            <div class="info-row">
                <div class="info-label">Author:</div>
                <div class="info-value">${bundle.author || 'Unknown'}</div>
            </div>
            ${isInstalled ? `
            <div class="info-row">
                <div class="info-label">Installed At:</div>
                <div class="info-value">${new Date(installed!.installedAt).toLocaleString()}</div>
            </div>
            <div class="info-row">
                <div class="info-label">Install Path:</div>
                <div class="info-value"><code>${installPath}</code></div>
            </div>
            ` : ''}
            <div class="info-row">
                <div class="info-label">Environments:</div>
                <div class="info-value">${(bundle.environments || ['any']).join(', ')}</div>
            </div>
        </div>
    </div>

    ${bundle.tags && bundle.tags.length > 0 ? `
    <div class="section">
        <h2>🏷️ Tags</h2>
        <div class="tags">
            ${bundle.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
        </div>
    </div>
    ` : ''}

    ${installed?.manifest?.mcpServers && Object.keys(installed.manifest.mcpServers).length > 0 ? `
    <div class="section">
        <h2>🔌 MCP Servers</h2>
        <p style="color: var(--vscode-descriptionForeground); margin-bottom: 16px; font-size: 13px;">
            This bundle includes ${Object.keys(installed.manifest.mcpServers).length} Model Context Protocol server${Object.keys(installed.manifest.mcpServers).length > 1 ? 's' : ''} that will be automatically integrated with VS Code.
        </p>
        ${Object.entries(installed.manifest.mcpServers).map(([serverName, config]) => {
            const isRemote = isRemoteServerConfig(config);
            const isStdio = isStdioServerConfig(config);
            return `
            <div class="mcp-server-card">
                <div class="mcp-server-header">
                    <span>${isRemote ? '🌐' : '⚡'} ${this.escapeHtml(serverName)}</span>
                    ${config.disabled ? '<span class="mcp-status-badge mcp-status-disabled">Disabled</span>' : '<span class="mcp-status-badge mcp-status-enabled">Enabled</span>'}
                </div>
                ${config.description ? `<div style="color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 8px;">${this.escapeHtml(config.description)}</div>` : ''}
                ${isStdio ? (() => {
                    const stdioConfig = config as McpStdioServerConfig;
                    return `
                    <div class="mcp-server-command">
                        <strong>Command:</strong> ${this.escapeHtml(stdioConfig.command)}
                        ${stdioConfig.args && stdioConfig.args.length > 0 ? ` ${stdioConfig.args.map(a => this.escapeHtml(a)).join(' ')}` : ''}
                    </div>
                    ${stdioConfig.env && Object.keys(stdioConfig.env).length > 0 ? `
                    <div class="mcp-env-vars">
                        <strong style="font-size: 12px;">Environment Variables:</strong>
                        ${Object.entries(stdioConfig.env).map(([key, value]) => `
                            <div class="mcp-env-var">• <code>${this.escapeHtml(key)}</code> = <code>${this.escapeHtml(String(value))}</code></div>
                        `).join('')}
                    </div>
                    ` : ''}
                    `;
                })() : ''}
                ${isRemote ? (() => {
                    const remoteConfig = config as McpRemoteServerConfig;
                    return `
                    <div class="mcp-server-command">
                        <strong>Type:</strong> ${this.escapeHtml((remoteConfig.type || 'http').toUpperCase())}
                    </div>
                    <div class="mcp-server-command">
                        <strong>URL:</strong> <code>${this.escapeHtml(remoteConfig.url)}</code>
                    </div>
                    ${remoteConfig.headers && Object.keys(remoteConfig.headers).length > 0 ? `
                    <div class="mcp-env-vars">
                        <strong style="font-size: 12px;">Headers:</strong>
                        ${Object.entries(remoteConfig.headers).map(([key, value]) => `
                            <div class="mcp-env-var">• <code>${this.escapeHtml(key)}</code>: <code>${this.escapeHtml(String(value).substring(0, 20))}${String(value).length > 20 ? '...' : ''}</code></div>
                        `).join('')}
                    </div>
                    ` : ''}
                    `;
                })() : ''}
            </div>
        `;}).join('')}
    </div>
    ` : ''}

    ${installed?.manifest?.prompts ? `
    <div class="section">
        <h2>📝 Included Prompts</h2>
        <div class="info-grid">
            ${installed.manifest.prompts.map(p => `
                <div class="info-row prompt-item" onclick="openPromptFile('${escapedInstallPath}', '${p.file}')" style="cursor: pointer;">
                    <div class="info-label">${p.id}:</div>
                    <div class="info-value">
                        ${p.name} 
                        <em style="color: var(--vscode-descriptionForeground);">(${p.type || 'prompt'})</em>
                        <span style="color: var(--vscode-textLink-foreground); margin-left: 8px;">📄 Open</span>
                    </div>
                </div>
            `).join('')}
        </div>
    </div>
    ` : ''}
</body>
</html>`;
    }

    /**
     * Get HTML content for marketplace webview
     */
    private getHtmlContent(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Prompt Marketplace</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
        }

        .header {
            margin-bottom: 24px;
        }

        .header h1 {
            font-size: 24px;
            font-weight: 600;
            margin-bottom: 8px;
        }

        .header p {
            color: var(--vscode-descriptionForeground);
            font-size: 14px;
        }

        .controls {
            display: flex;
            gap: 8px;
            margin-bottom: 20px;
            flex-wrap: wrap;
            align-items: center;
        }

        .search-box {
            flex: 1;
            min-width: 180px;
            max-width: 300px;
            padding: 6px 10px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            font-size: 13px;
            height: 28px;
        }

        .search-box:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
        }

        .filter-group {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .filter-label {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            white-space: nowrap;
            font-weight: 500;
        }

        .filter-select {
            padding: 4px 8px;
            background: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 3px;
            font-size: 12px;
            cursor: pointer;
            min-width: 120px;
            max-width: 160px;
            height: 28px;
        }

        .filter-select:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
        }

        /* Custom Tag Selector */
        .tag-selector {
            position: relative;
            display: inline-block;
        }

        .tag-selector-btn {
            padding: 4px 8px;
            background: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 3px;
            font-size: 12px;
            cursor: pointer;
            min-width: 120px;
            max-width: 200px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .tag-selector-btn:hover {
            background: var(--vscode-dropdown-listBackground);
        }

        .tag-selector-btn:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
        }

        .dropdown-arrow {
            margin-left: 8px;
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
        }

        .tag-dropdown {
            position: absolute;
            top: 100%;
            left: 0;
            margin-top: 4px;
            background: var(--vscode-dropdown-background);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 3px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            z-index: 1000;
            min-width: 220px;
            max-width: 300px;
        }

        .tag-search-container {
            padding: 8px;
            border-bottom: 1px solid var(--vscode-dropdown-border);
        }

        .tag-search {
            width: 100%;
            padding: 4px 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            font-size: 12px;
            box-sizing: border-box;
        }

        .tag-search:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
        }

        .tag-list {
            max-height: 240px;
            overflow-y: auto;
            padding: 4px 0;
        }

        .tag-item {
            display: flex;
            align-items: center;
            padding: 6px 12px;
            cursor: pointer;
            font-size: 12px;
            user-select: none;
        }

        .tag-item:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .tag-item input[type="checkbox"] {
            margin-right: 8px;
            cursor: pointer;
        }

        .tag-item.hidden {
            display: none;
        }

        /* Source selector styles (mirror of tag selector) */
        .source-selector {
            position: relative;
            display: inline-block;
        }

        .source-selector-btn {
            padding: 4px 8px;
            background: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 3px;
            font-size: 12px;
            cursor: pointer;
            min-width: 140px;
            max-width: 240px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .source-selector-btn:hover {
            background: var(--vscode-dropdown-listBackground);
        }

        .source-selector-btn:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
        }

        .source-dropdown {
            position: absolute;
            top: 100%;
            left: 0;
            margin-top: 4px;
            background: var(--vscode-dropdown-background);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 3px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            z-index: 1000;
            min-width: 240px;
            max-width: 320px;
        }

        .source-search-container {
            padding: 8px;
            border-bottom: 1px solid var(--vscode-dropdown-border);
        }

        .source-search {
            width: 100%;
            padding: 4px 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            font-size: 12px;
            box-sizing: border-box;
        }

        .source-search:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
        }

        .source-list {
            max-height: 240px;
            overflow-y: auto;
            padding: 4px 0;
        }

        .source-item {
            display: flex;
            align-items: center;
            padding: 6px 12px;
            cursor: pointer;
            font-size: 12px;
            user-select: none;
        }

        .source-item:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .source-item input[type="radio"] {
            margin-right: 8px;
            cursor: pointer;
        }

        .source-item.hidden {
            display: none;
        }

        .source-item.active {
            background: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }

        /* Installed checkbox filter */
        .installed-filter {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 8px;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            cursor: pointer;
            user-select: none;
            height: 28px;
            white-space: nowrap;
        }

        .installed-filter:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .installed-filter input[type="checkbox"] {
            cursor: pointer;
            width: 14px;
            height: 14px;
        }

        .installed-filter label {
            cursor: pointer;
            font-size: 12px;
            color: var(--vscode-foreground);
            font-weight: 500;
        }

        .filter-btn {
            padding: 5px 12px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
            transition: background 0.15s;
            height: 28px;
            white-space: nowrap;
        }

        .filter-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .filter-btn:active {
            transform: translateY(1px);
        }

        .refresh-btn {
            padding: 5px 12px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
            height: 28px;
            white-space: nowrap;
        }

        .refresh-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .marketplace-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 24px;
        }

        .bundle-card {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 20px;
            cursor: pointer;
            transition: all 0.2s;
            position: relative;
        }

        .bundle-card:hover {
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            transform: translateY(-2px);
        }

        .bundle-card.installed {
            border-color: var(--vscode-gitDecoration-addedResourceForeground);
        }

        .curated-badge {
            position: absolute;
            top: 12px;
            right: 12px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 4px;
            box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
            z-index: 2;
        }

        .curated-badge::before {
            content: "✨";
            font-size: 12px;
        }

        .installed-badge {
            position: absolute;
            top: 12px;
            right: 12px;
            background: var(--vscode-gitDecoration-addedResourceForeground);
            color: white;
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
        }

        .bundle-header {
            margin-bottom: 12px;
        }

        .bundle-title-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            margin-bottom: 4px;
        }

        .bundle-title {
            font-size: 18px;
            font-weight: 600;
            flex: 1;
            min-width: 0;
        }

        .bundle-author {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }

        .rating-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 4px 8px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-radius: 12px;
            font-size: 12px;
            font-weight: 500;
            border: none;
            white-space: nowrap;
            flex-shrink: 0;
        }

        .rating-badge.clickable {
            cursor: pointer;
            border: 1px solid transparent;
            transition: all 0.2s ease;
        }

        .rating-badge.clickable:hover {
            background: var(--vscode-list-hoverBackground);
            border-color: var(--vscode-focusBorder);
            transform: translateY(-1px);
        }

        .rating-stars {
            color: #ffa500;
            font-size: 14px;
            line-height: 1;
        }

        .rating-score {
            font-weight: 600;
            color: var(--vscode-badge-foreground);
        }

        .rating-votes {
            opacity: 0.8;
            font-size: 11px;
        }

        .bundle-description {
            font-size: 14px;
            color: var(--vscode-foreground);
            margin-bottom: 16px;
            line-height: 1.5;
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }

        .content-breakdown {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
            margin-bottom: 16px;
        }

        .content-item {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
        }

        .content-icon {
            font-size: 16px;
        }

        .content-count {
            font-weight: 600;
            color: var(--vscode-foreground);
        }

        .bundle-tags {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-bottom: 16px;
        }

        .tag {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 500;
        }

        .bundle-actions {
            display: flex;
            gap: 8px;
        }

        .btn {
            flex: 1;
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: background 0.2s;
        }

        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .btn-danger {
            background: var(--vscode-errorForeground);
            color: white;
        }

        .btn-danger:hover {
            opacity: 0.9;
        }

        .btn-link {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            padding: 8px 10px;
            min-width: auto;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .btn-link:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .btn-link svg {
            display: block;
        }

        /* Version selector styles */
        .version-selector-group {
            display: flex;
            gap: 0;
            position: relative;
        }

        .version-selector-group .btn {
            border-radius: 4px 0 0 4px;
        }

        .version-selector-arrow {
            padding: 8px 10px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-left: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 0 4px 4px 0;
            cursor: pointer;
            font-size: 11px;
            transition: background 0.2s;
            display: flex;
            align-items: center;
        }

        .version-selector-arrow:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .version-selector-arrow.danger {
            background: var(--vscode-errorForeground);
            border-left: 1px solid rgba(255, 255, 255, 0.2);
        }

        .version-selector-arrow.danger:hover {
            opacity: 0.9;
        }

        .version-dropdown {
            position: absolute;
            bottom: 100%;
            left: 0;
            margin-bottom: 4px;
            background: var(--vscode-dropdown-background);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 4px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            z-index: 1000;
            min-width: 220px;
            max-width: 300px;
            max-height: 300px;
            overflow-y: auto;
            display: none;
        }

        .version-dropdown.show {
            display: block;
        }

        .version-dropdown-header {
            padding: 8px 12px;
            border-bottom: 1px solid var(--vscode-dropdown-border);
            font-size: 12px;
            font-weight: 600;
            color: var(--vscode-descriptionForeground);
        }

        .version-item {
            padding: 8px 12px;
            cursor: pointer;
            font-size: 13px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            transition: background 0.15s;
        }

        .version-item:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .version-item.current {
            background: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }

        .version-item.uninstall {
            color: var(--vscode-errorForeground);
            font-weight: 600;
            border-bottom: 1px solid var(--vscode-dropdown-border);
        }

        .version-item.uninstall:hover {
            background: var(--vscode-inputValidation-errorBackground);
        }

        .version-badge {
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 8px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
        }

        .version-badge.latest {
            background: var(--vscode-gitDecoration-addedResourceForeground);
            color: white;
        }

        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: var(--vscode-descriptionForeground);
        }

        .empty-state-icon {
            font-size: 48px;
            margin-bottom: 16px;
        }

        .empty-state-title {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 8px;
        }

        .loading {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }

        .spinner {
            display: inline-block;
            width: 24px;
            height: 24px;
            border: 3px solid var(--vscode-descriptionForeground);
            border-top-color: transparent;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        /* Feedback Modal */
        .modal {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .modal-overlay {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.6);
        }

        .modal-content {
            position: relative;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            width: 90%;
            max-width: 700px;
            max-height: 80vh;
            display: flex;
            flex-direction: column;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        }

        .modal-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .modal-header h2 {
            margin: 0;
            font-size: 18px;
            font-weight: 600;
        }

        .modal-close {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            font-size: 28px;
            line-height: 1;
            cursor: pointer;
            padding: 0;
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
            transition: background 0.2s;
        }

        .modal-close:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .modal-body {
            padding: 20px;
            overflow-y: auto;
            flex: 1;
        }

        .feedback-summary {
            margin-bottom: 24px;
            padding: 16px;
            background: var(--vscode-textBlockQuote-background);
            border-left: 4px solid var(--vscode-focusBorder);
            border-radius: 4px;
        }

        .rating-overview {
            display: flex;
            align-items: center;
            gap: 24px;
            margin-bottom: 16px;
        }

        .rating-large {
            font-size: 48px;
            font-weight: 700;
            line-height: 1;
        }

        .rating-stars-large {
            font-size: 24px;
            color: #ffa500;
            line-height: 1;
        }

        .rating-count {
            font-size: 14px;
            color: var(--vscode-descriptionForeground);
            margin-top: 4px;
        }

        .rating-bars {
            flex: 1;
        }

        .rating-bar-row {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 6px;
        }

        .rating-bar-label {
            font-size: 12px;
            width: 60px;
            color: var(--vscode-descriptionForeground);
        }

        .rating-bar-track {
            flex: 1;
            height: 8px;
            background: var(--vscode-input-background);
            border-radius: 4px;
            overflow: hidden;
        }

        .rating-bar-fill {
            height: 100%;
            background: #ffa500;
            transition: width 0.3s ease;
        }

        .rating-bar-count {
            font-size: 12px;
            width: 40px;
            text-align: right;
            color: var(--vscode-descriptionForeground);
        }

        .feedback-list {
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        .feedback-item {
            padding: 16px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
        }

        .feedback-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 12px;
        }

        .feedback-rating {
            color: #ffa500;
            font-size: 16px;
        }

        .feedback-meta {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }

        .feedback-version {
            padding: 2px 6px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-radius: 3px;
            font-size: 11px;
        }

        .feedback-comment {
            font-size: 14px;
            line-height: 1.6;
            color: var(--vscode-foreground);
        }

        .feedback-empty {
            text-align: center;
            padding: 40px 20px;
            color: var(--vscode-descriptionForeground);
        }

        .feedback-empty-icon {
            font-size: 48px;
            margin-bottom: 12px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🎨 Prompt Marketplace</h1>
        <p>Discover and install curated prompt bundles for GitHub Copilot</p>
    </div>

    <div class="controls">
        <input type="text" class="search-box" id="searchBox" placeholder="Search bundles...">
        
        <div class="filter-group">
            <label class="filter-label">Source:</label>
            <div class="source-selector">
                <button class="source-selector-btn" id="sourceSelectorBtn">
                    <span id="sourceSelectorText">All Sources</span>
                    <span class="dropdown-arrow">▾</span>
                </button>
                <div class="source-dropdown" id="sourceDropdown" style="display: none;">
                    <div class="source-search-container">
                        <input type="text" class="source-search" id="sourceSearch" placeholder="Search sources...">
                    </div>
                    <div class="source-list" id="sourceList">
                        <div class="source-item active" data-source="all">
                            <input type="radio" name="source" id="source-all" value="all" checked>
                            <label for="source-all">All Sources</label>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="filter-group">
            <label class="filter-label">Tags:</label>
            <div class="tag-selector">
                <button class="tag-selector-btn" id="tagSelectorBtn">
                    <span id="tagSelectorText">All Tags</span>
                    <span class="dropdown-arrow">▾</span>
                </button>
                <div class="tag-dropdown" id="tagDropdown" style="display: none;">
                    <div class="tag-search-container">
                        <input type="text" class="tag-search" id="tagSearch" placeholder="Search tags...">
                    </div>
                    <div class="tag-list" id="tagList">
                        <!-- Tags will be populated here -->
                    </div>
                </div>
            </div>
        </div>
        
        <div class="filter-group">
            <label class="filter-label">Sort:</label>
            <select class="filter-select" id="sortSelect">
                <option value="name-asc">Name (A-Z)</option>
                <option value="name-desc">Name (Z-A)</option>
                <option value="rating-desc">Rating (High to Low)</option>
                <option value="rating-asc">Rating (Low to High)</option>
            </select>
        </div>
        
        <div class="installed-filter" id="installedFilter">
            <input type="checkbox" id="installedCheckbox">
            <label for="installedCheckbox">Installed</label>
        </div>
        
        <button class="filter-btn" id="clearFiltersBtn">Clear</button>
        <button class="refresh-btn" id="refreshBtn">Refresh</button>
    </div>

    <div id="marketplace" class="marketplace-grid">
        <div class="loading">
            <div class="spinner"></div>
            <p>Loading bundles...</p>
        </div>
    </div>

    <!-- Feedback Modal -->
    <div id="feedbackModal" class="modal" style="display: none;">
        <div class="modal-overlay" onclick="closeFeedbackModal()"></div>
        <div class="modal-content">
            <div class="modal-header">
                <h2 id="feedbackModalTitle">User Feedbacks</h2>
                <button class="modal-close" onclick="closeFeedbackModal()">×</button>
            </div>
            <div class="modal-body">
                <div class="feedback-summary" id="feedbackSummary">
                    <!-- Rating overview will be populated here -->
                </div>
                <div class="feedback-list" id="feedbackList">
                    <!-- Feedback items will be populated here -->
                </div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let allBundles = [];
        let filterOptions = { tags: [], sources: [] };
        let selectedSource = 'all';
        let selectedTags = [];
        let showInstalledOnly = false;
        let selectedSort = 'name-asc';

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            if (message.type === 'bundlesLoaded') {
                allBundles = message.bundles;
                filterOptions = message.filterOptions || { tags: [], sources: [] };
                updateFilterUI();
                renderBundles();
            } else if (message.type === 'feedbacksLoaded') {
                renderFeedbackModal(message.bundleId, message.feedbacks, message.rating);
            }
        });

        // Request initial data when webview is ready
        // This ensures we get data even if the extension sent it before we were listening
        vscode.postMessage({ type: 'refresh' });

        // Update filter dropdowns with dynamic data
        function updateFilterUI() {
            const sourceList = document.getElementById('sourceList');
            const tagList = document.getElementById('tagList');

            // Populate source dropdown with radio buttons
            sourceList.innerHTML = '';
            
            // Add "All Sources" option
            const allItem = document.createElement('div');
            allItem.className = 'source-item' + (selectedSource === 'all' ? ' active' : '');
            allItem.dataset.source = 'all';
            allItem.innerHTML = \`
                <input type="radio" name="source" id="source-all" value="all" \${selectedSource === 'all' ? 'checked' : ''}>
                <label for="source-all">All Sources</label>
            \`;
            sourceList.appendChild(allItem);
            
            // Add source options
            filterOptions.sources.forEach(source => {
                const sourceItem = document.createElement('div');
                sourceItem.className = 'source-item' + (selectedSource === source.id ? ' active' : '');
                sourceItem.dataset.source = source.id;
                sourceItem.innerHTML = \`
                    <input type="radio" name="source" id="source-\${source.id}" value="\${source.id}" \${selectedSource === source.id ? 'checked' : ''}>
                    <label for="source-\${source.id}">\${source.name} (\${source.bundleCount})</label>
                \`;
                sourceList.appendChild(sourceItem);
                
                // Add click handler
                sourceItem.addEventListener('click', () => {
                    document.querySelectorAll('.source-item').forEach(i => i.classList.remove('active'));
                    sourceItem.classList.add('active');
                    selectedSource = source.id;
                    document.getElementById('sourceSelectorText').textContent = \`\${source.name} (\${source.bundleCount})\`;
                    sourceItem.querySelector('input[type="radio"]').checked = true;
                    document.getElementById('sourceDropdown').style.display = 'none';
                    renderBundles();
                });
            });
            
            // Add click handler for "All Sources"
            allItem.addEventListener('click', () => {
                document.querySelectorAll('.source-item').forEach(i => i.classList.remove('active'));
                allItem.classList.add('active');
                selectedSource = 'all';
                document.getElementById('sourceSelectorText').textContent = 'All Sources';
                allItem.querySelector('input[type="radio"]').checked = true;
                document.getElementById('sourceDropdown').style.display = 'none';
                renderBundles();
            });

            // Populate tag list with checkboxes
            tagList.innerHTML = '';
            filterOptions.tags.forEach(tag => {
                const tagItem = document.createElement('div');
                tagItem.className = 'tag-item';
                tagItem.dataset.tag = tag;
                
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.id = 'tag-' + tag;
                checkbox.value = tag;
                
                const label = document.createElement('label');
                label.htmlFor = 'tag-' + tag;
                label.textContent = tag;
                label.style.cursor = 'pointer';
                label.style.flex = '1';
                
                tagItem.appendChild(checkbox);
                tagItem.appendChild(label);
                
                // Toggle checkbox on item click
                tagItem.addEventListener('click', (e) => {
                    if (e.target !== checkbox) {
                        checkbox.checked = !checkbox.checked;
                    }
                    updateSelectedTags();
                });
                
                tagList.appendChild(tagItem);
            });
        }

        // Update selected tags from checkboxes
        function updateSelectedTags() {
            const checkboxes = document.querySelectorAll('#tagList input[type="checkbox"]:checked');
            selectedTags = Array.from(checkboxes).map(cb => cb.value);
            updateTagButtonText();
            renderBundles();
        }

        // Update the tag button text based on selection
        function updateTagButtonText() {
            const tagSelectorText = document.getElementById('tagSelectorText');
            if (selectedTags.length === 0) {
                tagSelectorText.textContent = 'All Tags';
            } else if (selectedTags.length === 1) {
                tagSelectorText.textContent = selectedTags[0];
            } else {
                tagSelectorText.textContent = \`\${selectedTags.length} tags\`;
            }
        }

        // Toggle tag dropdown
        document.getElementById('tagSelectorBtn').addEventListener('click', () => {
            const dropdown = document.getElementById('tagDropdown');
            dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
            
            if (dropdown.style.display === 'block') {
                document.getElementById('tagSearch').focus();
            }
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            const tagSelector = document.querySelector('.tag-selector');
            const dropdown = document.getElementById('tagDropdown');
            
            if (!tagSelector.contains(e.target) && dropdown.style.display === 'block') {
                dropdown.style.display = 'none';
            }
        });

        // Tag search functionality
        document.getElementById('tagSearch').addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            const tagItems = document.querySelectorAll('.tag-item');
            
            tagItems.forEach(item => {
                const tagName = item.dataset.tag.toLowerCase();
                if (tagName.includes(searchTerm)) {
                    item.classList.remove('hidden');
                } else {
                    item.classList.add('hidden');
                }
            });
        });

        // Search functionality
        document.getElementById('searchBox').addEventListener('input', (e) => {
            renderBundles();
        });

        // Source selector button click
        document.getElementById('sourceSelectorBtn').addEventListener('click', (e) => {
            e.stopPropagation();
            const dropdown = document.getElementById('sourceDropdown');
            dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
            
            if (dropdown.style.display === 'block') {
                document.getElementById('sourceSearch').focus();
            }
        });

        // Close source dropdown when clicking outside
        document.addEventListener('click', (e) => {
            const sourceSelector = document.querySelector('.source-selector');
            const dropdown = document.getElementById('sourceDropdown');
            
            if (sourceSelector && !sourceSelector.contains(e.target) && dropdown && dropdown.style.display === 'block') {
                dropdown.style.display = 'none';
            }
        });

        // Source search functionality
        document.getElementById('sourceSearch').addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            const sourceItems = document.querySelectorAll('.source-item');
            
            sourceItems.forEach(item => {
                const sourceName = item.dataset.source.toLowerCase();
                if (sourceName.includes(searchTerm)) {
                    item.classList.remove('hidden');
                } else {
                    item.classList.add('hidden');
                }
            });
        });

        // Source item selection
        document.querySelectorAll('.source-item').forEach(item => {
            item.addEventListener('click', () => {
                // Update selection
                document.querySelectorAll('.source-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                
                // Update selected source
                selectedSource = item.dataset.source;
                
                // Update button text
                const label = item.querySelector('label').textContent;
                document.getElementById('sourceSelectorText').textContent = label;
                
                // Check radio button
                item.querySelector('input[type="radio"]').checked = true;
                
                // Close dropdown
                document.getElementById('sourceDropdown').style.display = 'none';
                
                // Re-render bundles
                renderBundles();
            });
        });

        // Installed filter checkbox
        document.getElementById('installedCheckbox').addEventListener('change', (e) => {
            showInstalledOnly = e.target.checked;
            renderBundles();
        });

        // Make the filter div clickable to toggle checkbox
        document.getElementById('installedFilter').addEventListener('click', (e) => {
            if (e.target.id !== 'installedCheckbox') {
                const checkbox = document.getElementById('installedCheckbox');
                checkbox.checked = !checkbox.checked;
                showInstalledOnly = checkbox.checked;
                renderBundles();
            }
        });

        // Sort dropdown
        document.getElementById('sortSelect').addEventListener('change', (e) => {
            selectedSort = e.target.value;
            renderBundles();
        });

        // Clear filters button
        document.getElementById('clearFiltersBtn').addEventListener('click', () => {
            document.getElementById('searchBox').value = '';
            document.getElementById('sourceSearch').value = '';
            document.getElementById('tagSearch').value = '';
            document.getElementById('installedCheckbox').checked = false;
            document.getElementById('sortSelect').value = 'name-asc';
            
            // Reset source selector
            selectedSource = 'all';
            document.getElementById('sourceSelectorText').textContent = 'All Sources';
            document.querySelectorAll('.source-item').forEach(item => {
                item.classList.remove('active');
                if (item.dataset.source === 'all') {
                    item.classList.add('active');
                    item.querySelector('input[type="radio"]').checked = true;
                }
            });
            
            // Uncheck all tag checkboxes
            const checkboxes = document.querySelectorAll('#tagList input[type="checkbox"]');
            checkboxes.forEach(cb => cb.checked = false);
            
            // Show all tags
            const tagItems = document.querySelectorAll('.tag-item');
            tagItems.forEach(item => item.classList.remove('hidden'));
            
            selectedSource = 'all';
            selectedTags = [];
            showInstalledOnly = false;
            selectedSort = 'name-asc';
            updateTagButtonText();
            renderBundles();
        });

        // Refresh button
        document.getElementById('refreshBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'refresh' });
        });

        function renderBundles() {
            const marketplace = document.getElementById('marketplace');
            const searchTerm = document.getElementById('searchBox').value;
            
            let filteredBundles = allBundles;

            // Apply source filter
            if (selectedSource && selectedSource !== 'all') {
                filteredBundles = filteredBundles.filter(bundle => bundle.sourceId === selectedSource);
            }

            // Apply installed filter
            if (showInstalledOnly) {
                filteredBundles = filteredBundles.filter(bundle => bundle.installed === true);
            }

            // Apply tag filter (OR logic - bundle matches if it has ANY of the selected tags)
            if (selectedTags.length > 0) {
                filteredBundles = filteredBundles.filter(bundle => {
                    if (!bundle.tags || bundle.tags.length === 0) return false;
                    return bundle.tags.some(bundleTag => 
                        selectedTags.some(selectedTag => 
                            bundleTag.toLowerCase() === selectedTag.toLowerCase()
                        )
                    );
                });
            }

            // Apply search filter
            if (searchTerm && searchTerm.trim() !== '') {
                const term = searchTerm.toLowerCase();
                filteredBundles = filteredBundles.filter(bundle => 
                    bundle.name.toLowerCase().includes(term) ||
                    bundle.description.toLowerCase().includes(term) ||
                    (bundle.tags && bundle.tags.some(tag => tag.toLowerCase().includes(term))) ||
                    (bundle.author && bundle.author.toLowerCase().includes(term))
                );
            }

            // Apply sorting
            switch (selectedSort) {
                case 'rating-desc':
                    filteredBundles.sort((a, b) => {
                        const ratingA = a.rating?.wilsonScore ?? 0;
                        const ratingB = b.rating?.wilsonScore ?? 0;
                        return ratingB - ratingA;
                    });
                    break;
                case 'rating-asc':
                    filteredBundles.sort((a, b) => {
                        const ratingA = a.rating?.wilsonScore ?? 0;
                        const ratingB = b.rating?.wilsonScore ?? 0;
                        return ratingA - ratingB;
                    });
                    break;
                case 'name-asc':
                    filteredBundles.sort((a, b) => a.name.localeCompare(b.name));
                    break;
                case 'name-desc':
                    filteredBundles.sort((a, b) => b.name.localeCompare(a.name));
                    break;
            }

            if (filteredBundles.length === 0) {
                // Check if we have any bundles at all (before filtering)
                const hasFiltersApplied = searchTerm || selectedSource !== 'all' || selectedTags.length > 0 || showInstalledOnly;
                
                if (allBundles.length === 0) {
                    // No bundles at all - likely still syncing
                    marketplace.innerHTML = \`
                        <div class="empty-state">
                            <div class="spinner"></div>
                            <div class="empty-state-title">Syncing sources...</div>
                            <p>Bundles will appear as sources are synced</p>
                        </div>
                    \`;
                } else if (hasFiltersApplied) {
                    // Has bundles but filters hide them all
                    marketplace.innerHTML = \`
                        <div class="empty-state">
                            <div class="empty-state-icon">🔍</div>
                            <div class="empty-state-title">No bundles match your filters</div>
                            <p>Try adjusting your search or filters</p>
                        </div>
                    \`;
                } else {
                    marketplace.innerHTML = \`
                        <div class="empty-state">
                            <div class="empty-state-icon">📦</div>
                            <div class="empty-state-title">No bundles found</div>
                            <p>Try adjusting your search or filters</p>
                        </div>
                    \`;
                }
                return;
            }

            marketplace.innerHTML = filteredBundles.map(bundle => \`
                <div class="bundle-card \${bundle.installed ? 'installed' : ''}" data-bundle-id="\${bundle.id}" onclick="openDetails('\${bundle.id}')">
                    \${bundle.installed && bundle.autoUpdateEnabled ? '<div class="installed-badge">🔄 Auto-Update</div>' : bundle.installed ? '<div class="installed-badge">✓ Installed</div>' : ''}
                    \${bundle.isCurated ? '<div class="curated-badge" title="From curated hub: ' + (bundle.hubName || 'Unknown') + '">' + (bundle.hubName || 'Curated') + '</div>' : ''}
                    
                    <div class="bundle-header">
                        <div class="bundle-title-row">
                            <div class="bundle-title">\${bundle.name}</div>
                            \${bundle.rating ? \`
                                <button class="rating-badge clickable" 
                                        onclick="showFeedbacks('\${bundle.id}', event)" 
                                        title="\${bundle.rating.voteCount} votes (\${bundle.rating.confidence} confidence)">
                                    <span class="rating-stars">\${renderStars(bundle.rating.starRating)}</span>
                                    <span class="rating-score">\${bundle.rating.wilsonScore.toFixed(1)}</span>
                                    <span class="rating-votes">(\${bundle.rating.voteCount})</span>
                                </button>
                            \` : ''}
                        </div>
                        <div class="bundle-author">by \${bundle.author || 'Unknown'} • v\${bundle.version}</div>
                    </div>

                    <div class="bundle-description">
                        \${bundle.description || 'No description available'}
                    </div>

                    <div class="content-breakdown">
                        \${renderContentItem('💬', 'Prompts', bundle.contentBreakdown?.prompts || 0)}
                        \${renderContentItem('📋', 'Instructions', bundle.contentBreakdown?.instructions || 0)}
                        \${renderContentItem('🤖', 'Agents', bundle.contentBreakdown?.agents || 0)}
                        \${renderContentItem('🛠️', 'Skills', bundle.contentBreakdown?.skills || 0)}
                        \${renderContentItem('🔌', 'MCP Servers', bundle.contentBreakdown?.mcpServers || 0)}
                    </div>

                    <div class="bundle-tags">
                        \${(bundle.tags || []).slice(0, 4).map(tag => \`
                            <span class="tag">\${tag}</span>
                        \`).join('')}
                    </div>

                    <div class="bundle-actions" onclick="event.stopPropagation()">
                        \${bundle.buttonState === 'update' 
                            ? bundle.availableVersions && bundle.availableVersions.length > 1
                                ? \`<div class="version-selector-group">
                                        <button class="btn btn-primary" onclick="updateBundle('\${bundle.id}')">Update\${bundle.installedVersion ? ' (v' + bundle.installedVersion + ' → v' + bundle.version + ')' : ''}</button>
                                        <button class="version-selector-arrow" onclick="toggleVersionDropdown('\${bundle.id}-update', event)">▾</button>
                                        <div class="version-dropdown" id="version-dropdown-\${bundle.id}-update">
                                            <div class="version-item uninstall" onclick="uninstallBundle('\${bundle.id}', event)">
                                                <span>Uninstall</span>
                                            </div>
                                            <div class="version-dropdown-header">Switch Version</div>
                                            \${(bundle.availableVersions || []).map((versionObj, index) => \`
                                                <div class="version-item \${versionObj.version === bundle.installedVersion ? 'current' : ''}" onclick="installBundleVersion('\${bundle.id}', '\${versionObj.version}', event)">
                                                    <span>v\${versionObj.version}</span>
                                                    \${versionObj.version === bundle.installedVersion ? '<span class="version-badge">Current</span>' : index === 0 ? '<span class="version-badge latest">Latest</span>' : ''}
                                                </div>
                                            \`).join('')}
                                        </div>
                                    </div>\`
                                : \`<button class="btn btn-primary" onclick="updateBundle('\${bundle.id}')">Update\${bundle.installedVersion ? ' (v' + bundle.installedVersion + ' → v' + bundle.version + ')' : ''}</button>\`
                            : bundle.buttonState === 'uninstall'
                            ? bundle.availableVersions && bundle.availableVersions.length > 1
                                ? \`<div class="version-selector-group">
                                        <button class="btn btn-danger" onclick="uninstallBundle('\${bundle.id}')">Uninstall</button>
                                        <button class="version-selector-arrow danger" onclick="toggleVersionDropdown('\${bundle.id}-installed', event)">▾</button>
                                        <div class="version-dropdown" id="version-dropdown-\${bundle.id}-installed">
                                            <div class="version-item uninstall" onclick="uninstallBundle('\${bundle.id}', event)">
                                                <span>Uninstall</span>
                                            </div>
                                            <div class="version-dropdown-header">Switch Version</div>
                                            \${(bundle.availableVersions || []).map((versionObj, index) => \`
                                                <div class="version-item \${versionObj.version === bundle.installedVersion ? 'current' : ''}" onclick="installBundleVersion('\${bundle.id}', '\${versionObj.version}', event)">
                                                    <span>v\${versionObj.version}</span>
                                                    \${versionObj.version === bundle.installedVersion ? '<span class="version-badge">Current</span>' : index === 0 ? '<span class="version-badge latest">Latest</span>' : ''}
                                                </div>
                                            \`).join('')}
                                        </div>
                                    </div>\`
                                : \`<button class="btn btn-danger" onclick="uninstallBundle('\${bundle.id}')">Uninstall</button>\`
                            : bundle.availableVersions && bundle.availableVersions.length > 1
                            ? \`<div class="version-selector-group">
                                    <button class="btn btn-primary" onclick="installBundle('\${bundle.id}')">Install</button>
                                    <button class="version-selector-arrow" onclick="toggleVersionDropdown('\${bundle.id}', event)">▾</button>
                                    <div class="version-dropdown" id="version-dropdown-\${bundle.id}">
                                        <div class="version-dropdown-header">Select Version</div>
                                        \${(bundle.availableVersions || []).map((versionObj, index) => \`
                                            <div class="version-item" onclick="installBundleVersion('\${bundle.id}', '\${versionObj.version}', event)">
                                                <span>v\${versionObj.version}</span>
                                                \${index === 0 ? '<span class="version-badge latest">Latest</span>' : ''}
                                            </div>
                                        \`).join('')}
                                    </div>
                                </div>\`
                            : \`<button class="btn btn-primary" onclick="installBundle('\${bundle.id}')">Install</button>\`
                        }
                        <button class="btn btn-secondary" onclick="openDetails('\${bundle.id}')">Details</button>
                        <button class="btn btn-link" onclick="openSourceRepo('\${bundle.id}')" title="Open Source Repository">
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 3A1.5 1.5 0 0 0 3 4.5v7A1.5 1.5 0 0 0 4.5 13h7a1.5 1.5 0 0 0 1.5-1.5v-2a.5.5 0 0 1 1 0v2a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 2 11.5v-7A2.5 2.5 0 0 1 4.5 2h2a.5.5 0 0 1 0 1h-2zM9 2.5a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-1 0V3.707l-5.146 5.147a.5.5 0 0 1-.708-.708L12.293 3H9.5a.5.5 0 0 1-.5-.5z"/></svg>
                        </button>
                    </div>
                </div>
            \`).join('');
        }

        function renderContentItem(icon, label, count) {
            if (count === 0) return '';
            return \`
                <div class="content-item">
                    <span class="content-icon">\${icon}</span>
                    <span class="content-count">\${count}</span>
                    <span>\${label}</span>
                </div>
            \`;
        }

        function installBundle(bundleId) {
            vscode.postMessage({ type: 'install', bundleId });
        }

        function updateBundle(bundleId) {
            vscode.postMessage({ type: 'update', bundleId });
        }

        function uninstallBundle(bundleId) {
            vscode.postMessage({ type: 'uninstall', bundleId });
        }

        function openDetails(bundleId) {
            vscode.postMessage({ type: 'openDetails', bundleId });
        }

        function openSourceRepo(bundleId) {
            vscode.postMessage({ type: 'openSourceRepository', bundleId });
        }

        function toggleVersionDropdown(dropdownId, event) {
            event.stopPropagation();
            const dropdown = document.getElementById('version-dropdown-' + dropdownId);
            if (!dropdown) return;
            
            // Close all other dropdowns
            document.querySelectorAll('.version-dropdown').forEach(d => {
                if (d.id !== 'version-dropdown-' + dropdownId) {
                    d.classList.remove('show');
                }
            });
            
            // Toggle this dropdown
            dropdown.classList.toggle('show');
        }

        function renderStars(rating) {
            const fullStars = Math.floor(rating);
            const hasHalfStar = rating % 1 >= 0.5;
            const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);
            
            return '★'.repeat(fullStars) + 
                   (hasHalfStar ? '⯨' : '') + 
                   '☆'.repeat(emptyStars);
        }

        function showFeedbacks(bundleId, event) {
            event.stopPropagation();
            
            // Request feedback data from extension
            vscode.postMessage({ 
                type: 'getFeedbacks', 
                bundleId: bundleId 
            });
            
            // Show modal with loading state
            const modal = document.getElementById('feedbackModal');
            const feedbackList = document.getElementById('feedbackList');
            const feedbackSummary = document.getElementById('feedbackSummary');
            const modalTitle = document.getElementById('feedbackModalTitle');
            
            // Find bundle name for title
            const bundle = allBundles.find(b => b.id === bundleId);
            modalTitle.textContent = bundle ? \`Feedbacks for \${bundle.name}\` : 'User Feedbacks';
            
            feedbackSummary.innerHTML = '';
            feedbackList.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading feedbacks...</p></div>';
            modal.style.display = 'flex';
        }

        function closeFeedbackModal() {
            const modal = document.getElementById('feedbackModal');
            modal.style.display = 'none';
        }

        function renderFeedbackModal(bundleId, feedbacks, rating) {
            const feedbackSummary = document.getElementById('feedbackSummary');
            const feedbackList = document.getElementById('feedbackList');
            
            // Render rating summary if available
            if (rating && rating.voteCount > 0) {
                const distribution = calculateRatingDistribution(feedbacks);
                feedbackSummary.innerHTML = \`
                    <div class="rating-overview">
                        <div>
                            <div class="rating-large">\${rating.starRating.toFixed(1)}</div>
                            <div class="rating-stars-large">\${renderStars(rating.starRating)}</div>
                            <div class="rating-count">\${rating.voteCount} ratings</div>
                        </div>
                        <div class="rating-bars">
                            \${renderRatingBars(distribution, rating.voteCount)}
                        </div>
                    </div>
                \`;
            }
            
            // Render feedback items
            if (!feedbacks || feedbacks.length === 0) {
                feedbackList.innerHTML = \`
                    <div class="feedback-empty">
                        <div class="feedback-empty-icon">💬</div>
                        <p>No feedbacks yet</p>
                        <p style="font-size: 12px; margin-top: 8px;">Be the first to share your experience!</p>
                    </div>
                \`;
                return;
            }
            
            feedbackList.innerHTML = feedbacks.map(feedback => \`
                <div class="feedback-item">
                    <div class="feedback-header">
                        <div class="feedback-rating">\${feedback.rating ? renderStars(feedback.rating) : ''}</div>
                        <div class="feedback-meta">
                            <span class="feedback-date">\${formatDate(feedback.timestamp)}</span>
                            \${feedback.version ? \`<span class="feedback-version">v\${feedback.version}</span>\` : ''}
                        </div>
                    </div>
                    <div class="feedback-comment">\${escapeHtml(feedback.comment)}</div>
                </div>
            \`).join('');
        }

        function calculateRatingDistribution(feedbacks) {
            const dist = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
            if (!feedbacks) return dist;
            
            feedbacks.forEach(f => {
                if (f.rating && f.rating >= 1 && f.rating <= 5) {
                    dist[f.rating]++;
                }
            });
            return dist;
        }

        function renderRatingBars(distribution, total) {
            const stars = [5, 4, 3, 2, 1];
            return stars.map(star => {
                const count = distribution[star] || 0;
                const percentage = total > 0 ? (count / total * 100) : 0;
                return \`
                    <div class="rating-bar-row">
                        <div class="rating-bar-label">\${star} stars</div>
                        <div class="rating-bar-track">
                            <div class="rating-bar-fill" style="width: \${percentage}%"></div>
                        </div>
                        <div class="rating-bar-count">\${count}</div>
                    </div>
                \`;
            }).join('');
        }

        function formatDate(isoString) {
            const date = new Date(isoString);
            const now = new Date();
            const diffMs = now - date;
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            
            if (diffDays === 0) return 'Today';
            if (diffDays === 1) return 'Yesterday';
            if (diffDays < 7) return \`\${diffDays} days ago\`;
            if (diffDays < 30) return \`\${Math.floor(diffDays / 7)} weeks ago\`;
            if (diffDays < 365) return \`\${Math.floor(diffDays / 30)} months ago\`;
            return \`\${Math.floor(diffDays / 365)} years ago\`;
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function installBundleVersion(bundleId, version, event) {
            event.stopPropagation();
            
            // Close dropdown
            document.querySelectorAll('.version-dropdown').forEach(d => {
                d.classList.remove('show');
            });
            
            vscode.postMessage({ 
                type: 'installVersion', 
                bundleId: bundleId,
                version: version
            });
        }

        // Close dropdowns when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.version-selector')) {
                document.querySelectorAll('.version-dropdown').forEach(d => {
                    d.classList.remove('show');
                });
            }
        });
    </script>
</body>
</html>`;
    }
}
