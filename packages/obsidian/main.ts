import { ItemView, Modal, Notice, Plugin, PluginSettingTab, Setting, WorkspaceLeaf } from 'obsidian';
import {
  opsRailLines,
  readSnapshotFromPath,
  resolveSnapshotPath,
  type ControlPlaneSnapshot
} from './control-plane-utils';

const VIEW_GRAPH = 'clawvault-graph-view';
const VIEW_WORKSTREAMS = 'clawvault-workstreams-view';
const VIEW_OPS = 'clawvault-ops-view';

interface ControlPlaneSettings {
  snapshotPath: string;
  autoRefreshMs: number;
  openViewsOnStartup: boolean;
}

export const DEFAULT_SETTINGS: ControlPlaneSettings = {
  snapshotPath: '.clawvault/control-plane/snapshot.json',
  autoRefreshMs: 30000,
  openViewsOnStartup: true
};

function listToHtml(items: string[]): string {
  if (items.length === 0) {
    return '<p class="clawvault-empty">No items available.</p>';
  }
  return `<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`;
}

abstract class BaseControlPlaneView extends ItemView {
  protected plugin: ClawVaultControlPlanePlugin;
  protected contentEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: ClawVaultControlPlanePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  onOpen(): void {
    this.containerEl.empty();
    this.contentEl = this.containerEl.createDiv({ cls: 'clawvault-view' });
    this.render();
  }

  async refresh(): Promise<void> {
    this.render();
  }

  protected readSnapshot(): ControlPlaneSnapshot | null {
    return this.plugin.readSnapshot();
  }

  protected abstract render(): void;
}

class GraphPanelView extends BaseControlPlaneView {
  getViewType(): string {
    return VIEW_GRAPH;
  }

  getDisplayText(): string {
    return 'ClawVault Graph';
  }

  protected render(): void {
    this.contentEl.empty();
    const snapshot = this.readSnapshot();
    this.contentEl.createEl('h2', { text: 'Graph Panel' });
    if (!snapshot) {
      this.contentEl.createEl('p', { text: 'Snapshot unavailable. Run `clawvault control-plane snapshot`.' });
      return;
    }

    this.contentEl.createEl('p', { text: `Generated: ${snapshot.generatedAt}` });
    this.contentEl.createEl('p', { text: `Nodes: ${snapshot.graph.nodeCount} • Edges: ${snapshot.graph.edgeCount}` });

    const topTypes = snapshot.graph.topNodeTypes.map((entry) => `${entry.type}: ${entry.count}`);
    this.contentEl.createDiv({ cls: 'clawvault-list', text: 'Top node types:' });
    this.contentEl.createDiv({ cls: 'clawvault-list-html' }).innerHTML = listToHtml(topTypes);
  }
}

class WorkstreamsView extends BaseControlPlaneView {
  getViewType(): string {
    return VIEW_WORKSTREAMS;
  }

  getDisplayText(): string {
    return 'ClawVault Workstreams';
  }

  protected render(): void {
    this.contentEl.empty();
    const snapshot = this.readSnapshot();
    this.contentEl.createEl('h2', { text: 'Workstreams Board' });
    if (!snapshot) {
      this.contentEl.createEl('p', { text: 'Snapshot unavailable. Run `clawvault control-plane snapshot`.' });
      return;
    }

    if (snapshot.workstreams.length === 0) {
      this.contentEl.createEl('p', { text: 'No workstreams detected.' });
      return;
    }

    for (const lane of snapshot.workstreams) {
      const laneEl = this.contentEl.createDiv({ cls: 'clawvault-lane' });
      laneEl.createEl('h3', { text: lane.workspace });
      laneEl.createEl('p', {
        text: `Projects: ${lane.projectCount} • Runs: ${lane.activeRuns} • Triggers: ${lane.activeTriggers}`
      });
      laneEl.createEl('p', {
        text: `Tasks → open ${lane.taskCounts.open}, in-progress ${lane.taskCounts.inProgress}, blocked ${lane.taskCounts.blocked}, done ${lane.taskCounts.done}`
      });
    }
  }
}

class OpsRailView extends BaseControlPlaneView {
  getViewType(): string {
    return VIEW_OPS;
  }

  getDisplayText(): string {
    return 'ClawVault Ops Rail';
  }

  protected render(): void {
    this.contentEl.empty();
    const snapshot = this.readSnapshot();
    this.contentEl.createEl('h2', { text: 'Ops Rail' });
    if (!snapshot) {
      this.contentEl.createEl('p', { text: 'Snapshot unavailable. Run `clawvault control-plane snapshot`.' });
      return;
    }

    const entries = opsRailLines(snapshot, 25);
    this.contentEl.createDiv({ cls: 'clawvault-list-html' }).innerHTML = listToHtml(entries);
  }
}

class SetupWizardModal extends Modal {
  private plugin: ClawVaultControlPlanePlugin;
  private draft: ControlPlaneSettings;

  constructor(plugin: ClawVaultControlPlanePlugin) {
    super(plugin.app);
    this.plugin = plugin;
    this.draft = { ...plugin.settings };
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'ClawVault Setup Wizard' });
    contentEl.createEl('p', {
      text: 'Configure how this plugin discovers and refreshes control-plane snapshots.'
    });

    new Setting(contentEl)
      .setName('Snapshot path')
      .setDesc('Relative to vault root unless absolute.')
      .addText((text) =>
        text
          .setValue(this.draft.snapshotPath)
          .onChange((value) => {
            this.draft.snapshotPath = value.trim() || DEFAULT_SETTINGS.snapshotPath;
          })
      );

    new Setting(contentEl)
      .setName('Auto-refresh interval (ms)')
      .setDesc('How often views refresh from snapshot file.')
      .addText((text) =>
        text
          .setValue(String(this.draft.autoRefreshMs))
          .onChange((value) => {
            const parsed = Number.parseInt(value, 10);
            if (Number.isFinite(parsed) && parsed >= 1000) {
              this.draft.autoRefreshMs = parsed;
            }
          })
      );

    new Setting(contentEl)
      .setName('Open views on startup')
      .setDesc('Open graph/workstreams/ops rail when workspace is ready.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.draft.openViewsOnStartup)
          .onChange((value) => {
            this.draft.openViewsOnStartup = value;
          })
      );

    new Setting(contentEl)
      .addButton((button) =>
        button
          .setButtonText('Save')
          .setCta()
          .onClick(async () => {
            await this.plugin.updateSettings(this.draft);
            new Notice('ClawVault setup saved');
            this.close();
          })
      );
  }
}

class ControlPlaneSettingTab extends PluginSettingTab {
  plugin: ClawVaultControlPlanePlugin;

  constructor(plugin: ClawVaultControlPlanePlugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'ClawVault Control Plane' });

    new Setting(containerEl)
      .setName('Run setup wizard')
      .setDesc('Open guided setup for snapshot + refresh options.')
      .addButton((button) =>
        button
          .setButtonText('Open wizard')
          .onClick(() => {
            new SetupWizardModal(this.plugin).open();
          })
      );
  }
}

export default class ClawVaultControlPlanePlugin extends Plugin {
  settings: ControlPlaneSettings = DEFAULT_SETTINGS;
  private refreshHandle: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_GRAPH, (leaf) => new GraphPanelView(leaf, this));
    this.registerView(VIEW_WORKSTREAMS, (leaf) => new WorkstreamsView(leaf, this));
    this.registerView(VIEW_OPS, (leaf) => new OpsRailView(leaf, this));

    this.addRibbonIcon('layout-grid', 'Open ClawVault Control Plane', () => {
      this.openAllViews();
    });

    this.addCommand({
      id: 'clawvault-open-control-plane',
      name: 'Open control plane views',
      callback: () => this.openAllViews()
    });

    this.addCommand({
      id: 'clawvault-refresh-control-plane',
      name: 'Refresh control plane views',
      callback: () => this.refreshViews()
    });

    this.addCommand({
      id: 'clawvault-setup-wizard',
      name: 'Run ClawVault setup wizard',
      callback: () => new SetupWizardModal(this).open()
    });

    this.addSettingTab(new ControlPlaneSettingTab(this));

    this.registerEvent(
      this.app.workspace.on('layout-ready', () => {
        if (this.settings.openViewsOnStartup) {
          this.openAllViews();
        }
      })
    );

    this.startRefreshLoop();
  }

  onunload(): void {
    if (this.refreshHandle !== null) {
      window.clearInterval(this.refreshHandle);
      this.refreshHandle = null;
    }
  }

  async loadSettings(): Promise<void> {
    const loaded = await this.loadData();
    this.settings = { ...DEFAULT_SETTINGS, ...(loaded || {}) };
  }

  async updateSettings(next: ControlPlaneSettings): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...next };
    await this.saveData(this.settings);
    this.startRefreshLoop();
    await this.refreshViews();
  }

  private getSnapshotPath(): string {
    const adapter = this.app.vault.adapter as { basePath?: string };
    const basePath = adapter.basePath ?? '';
    return resolveSnapshotPath(this.settings.snapshotPath, basePath);
  }

  readSnapshot(): ControlPlaneSnapshot | null {
    return readSnapshotFromPath(this.getSnapshotPath());
  }

  private async ensureView(viewType: string): Promise<void> {
    const { workspace } = this.app;
    const existingLeaf = workspace.getLeavesOfType(viewType)[0];
    if (existingLeaf) {
      workspace.revealLeaf(existingLeaf);
      return;
    }
    const leaf = workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: viewType, active: true });
    workspace.revealLeaf(leaf);
  }

  async openAllViews(): Promise<void> {
    await this.ensureView(VIEW_GRAPH);
    await this.ensureView(VIEW_WORKSTREAMS);
    await this.ensureView(VIEW_OPS);
    await this.refreshViews();
  }

  async refreshViews(): Promise<void> {
    const viewTypes = [VIEW_GRAPH, VIEW_WORKSTREAMS, VIEW_OPS];
    for (const viewType of viewTypes) {
      for (const leaf of this.app.workspace.getLeavesOfType(viewType)) {
        const view = leaf.view as unknown as BaseControlPlaneView;
        if (view && typeof view.refresh === 'function') {
          await view.refresh();
        }
      }
    }
  }

  private startRefreshLoop(): void {
    if (this.refreshHandle !== null) {
      window.clearInterval(this.refreshHandle);
      this.refreshHandle = null;
    }
    this.refreshHandle = window.setInterval(() => {
      void this.refreshViews();
    }, this.settings.autoRefreshMs);
    this.registerInterval(this.refreshHandle);
  }
}
