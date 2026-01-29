#!/usr/bin/env node
/**
 * CLI wrapper for compute-ratings
 */

const { computeRatings, parseArgs } = require('../dist/compute-ratings');

async function main() {
    const args = process.argv.slice(2);
    const { configPath, outputPath } = parseArgs(args);
    
    // Check for GitHub token
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
        console.error('Error: GITHUB_TOKEN environment variable is required');
        process.exit(1);
    }
    
    try {
        await computeRatings(configPath, outputPath, token);
    } catch (error) {
        console.error('Fatal error:', error.message);
        process.exit(1);
    }
}

main();
