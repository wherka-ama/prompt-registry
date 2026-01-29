#!/usr/bin/env ts-node
/**
 * Generate demo ratings.json from a hub configuration
 * 
 * Usage: ts-node scripts/generate-demo-ratings.ts <hub-url>
 * Example: ts-node scripts/generate-demo-ratings.ts https://github.com/AmadeusITGroup/prompt-registry-config
 */

import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

interface HubSource {
    id: string;
    name: string;
    type: string;
    url?: string;
    owner?: string;
    repo?: string;
}

interface ProfileBundle {
    id: string;
    version: string;
    source: string;
    required?: boolean;
}

interface Profile {
    id: string;
    name: string;
    description?: string;
    bundles: ProfileBundle[];
}

interface HubConfig {
    name: string;
    description: string;
    sources: HubSource[];
    profiles?: Profile[];
}

interface BundleInfo {
    id: string;
    fullId: string;
    source: string;
}

interface Rating {
    upvotes: number;
    downvotes: number;
    totalVotes: number;
    wilsonScore: number;
    bayesianAverage: number;
    starRating: number;
    voteCount: number;
    confidence: string;
}

/**
 * Fetch hub config from GitHub
 */
function fetchHubConfig(hubUrl: string): HubConfig {
    // Parse GitHub URL
    const match = hubUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!match) {
        throw new Error(`Invalid GitHub URL: ${hubUrl}`);
    }
    const [, owner, repo] = match;

    console.log(`Fetching hub config from ${owner}/${repo}...`);

    // Fetch hub-config.yml using gh CLI
    const content = execSync(
        `gh api repos/${owner}/${repo}/contents/hub-config.yml --jq '.content' | base64 -d`,
        { encoding: 'utf-8' }
    );

    return yaml.load(content) as HubConfig;
}

/**
 * Fetch bundles from a GitHub source
 */
function fetchGitHubBundles(owner: string, repo: string, sourceId: string): BundleInfo[] {
    console.log(`  Fetching bundles from ${owner}/${repo}...`);
    
    try {
        // Try to fetch collections directory
        const collectionsJson = execSync(
            `gh api repos/${owner}/${repo}/contents/collections --jq '.[] | select(.type == "dir") | .name'`,
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
        );
        
        const bundleNames = collectionsJson.trim().split('\n').filter(Boolean);
        console.log(`    Found ${bundleNames.length} bundles`);
        
        return bundleNames.map(name => ({
            id: name,
            fullId: `${owner}/${repo}/${name}`,
            source: sourceId
        }));
    } catch (error) {
        // If collections directory doesn't exist, try root-level bundles
        try {
            const rootJson = execSync(
                `gh api repos/${owner}/${repo}/contents --jq '.[] | select(.type == "dir" and .name != ".github") | .name'`,
                { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
            );
            
            const bundleNames = rootJson.trim().split('\n').filter(Boolean);
            console.log(`    Found ${bundleNames.length} bundles (root level)`);
            
            return bundleNames.map(name => ({
                id: name,
                fullId: `${owner}/${repo}/${name}`,
                source: sourceId
            }));
        } catch (innerError) {
            console.log(`    No bundles found in ${owner}/${repo}`);
            return [];
        }
    }
}

/**
 * Fetch bundles from awesome-copilot hub
 */
function fetchAwesomeCopilotBundles(sourceId: string): BundleInfo[] {
    console.log(`  Fetching bundles from awesome-copilot hub...`);
    
    try {
        const hubJson = execSync(
            `gh api repos/awesome-copilot/hub/contents/hub.json --jq '.content' | base64 -d`,
            { encoding: 'utf-8' }
        );
        
        const hub = JSON.parse(hubJson);
        const bundles: BundleInfo[] = [];
        
        if (hub.bundles) {
            for (const bundle of hub.bundles) {
                bundles.push({
                    id: bundle.id,
                    fullId: bundle.id,
                    source: sourceId
                });
            }
        }
        
        console.log(`    Found ${bundles.length} bundles`);
        return bundles;
    } catch (error) {
        console.log(`    Failed to fetch awesome-copilot bundles`);
        return [];
    }
}

/**
 * Generate realistic rating data
 */
function generateRating(bundleIndex: number, totalBundles: number): Rating {
    // Generate realistic distribution
    // Popular bundles (first 20%) get more votes
    const isPopular = bundleIndex < totalBundles * 0.2;
    const isModerate = bundleIndex < totalBundles * 0.5;
    
    // Vote count distribution
    let voteCount: number;
    if (isPopular) {
        voteCount = Math.floor(150 + Math.random() * 200); // 150-350 votes
    } else if (isModerate) {
        voteCount = Math.floor(70 + Math.random() * 100); // 70-170 votes
    } else {
        voteCount = Math.floor(30 + Math.random() * 60); // 30-90 votes
    }
    
    // Quality distribution (most bundles are good)
    const qualityRoll = Math.random();
    let upvoteRatio: number;
    if (qualityRoll < 0.15) {
        upvoteRatio = 0.95 + Math.random() * 0.04; // Excellent: 95-99%
    } else if (qualityRoll < 0.50) {
        upvoteRatio = 0.88 + Math.random() * 0.07; // Very good: 88-95%
    } else if (qualityRoll < 0.85) {
        upvoteRatio = 0.80 + Math.random() * 0.08; // Good: 80-88%
    } else {
        upvoteRatio = 0.70 + Math.random() * 0.10; // Decent: 70-80%
    }
    
    const upvotes = Math.floor(voteCount * upvoteRatio);
    const downvotes = voteCount - upvotes;
    
    // Calculate Wilson score (95% confidence interval)
    const n = voteCount;
    const phat = upvotes / n;
    const z = 1.96; // 95% confidence
    const wilsonScore = (phat + z * z / (2 * n) - z * Math.sqrt((phat * (1 - phat) + z * z / (4 * n)) / n)) / (1 + z * z / n);
    
    // Bayesian average (with prior of 3.5 stars, 10 votes)
    const priorMean = 3.5;
    const priorWeight = 10;
    const bayesianAverage = (upvoteRatio * 5 * voteCount + priorMean * priorWeight) / (voteCount + priorWeight);
    
    // Star rating (1-5 scale)
    const starRating = Math.round(bayesianAverage * 10) / 10;
    
    // Confidence level
    let confidence: string;
    if (voteCount >= 100) {
        confidence = 'high';
    } else if (voteCount >= 50) {
        confidence = 'medium';
    } else {
        confidence = 'low';
    }
    
    return {
        upvotes,
        downvotes,
        totalVotes: voteCount,
        wilsonScore: Math.round(wilsonScore * 10000) / 10000,
        bayesianAverage: Math.round(bayesianAverage * 100) / 100,
        starRating,
        voteCount,
        confidence
    };
}

/**
 * Extract bundles from hub profiles
 */
function extractBundlesFromProfiles(hubConfig: HubConfig): BundleInfo[] {
    const bundles: BundleInfo[] = [];
    const seen = new Set<string>();
    
    if (!hubConfig.profiles) {
        return bundles;
    }
    
    for (const profile of hubConfig.profiles) {
        for (const bundle of profile.bundles) {
            // Create full bundle ID based on source
            const source = hubConfig.sources.find(s => s.id === bundle.source);
            let fullId: string;
            
            if (source?.type === 'github' && source.owner && source.repo) {
                fullId = `${source.owner}/${source.repo}/${bundle.id}`;
            } else if (source?.type === 'awesome-copilot' || source?.type === 'skills') {
                fullId = bundle.id;
            } else {
                fullId = bundle.id;
            }
            
            // Avoid duplicates
            if (!seen.has(fullId)) {
                seen.add(fullId);
                bundles.push({
                    id: bundle.id,
                    fullId: fullId,
                    source: bundle.source
                });
            }
        }
    }
    
    return bundles;
}

/**
 * Main function
 */
async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error('Usage: ts-node scripts/generate-demo-ratings.ts <hub-url>');
        console.error('Example: ts-node scripts/generate-demo-ratings.ts https://github.com/AmadeusITGroup/prompt-registry-config');
        process.exit(1);
    }
    
    const hubUrl = args[0];
    
    try {
        // Fetch hub config
        const hubConfig = fetchHubConfig(hubUrl);
        console.log(`Hub: ${hubConfig.name || 'Unknown'}`);
        console.log(`Sources: ${hubConfig.sources.length}`);
        console.log(`Profiles: ${hubConfig.profiles?.length || 0}`);
        console.log('');
        
        // Extract all bundles from profiles
        console.log('Extracting bundles from profiles...');
        const allBundles = extractBundlesFromProfiles(hubConfig);
        console.log(`Found ${allBundles.length} unique bundles`);
        console.log('');
        
        console.log(`Total bundles found: ${allBundles.length}`);
        console.log('');
        
        // Generate ratings for all bundles
        console.log('Generating ratings...');
        const ratings: Record<string, Rating> = {};
        
        allBundles.forEach((bundle, index) => {
            ratings[bundle.fullId] = generateRating(index, allBundles.length);
        });
        
        // Create output
        const output = {
            version: '1.0.0',
            generated: new Date().toISOString(),
            bundles: ratings
        };
        
        // Write to file
        const outputPath = path.join(process.cwd(), 'demo-ratings.json');
        fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
        
        console.log(`✓ Generated ratings for ${allBundles.length} bundles`);
        console.log(`✓ Saved to: ${outputPath}`);
        
        // Print statistics
        const allRatings = Object.values(ratings);
        const avgRating = allRatings.reduce((sum, r) => sum + r.starRating, 0) / allRatings.length;
        const avgVotes = allRatings.reduce((sum, r) => sum + r.voteCount, 0) / allRatings.length;
        const highConfidence = allRatings.filter(r => r.confidence === 'high').length;
        
        console.log('');
        console.log('Statistics:');
        console.log(`  Average rating: ${avgRating.toFixed(2)} stars`);
        console.log(`  Average votes: ${Math.round(avgVotes)}`);
        console.log(`  High confidence: ${highConfidence}/${allRatings.length}`);
        
    } catch (error) {
        console.error('Error:', (error as Error).message);
        process.exit(1);
    }
}

main();
