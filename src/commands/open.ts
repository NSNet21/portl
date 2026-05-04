import * as vscode from 'vscode';
import { getAllLinks } from '../linkStore';

export async function openLink(): Promise<void> {
  const links = getAllLinks();

  if (links.length === 0) {
    vscode.window.showInformationMessage('No links saved. Use "Portl: Add New Link" to add one.');
    return;
  }

  const items = links.map(link => ({
    label: `$(link) ${link.label}`,
    description: link.group ? `[${link.group}]` : '',
    detail: link.description,
    link,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a link to open',
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (!picked) return;

  await openTarget(picked.link.target);
}

export async function openTarget(target: string): Promise<void> {
  const openInBrowser = vscode.workspace.getConfiguration('portl').get<boolean>('openInBrowser', true);
  try {
    if (openInBrowser) {
      await vscode.env.openExternal(vscode.Uri.parse(target, true));
    } else {
      await vscode.commands.executeCommand('simpleBrowser.show', target);
    }
  } catch {
    vscode.window.showErrorMessage(`Portl: Cannot open "${target}" — invalid URI.`);
  }
}
