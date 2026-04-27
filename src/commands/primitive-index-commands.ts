/**
 * Command palette entries for the Primitive Index feature.
 *
 * Exposes:
 *   - promptregistry.primitiveIndex.build
 *   - promptregistry.primitiveIndex.search
 *   - promptregistry.primitiveIndex.shortlist.new
 *   - promptregistry.primitiveIndex.shortlist.add
 *   - promptregistry.primitiveIndex.export
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import {
  exportShortlistAsProfile,
  type Primitive,
  type SearchHit,
} from '@prompt-registry/collection-scripts';
import { PrimitiveIndexManager } from '../services/primitive-index-manager';
import { Logger } from '../utils/logger';

export class PrimitiveIndexCommands {
  private readonly logger = Logger.getInstance();

  public constructor(private readonly manager: PrimitiveIndexManager) {}

  public register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand('promptregistry.primitiveIndex.build', () => this.build()),
      vscode.commands.registerCommand('promptregistry.primitiveIndex.harvestHub', () => this.harvestHub()),
      vscode.commands.registerCommand('promptregistry.primitiveIndex.search', () => this.search()),
      vscode.commands.registerCommand('promptregistry.primitiveIndex.shortlist.new', () => this.newShortlist()),
      vscode.commands.registerCommand('promptregistry.primitiveIndex.shortlist.add', (arg?: unknown) => this.addToShortlist(arg)),
      vscode.commands.registerCommand('promptregistry.primitiveIndex.export', () => this.exportProfile()),
    );
  }

  private async harvestHub(): Promise<void> {
    const input = await vscode.window.showInputBox({
      prompt: 'Hub repo (owner/repo) to harvest',
      placeHolder: 'Amadeus-xDLC/genai.prompt-registry-config',
    });
    if (!input) {
      return;
    }
    const [hubOwner, hubRepo] = input.split('/');
    if (!hubOwner || !hubRepo) {
      void vscode.window.showErrorMessage(`Invalid hub repo: ${input} (expected "owner/repo").`);
      return;
    }
    // Optional: offer the user to also harvest github/awesome-copilot
    // plugins/ as an awesome-copilot-plugin source. This exercises the
    // new PR #245 source type without requiring the hub to advertise it.
    const injectUpstream = await vscode.window.showQuickPick(
      ['No', 'Yes — also harvest github/awesome-copilot plugins/'],
      { placeHolder: 'Also harvest github/awesome-copilot plugins/ as an extra source?' },
    );
    const extraSources = injectUpstream?.startsWith('Yes')
      ? [{
        id: 'upstream-awesome-copilot',
        name: 'github/awesome-copilot (plugins)',
        type: 'awesome-copilot-plugin' as const,
        url: 'https://github.com/github/awesome-copilot',
        owner: 'github',
        repo: 'awesome-copilot',
        branch: 'main',
        pluginsPath: 'plugins',
        rawConfig: {},
      }]
      : undefined;
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Harvesting ${input}…`, cancellable: false },
      async (progress) => {
        try {
          const idx = await this.manager.buildFromHub({
            hubOwner, hubRepo,
            extraSources,
            onEvent: (ev) => progress.report({ message: JSON.stringify(ev).slice(0, 120) }),
          });
          const s = idx.stats();
          void vscode.window.showInformationMessage(
            `Harvested ${input}: ${s.primitives} primitives across ${s.bundles} bundles.`,
          );
        } catch (err) {
          this.logger.error('hub harvest failed', err as Error);
          void vscode.window.showErrorMessage(`Hub harvest failed: ${(err as Error).message}`);
        }
      },
    );
  }

  private async build(): Promise<void> {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Building primitive index…' },
      async () => {
        const idx = await this.manager.buildFromInstalled();
        const s = idx.stats();
        void vscode.window.showInformationMessage(
          `Primitive index built: ${s.primitives} primitives across ${s.bundles} bundles.`,
        );
      },
    );
  }

  private async ensureIndex(): Promise<ReturnType<PrimitiveIndexManager['getIndex']>> {
    let idx = this.manager.getIndex();
    if (!idx) {
      const pick = await vscode.window.showInformationMessage(
        'No primitive index is built yet. Build one now?',
        'Build',
        'Cancel',
      );
      if (pick === 'Build') {
        idx = await this.manager.buildFromInstalled();
      }
    }
    return idx;
  }

  private async search(): Promise<void> {
    const idx = await this.ensureIndex();
    if (!idx) {
      return;
    }
    const query = await vscode.window.showInputBox({
      prompt: 'Search agentic primitives (prompts, instructions, chat modes, agents, skills, MCP)',
      placeHolder: 'terraform module, code review, rust mentor…',
    });
    if (!query) {
      return;
    }
    const result = idx.search({ q: query, limit: 20 });
    if (result.hits.length === 0) {
      void vscode.window.showInformationMessage('No primitives match your query.');
      return;
    }
    const picks = result.hits.map<vscode.QuickPickItem & { hit: SearchHit }>((h) => ({
      label: `$(symbol-${iconFor(h.primitive.kind)}) ${h.primitive.title}`,
      description: `${h.primitive.kind}  ·  ${h.primitive.bundle.bundleId}  ·  score ${h.score.toFixed(2)}`,
      detail: h.primitive.description || h.primitive.bodyPreview,
      hit: h,
    }));
    const choice = await vscode.window.showQuickPick(picks, {
      matchOnDescription: true,
      matchOnDetail: true,
      placeHolder: `${result.total} matches — pick one to add to a shortlist or reveal`,
    });
    if (!choice) {
      return;
    }
    await this.actionOnPrimitive(choice.hit.primitive);
  }

  private async actionOnPrimitive(p: Primitive): Promise<void> {
    const action = await vscode.window.showQuickPick(
      [
        { label: 'Add to shortlist', value: 'add' },
        { label: 'Copy primitive id', value: 'copy' },
      ],
      { placeHolder: p.title },
    );
    if (!action) {
      return;
    }
    if (action.value === 'copy') {
      await vscode.env.clipboard.writeText(p.id);
      void vscode.window.showInformationMessage(`Copied ${p.id}`);
      return;
    }
    await this.addToShortlist(p.id);
  }

  private async newShortlist(): Promise<string | undefined> {
    const idx = await this.ensureIndex();
    if (!idx) {
      return undefined;
    }
    const name = await vscode.window.showInputBox({ prompt: 'Shortlist name' });
    if (!name) {
      return undefined;
    }
    const description = await vscode.window.showInputBox({
      prompt: 'Optional description',
      placeHolder: 'What is this shortlist about?',
    });
    const sl = idx.createShortlist(name, description);
    this.manager.persist();
    void vscode.window.showInformationMessage(`Created shortlist "${sl.name}" (${sl.id}).`);
    return sl.id;
  }

  private async addToShortlist(primitiveIdOrUnknown?: unknown): Promise<void> {
    const idx = await this.ensureIndex();
    if (!idx) {
      return;
    }
    const pid = typeof primitiveIdOrUnknown === 'string' ? primitiveIdOrUnknown : undefined;
    const primitiveId = pid ?? await vscode.window.showInputBox({ prompt: 'Primitive id' });
    if (!primitiveId) {
      return;
    }
    const shortlists = idx.listShortlists();
    const choices: Array<vscode.QuickPickItem & { id?: string }> = [
      { label: '＋ New shortlist…' },
      ...shortlists.map((sl) => ({
        label: sl.name,
        description: `${sl.primitiveIds.length} items`,
        id: sl.id,
      })),
    ];
    const pick = await vscode.window.showQuickPick(choices, { placeHolder: 'Select shortlist' });
    if (!pick) {
      return;
    }
    let targetId = pick.id;
    if (!targetId) {
      targetId = await this.newShortlist();
    }
    if (!targetId) {
      return;
    }
    try {
      idx.addToShortlist(targetId, primitiveId);
      this.manager.persist();
      void vscode.window.showInformationMessage(`Added to shortlist.`);
    } catch (err) {
      void vscode.window.showErrorMessage(`Failed: ${(err as Error).message}`);
    }
  }

  private async exportProfile(): Promise<void> {
    const idx = await this.ensureIndex();
    if (!idx) {
      return;
    }
    const shortlists = idx.listShortlists();
    if (shortlists.length === 0) {
      void vscode.window.showInformationMessage('No shortlists to export yet.');
      return;
    }
    const pick = await vscode.window.showQuickPick(
      shortlists.map((sl) => ({
        label: sl.name,
        description: `${sl.primitiveIds.length} items`,
        id: sl.id,
      })),
      { placeHolder: 'Choose a shortlist to export' },
    );
    if (!pick) {
      return;
    }
    const sl = idx.getShortlist(pick.id);
    if (!sl) {
      return;
    }
    const profileId = await vscode.window.showInputBox({
      prompt: 'Profile id (lowercase, alphanumeric + hyphens)',
      value: sl.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-'),
    });
    if (!profileId) {
      return;
    }
    const outUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? '', `${profileId}.profile.yml`)),
      filters: { YAML: ['yml', 'yaml'] },
    });
    if (!outUri) {
      return;
    }
    const result = exportShortlistAsProfile(idx, sl, {
      profileId,
      suggestCollection: true,
    });
    const outPath = outUri.fsPath;
    fs.writeFileSync(outPath, yaml.dump(result.profile), 'utf8');
    if (result.suggestedCollection) {
      const collectionPath = path.join(
        path.dirname(outPath),
        `${result.suggestedCollection.id}.collection.yml`,
      );
      fs.writeFileSync(collectionPath, yaml.dump(result.suggestedCollection), 'utf8');
    }
    void vscode.window.showInformationMessage(
      `Exported profile to ${outPath}${result.warnings.length > 0 ? ` (${result.warnings.length} warnings)` : ''}`,
    );
    if (result.warnings.length > 0) {
      this.logger.warn(`Export warnings: ${result.warnings.join('; ')}`);
    }
  }
}

function iconFor(kind: string): string {
  switch (kind) {
    case 'prompt': return 'string';
    case 'instruction': return 'note';
    case 'chat-mode': return 'comment-discussion';
    case 'agent': return 'robot';
    case 'skill': return 'tools';
    case 'mcp-server': return 'server';
    default: return 'file';
  }
}
