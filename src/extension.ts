import * as vscode from 'vscode';
import { openLink, openTarget } from './commands/open';
import { addNewLink } from './commands/add';
import { deleteLinkCommand, deleteLinksDirect, resetLinksCommand } from './commands/delete';
import { editConfig } from './commands/editConfig';
import { PortlTreeProvider, PortlTreeItem } from './treeView';

export function activate(context: vscode.ExtensionContext): void {
  const treeProvider = new PortlTreeProvider();
  const treeView = vscode.window.createTreeView('portlLinks', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  const refresh = () => treeProvider.refresh();

  context.subscriptions.push(
    treeView,
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('portl.links')) refresh();
    }),
    vscode.commands.registerCommand('portl.open',         openLink),
    vscode.commands.registerCommand('portl.add',          () => addNewLink(context, refresh)),
    vscode.commands.registerCommand('portl.delete',       async () => { await deleteLinkCommand(); refresh(); }),
    vscode.commands.registerCommand('portl.reset',        async () => { await resetLinksCommand(); refresh(); }),
    vscode.commands.registerCommand('portl.editConfig',   editConfig),
    vscode.commands.registerCommand('portl.refreshTree',  refresh),
    vscode.commands.registerCommand('portl.openFromTree', (item: PortlTreeItem) => {
      if (!item.link) return;
      openTarget(item.link.target);
    }),
    vscode.commands.registerCommand('portl.deleteFromTree', async (item: PortlTreeItem, all?: PortlTreeItem[]) => {
      const targets = (all ?? [item]).filter(i => i?.link).map(i => i.link!);
      await deleteLinksDirect(targets);
      refresh();
    }),
  );
}

export function deactivate(): void {}
