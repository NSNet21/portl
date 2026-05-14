import * as vscode from 'vscode';
import { openLink, openTarget } from './commands/open';
import { addNewLink } from './commands/add';
import { deleteLinkCommand, deleteLinksDirect, resetLinksCommand } from './commands/delete';
import { editConfig } from './commands/editConfig';
import { editLink } from './commands/editLink';
import { diagnose, showOutputLog } from './commands/diagnose';
import { PortlTreeProvider, PortlTreeItem } from './treeView';

// Double-click detector — track last body click per item id
const DOUBLE_CLICK_MS = 400;
let lastBodyClick: { id: string; time: number } | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const treeProvider = new PortlTreeProvider(context);
  const treeView = vscode.window.createTreeView('portlLinks', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
    dragAndDropController: treeProvider,
    canSelectMany: true,
  });

  const refresh = () => treeProvider.refresh();

  context.subscriptions.push(
    treeView,
    // Persist collapse/expand state per group (root level only — links ไม่มี state)
    treeView.onDidCollapseElement(e => {
      if (e.element.groupName) void treeProvider.setCollapsed(e.element.groupName, true);
    }),
    treeView.onDidExpandElement(e => {
      if (e.element.groupName) void treeProvider.setCollapsed(e.element.groupName, false);
    }),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('portl.links')) refresh();
    }),
    vscode.commands.registerCommand('portl.open',         openLink),
    vscode.commands.registerCommand('portl.add',          () => addNewLink(context, refresh)),
    vscode.commands.registerCommand('portl.delete',       async () => { await deleteLinkCommand(); refresh(); }),
    vscode.commands.registerCommand('portl.reset',        async () => { await resetLinksCommand(); refresh(); }),
    vscode.commands.registerCommand('portl.editConfig',   editConfig),
    vscode.commands.registerCommand('portl.refreshTree',  refresh),
    // Inline icon $(link-external) click → always open (single click)
    vscode.commands.registerCommand('portl.openFromTree', (item: PortlTreeItem) => {
      if (!item.link) return;
      openTarget(item.link.target);
    }),
    // Body click → select first, open only on double-click within 400ms (เพื่อ multi-select)
    vscode.commands.registerCommand('portl.openFromTreeClick', (item: PortlTreeItem) => {
      if (!item.link) return;
      const now = Date.now();
      const id = item.id ?? `${item.link.group ?? ''}/${item.link.label}`;
      if (lastBodyClick && lastBodyClick.id === id && now - lastBodyClick.time < DOUBLE_CLICK_MS) {
        lastBodyClick = undefined;
        openTarget(item.link.target);
      } else {
        lastBodyClick = { id, time: now };
      }
    }),
    // Inline icon $(edit) → open settings.json + jump cursor to that link's position
    vscode.commands.registerCommand('portl.editLink', (item: PortlTreeItem) => {
      if (!item.link) return;
      void editLink(item.link);
    }),
    vscode.commands.registerCommand('portl.deleteFromTree', async (item: PortlTreeItem, all?: PortlTreeItem[]) => {
      const targets = (all ?? [item]).filter(i => i?.link).map(i => i.link!);
      await deleteLinksDirect(targets);
      refresh();
    }),
    // ── Dev tools ──────────────────────────────────────────────────
    vscode.commands.registerCommand('portl.showOutputLog', showOutputLog),
    vscode.commands.registerCommand('portl.diagnose', async () => {
      await diagnose(context, treeProvider);
      refresh();
    }),
  );
}

export function deactivate(): void {}
