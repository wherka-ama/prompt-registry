# SonarQube Setup Guide for Prompt Registry

## Executive Summary

This guide provides a comprehensive approach to setting up SonarQube for the Prompt Registry project, focusing on:
- Local-first development environment
- Rootless Podman containerization
- TypeScript analysis tailored to the project's architecture
- Machine-readable report generation for LLM-assisted refactoring

## Viability Assessment

### SonarQube for TypeScript

**Verdict: Highly Viable**

SonarQube provides robust TypeScript/JavaScript analysis capabilities:

- **Availability**: TypeScript/JavaScript/CSS analysis is available in **all editions** of SonarQube Server and SonarQube Community Build
- **ESLint Integration**: Sonar includes a selection of ESLint rules and supports importing external ESLint issues via the External Issues feature
- **TypeScript Support**: Full TypeScript analysis with compiler integration, respecting tsconfig.json configurations
- **Monorepo Support**: Native support for monorepo projects (relevant given the workspace structure with `lib/` and `github-actions/` workspaces)
- **Coverage Integration**: Supports test coverage reports from third-party tools (currently using c8 in this project)

### Project-Specific Considerations

The Prompt Registry project is well-suited for SonarQube analysis:

- **TypeScript 5.3+**: Target ES2024, strict mode enabled
- **ESLint v9**: Flat configuration with TypeScript support
- **Extensive Test Coverage**: 1000+ unit tests, integration tests, E2E tests
- **Workspace Structure**: npm workspaces with separate `lib/` package
- **Existing Quality Tools**: Prettier, ESLint, c8 coverage, Mocha tests

### Limitations and Considerations

1. **Community Edition Limitations**: While TypeScript analysis is available in Community Edition, some advanced features (security hotspots, code smells categorization) require Developer/Enterprise editions
2. **Scanner Memory**: Large TypeScript projects may require increased heap memory for the scanner
3. **Build Time**: Full analysis adds to build time; consider incremental analysis for frequent runs
4. **ESLint Duplication**: Sonar's built-in rules may overlap with existing ESLint configuration; careful rule selection needed to avoid noise

---

## Local-First Setup with Rootless Podman

### Prerequisites

```bash
# Verify podman installation
podman --version

# Verify rootless podman is configured
podman info
```

### Volume Strategy for Rootless Podman

Rootless Podman has specific volume permission requirements. Use one of these approaches:

#### Option 1: Podman Unshare (Recommended)

```bash
# Create data directories with proper ownership
mkdir -p ~/sonarqube/data ~/sonarqube/extensions ~/sonarqube/logs ~/sonarqube/postgres 

# Set up volumes with podman unshare
podman unshare chown -R 1000:1000 ~/sonarqube
```

#### Option 2: User Namespace Mapping

```bash
# Use --userns keep-id flag when running containers
# This maps container UIDs to host UIDs
```

### Container Configuration

Create a `docker-compose.yml` or use Podman directly:

```yaml
# docker-compose.yml
version: '3.8'

services:
  sonarqube:
    image: sonarqube:latest
    container_name: sonarqube
    ports:
      - "9000:9000"
    environment:
      - SONAR_JDBC_URL=jdbc:postgresql://db:5432/sonar
      - SONAR_JDBC_USERNAME=sonar
      - SONAR_JDBC_PASSWORD=sonar
      - SONAR_WEB_CONTEXT=/sonarqube
    volumes:
      - ~/sonarqube/data:/opt/sonarqube/data
      - ~/sonarqube/extensions:/opt/sonarqube/extensions
      - ~/sonarqube/logs:/opt/sonarqube/logs
    depends_on:
      - db
    user: "1000:1000"  # Run as non-root user

  db:
    image: postgres:15
    container_name: sonarqube-db
    environment:
      - POSTGRES_USER=sonar
      - POSTGRES_PASSWORD=sonar
      - POSTGRES_DB=sonar
    volumes:
      - ~/sonarqube/postgres:/var/lib/postgresql/data
    user: "1000:1000"
```

### Starting the Container

```bash
# Using docker-compose
podman-compose up -d

# Or using podman directly
podman run -d \
  --name sonarqube \
  --userns keep-id \
  -p 9000:9000 \
  -e SONAR_JDBC_URL=jdbc:postgresql://sonarqube-db:5432/sonar \
  -e SONAR_JDBC_USERNAME=sonar \
  -e SONAR_JDBC_PASSWORD=sonar \
  -v ~/sonarqube/data:/opt/sonarqube/data \
  -v ~/sonarqube/extensions:/opt/sonarqube/extensions \
  -v ~/sonarqube/logs:/opt/sonarqube/logs \
  dockerhub.rnd.amadeus.net/registry-1-docker-io-remote/sonarqube:latest

# Start PostgreSQL separately
podman run -d \
  --name sonarqube-db \
  --userns keep-id \
  -e POSTGRES_USER=sonar \
  -e POSTGRES_PASSWORD=sonar \
  -e POSTGRES_DB=sonar \
  -v ~/sonarqube/postgres:/var/lib/postgresql/data \
  dockerhub.rnd.amadeus.net/registry-1-docker-io-remote/postgres:15
```

### Initial Setup

1. Access SonarQube at `http://localhost:9000`
2. Log in with default credentials (admin/admin)
3. Create a new user token: **My Account > Security > Generate Token**
4. Save the token for scanner configuration

---

## Project-Specific SonarQube Configuration

### Sonar-Project Properties

Create `sonar-project.properties` in the project root:

```properties
# Project identification
sonar.projectKey=prompt-registry
sonar.organization=amadeus-it-group
sonar.projectName=Prompt Registry
sonar.projectVersion=0.0.2

# Source code locations
sonar.sources=src,lib/src
sonar.tests=test,lib/test

# Exclusions
sonar.exclusions=**/*.d.ts,**/dist/**,**/test-dist/**,**/node_modules/**,**/out/**,**/.vscode-test/**
sonar.test.exclusions=**/*.test.ts,**/*.spec.ts

# TypeScript configuration
sonar.typescript.tsconfigPath=tsconfig.json
sonar.typescript.lib=lib/tsconfig.json

# JavaScript/TypeScript specific
sonar.javascript.lcov.reportPaths=coverage/lcov.info,lib/coverage/lcov.info
sonar.javascript.coverage.reportPaths=coverage/coverage.json,lib/coverage/coverage.json

# ESLint integration (optional - for external rules)
sonar.eslint.reportPaths=eslint-report.json

# Encoding
sonar.sourceEncoding=UTF-8

# exclusions for generated files
sonar.coverage.exclusions=**/*.d.ts,**/dist/**,**/test-dist/**,**/node_modules/**

# Maximum issues (adjust based on project needs)
sonar.issue.ignore.multicriteria=e1,e2
sonar.issue.ignore.multicriteria.e1.ruleKey=typescript:S4325
sonar.issue.ignore.multicriteria.e1.resourceKey=**/*.ts
sonar.issue.ignore.multicriteria.e2.ruleKey=typescript:S1135
sonar.issue.ignore.multicriteria.e2.resourceKey=**/*.test.ts
```

### Monorepo Configuration

Given the workspace structure with `lib/` and `github-actions/`, consider setting up multiple SonarQube projects:

#### Option 1: Single Project with Multiple Modules

```properties
# Main project
sonar.projectKey=prompt-registry
sonar.modules=prompt-registry-core,prompt-registry-lib,prompt-registry-github-actions

# Core module
prompt-registry-core.sonar.projectKey=prompt-registry-core
prompt-registry-core.sonar.sources=src
prompt-registry-core.sonar.tests=test

# Lib module
prompt-registry-lib.sonar.projectKey=prompt-registry-lib
prompt-registry-lib.sonar.sources=lib/src
prompt-registry-lib.sonar.tests=lib/test
prompt-registry-lib.sonar.typescript.tsconfigPath=lib/tsconfig.json

# GitHub Actions module
prompt-registry-github-actions.sonar.projectKey=prompt-registry-github-actions
prompt-registry-github-actions.sonar.sources=github-actions/validate-collections/src
prompt-registry-github-actions.sonar.tests=github-actions/validate-collections/test
```

#### Option 2: Separate Projects (Recommended for CI/CD)

Create separate SonarQube projects for each workspace:
- `prompt-registry-core` (main extension)
- `prompt-registry-lib` (@prompt-registry/collection-scripts)
- `prompt-registry-github-actions` (validate-collections)

This allows independent quality gates and better CI/CD integration.

---

## Scanner Setup

### Install SonarScanner CLI

```bash
# Using npm (recommended for Node.js projects)
npm install -D sonar-scanner

# Or download binary
wget https://binaries.sonarsource.com/Distribution/sonar-scanner-cli/sonar-scanner-cli-5.0.1.3006-linux.zip
unzip sonar-scanner-cli-5.0.1.3006-linux.zip
export PATH=$PATH:$PWD/sonar-scanner-5.0.1.3006-linux/bin
```

### Environment Variables

Create `.env.local` or set in shell:

```bash
export SONAR_TOKEN=your-generated-token
export SONAR_HOST_URL=http://localhost:9000
```

### Running the Scanner

```bash
# Full analysis
sonar-scanner \
  -Dsonar.projectKey=prompt-registry \
  -Dsonar.host.url=http://localhost:9000 \
  -Dsonar.token=$SONAR_TOKEN

# With coverage
npm run test:coverage
sonar-scanner \
  -Dsonar.projectKey=prompt-registry \
  -Dsonar.host.url=http://localhost:9000 \
  -Dsonar.token=$SONAR_TOKEN \
  -Dsonar.javascript.lcov.reportPaths=coverage/lcov.info

# Preview mode (no server upload)
sonar-scanner \
  -Dsonar.projectKey=prompt-registry \
  -Dsonar.host.url=http://localhost:9000 \
  -Dsonar.token=$SONAR_TOKEN \
  -Dsonar.analysis.mode=preview
```

### NPM Script Integration

Add to `package.json`:

```json
{
  "scripts": {
    "sonar:scan": "sonar-scanner",
    "sonar:scan:with-coverage": "npm run test:coverage && sonar-scanner",
    "sonar:preview": "sonar-scanner -Dsonar.analysis.mode=preview"
  }
}
```

---

## Machine-Readable Report Generation for LLM Consumption

### Web API Overview

SonarQube provides a comprehensive Web API under `/api` context path. All endpoints support JSON responses.

**Authentication**: Bearer token (recommended) or Basic auth

```bash
export SONAR_TOKEN=your-token
```

### Exporting Issues

#### Basic Issues Export

```bash
# Get all issues for a project
curl -u $SONAR_TOKEN: \
  "http://localhost:9000/api/issues/search?componentKeys=prompt-registry&ps=500&p=1" \
  | jq . > sonar-issues.json
```

#### Filtered Issues Export

```bash
# Get only critical bugs
curl -u $SONAR_TOKEN: \
  "http://localhost:9000/api/issues/search?componentKeys=prompt-registry&severities=CRITICAL,BLOCKER&types=BUG&ps=500" \
  | jq . > sonar-critical-bugs.json

# Get code smells by rule
curl -u $SONAR_TOKEN: \
  "http://localhost:9000/api/issues/search?componentKeys=prompt-registry&types=CODE_SMELL&ps=500" \
  | jq . > sonar-code-smells.json
```

#### Paginated Export (Complete Dataset)

```bash
#!/bin/bash
# export-all-issues.sh

TOKEN=$SONAR_TOKEN
HOST=http://localhost:9000
PROJECT=prompt-registry
PAGE=1
PAGE_SIZE=500
OUTPUT=sonar-issues-complete.json

echo "[" > $OUTPUT

while true; do
  RESPONSE=$(curl -s -u $TOKEN: \
    "$HOST/api/issues/search?componentKeys=$PROJECT&ps=$PAGE_SIZE&p=$PAGE")
  
  ISSUES=$(echo $RESPONSE | jq '.issues')
  TOTAL=$(echo $RESPONSE | jq '.total')
  CURRENT=$(echo $ISSUES | jq 'length')
  
  if [ $CURRENT -eq 0 ]; then
    break
  fi
  
  # Add comma if not first page
  if [ $PAGE -gt 1 ]; then
    echo "," >> $OUTPUT
  fi
  
  echo $ISSUES | jq '.[]' >> $OUTPUT
  
  PAGE=$((PAGE + 1))
  echo "Exported $CURRENT issues (total: $TOTAL)"
  
  if [ $((PAGE * PAGE_SIZE)) -gt $TOTAL ]; then
    break
  fi
done

echo "]" >> $OUTPUT
echo "Export complete: $OUTPUT"
```

### Exporting Metrics

```bash
# Get project metrics
curl -u $SONAR_TOKEN: \
  "http://localhost:9000/api/measures/component?component=prompt-registry&metricKeys=ncloc,complexity,coverage,duplicated_lines_density,violations" \
  | jq . > sonar-metrics.json

# Get all available metrics
curl -u $SONAR_TOKEN: \
  "http://localhost:9000/api/metrics/list" \
  | jq . > sonar-metrics-list.json
```

### Exporting Hotspots (Security)

```bash
# Get security hotspots
curl -u $SONAR_TOKEN: \
  "http://localhost:9000/api/hotspots/search?projectKey=prompt-registry&ps=500" \
  | jq . > sonar-hotspots.json
```

### LLM-Optimized Report Format

Create a script to transform SonarQube data into LLM-friendly format:

```typescript
// scripts/generate-llm-report.ts
import axios from 'axios';
import fs from 'fs/promises';

interface SonarIssue {
  key: string;
  rule: string;
  severity: string;
  component: string;
  line: number;
  message: string;
  debt: string;
  author: string;
  creationDate: string;
}

interface LLMReport {
  project: string;
  timestamp: string;
  summary: {
    totalIssues: number;
    bySeverity: Record<string, number>;
    byType: Record<string, number>;
    byComponent: Record<string, number>;
  };
  issues: Array<{
    file: string;
    line: number;
    severity: string;
    type: string;
    rule: string;
    message: string;
    suggestedFix?: string;
  }>;
}

async function generateLLMReport(
  host: string,
  token: string,
  projectKey: string
): Promise<LLMReport> {
  const client = axios.create({
    baseURL: host,
    auth: { username: token, password: '' }
  });

  // Fetch all issues (paginated)
  const allIssues: SonarIssue[] = [];
  let page = 1;
  const pageSize = 500;

  while (true) {
    const response = await client.get('/api/issues/search', {
      params: {
        componentKeys: projectKey,
        ps: pageSize,
        p: page
      }
    });

    const issues = response.data.issues;
    if (issues.length === 0) break;

    allIssues.push(...issues);
    page++;
  }

  // Transform to LLM-friendly format
  const summary = {
    totalIssues: allIssues.length,
    bySeverity: allIssues.reduce((acc, i) => {
      acc[i.severity] = (acc[i.severity] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    byType: allIssues.reduce((acc, i) => {
      acc[i.type] = (acc[i.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    byComponent: allIssues.reduce((acc, i) => {
      acc[i.component] = (acc[i.component] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  };

  const issues = allIssues.map(issue => ({
    file: issue.component,
    line: issue.line,
    severity: issue.severity,
    type: issue.type,
    rule: issue.rule,
    message: issue.message,
    debt: issue.debt
  }));

  return {
    project: projectKey,
    timestamp: new Date().toISOString(),
    summary,
    issues
  };
}

// Usage
const report = await generateLLMReport(
  process.env.SONAR_HOST_URL || 'http://localhost:9000',
  process.env.SONAR_TOKEN || '',
  'prompt-registry'
);

await fs.writeFile('sonar-llm-report.json', JSON.stringify(report, null, 2));
console.log('LLM report generated: sonar-llm-report.json');
```

### Example LLM Prompt Template

```markdown
# SonarQube Analysis Report for Refactoring

## Project Overview
- **Project**: {project}
- **Analysis Date**: {timestamp}
- **Total Issues**: {summary.totalIssues}

## Issue Summary
- **By Severity**: {summary.bySeverity}
- **By Type**: {summary.byType}
- **Top Components**: {summary.byComponent}

## Critical Issues Requiring Immediate Attention

{issues.filter(i => i.severity === 'CRITICAL' || i.severity === 'BLOCKER').map(i => `
- **${i.file}:${i.line}** [${i.type}]
  - Rule: ${i.rule}
  - Message: ${i.message}
  - Debt: ${i.debt}
`).join('\n')}

## High-Priority Code Smells

{issues.filter(i => i.type === 'CODE_SMELL' && ['MAJOR', 'CRITICAL'].includes(i.severity)).map(i => `
- **${i.file}:${i.line}** [${i.severity}]
  - Rule: ${i.rule}
  - Message: ${i.message}
`).join('\n')}

## Refactoring Recommendations

Based on the analysis above, please provide:
1. Prioritized refactoring plan addressing critical issues first
2. Architectural improvements to reduce code smells
3. Specific code changes with before/after examples
4. Estimated effort for each recommendation

Focus on issues that impact:
- Code maintainability
- Performance
- Security
- Test coverage
```

---

## CI/CD Integration

### GitHub Actions Example

```yaml
# .github/workflows/sonarqube.yml
name: SonarQube Analysis

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  sonarqube:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Full history for better analysis
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run tests with coverage
        run: npm run test:coverage
      
      - name: SonarQube Scan
        uses: sonarsource/sonarqube-scan-action@master
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
          SONAR_HOST_URL: ${{ secrets.SONAR_HOST_URL }}
```

### Local Development Workflow

```bash
# 1. Start SonarQube container
podman-compose up -d

# 2. Wait for SonarQube to be ready (check http://localhost:9000)

# 3. Run analysis with coverage
npm run sonar:scan:with-coverage

# 4. View results at http://localhost:9000/dashboard?id=prompt-registry

# 5. Export LLM-friendly report
./scripts/export-all-issues.sh
node scripts/generate-llm-report.ts

# 6. Use report with LLM for refactoring guidance
cat sonar-llm-report.json | llm-prompt "Analyze and provide refactoring recommendations"
```

---

## Troubleshooting

### Common Issues

#### Volume Permission Errors (Rootless Podman)

**Problem**: Container cannot write to mounted volumes

**Solution**:
```bash
# Use podman unshare to set ownership
podman unshare chown -R 1000:1000 ~/sonarqube

# Or use --userns keep-id flag
podman run --userns keep-id ...
```

#### TypeScript Analysis Fails

**Problem**: Scanner cannot find TypeScript files

**Solution**:
- Ensure `sonar.sources` matches your tsconfig.json
- Verify TypeScript compiler is available: `tsc --version`
- Check file encoding: UTF-8

#### Memory Issues

**Problem**: Scanner runs out of memory

**Solution**:
```bash
# Increase scanner heap
export SONAR_SCANNER_OPTS="-Xmx2g"

sonar-scanner
```

#### Coverage Not Imported

**Problem**: Coverage reports not showing in SonarQube

**Solution**:
- Ensure coverage reports are generated before scanner runs
- Verify report paths in `sonar.javascript.lcov.reportPaths`
- Check that coverage files exist at specified paths

---

## Best Practices

### Analysis Frequency

- **Full Analysis**: Run before major releases or after significant refactoring
- **Incremental Analysis**: Use for CI/CD on pull requests
- **Preview Mode**: Use during development for quick feedback

### Quality Gates

Configure quality gates in SonarQube UI:
- **Coverage Gate**: > 80% (adjust based on project maturity)
- **New Code Period**: Last 30 days
- **Critical Issues**: Zero new critical/blocker issues allowed
- **Code Smells**: < 5% on new code

### Rule Customization

- Disable rules that conflict with project conventions
- Import external ESLint rules for project-specific checks
- Create custom rule profiles for different project phases (development, release)

### Performance Optimization

- Use `sonar.scm.revision` for SCM integration
- Enable `sonar.cpd.cross_project` for cross-project duplication detection
- Configure exclusions to avoid analyzing generated files

---

## Appendix: Quick Reference

### Essential API Endpoints

```bash
# Issues
GET /api/issues/search
GET /api/issues/{key}

# Metrics
GET /api/measures/component
GET /api/metrics/list

# Hotspots
GET /api/hotspots/search

# Projects
GET /api/projects/search
GET /api/projects/branches

# Quality Gates
GET /api/qualitygates/list
GET /api/qualitygates/project_status
```

### Environment Variables

```bash
SONAR_TOKEN=your-user-token
SONAR_HOST_URL=http://localhost:9000
SONAR_SCANNER_OPTS=-Xmx2g
```

### Useful Commands

```bash
# Scan with coverage
npm run test:coverage && sonar-scanner

# Preview mode (no upload)
sonar-scanner -Dsonar.analysis.mode=preview

# Export all issues
curl -u $TOKEN: "$HOST/api/issues/search?componentKeys=$PROJECT&ps=500" | jq . > issues.json

# Get project metrics
curl -u $TOKEN: "$HOST/api/measures/component?component=$PROJECT&metricKeys=coverage,complexity" | jq .
```

---

## Conclusion

SonarQube is a viable and powerful tool for the Prompt Registry project, offering:
- Comprehensive TypeScript analysis
- Integration with existing ESLint setup
- Monorepo support for workspace structure
- Machine-readable API outputs for LLM consumption
- Local-first deployment with Podman

The setup outlined above provides a complete local development environment with the ability to generate detailed reports that can inform AI-assisted refactoring workflows.
