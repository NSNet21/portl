import * as vscode from 'vscode';
import { getAllLinks, deleteLinks, resetLinks } from '../linkStore';
import { FlatLink } from '../types';

export async function deleteLinkCommand(): Promise<void> {
  const links = getAllLinks();
  if (links.length === 0) {
    vscode.window.showInformationMessage('No links to delete.');
    return;
  }

  const items = links.map(link => ({
    label:       link.label,
    description: link.group ? `[${link.group}]` : '',
    detail:      link.target,
    link,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder:        'Select a link to delete',
    matchOnDescription: true,
    matchOnDetail:      true,
  });
  if (!picked) return;

  const confirm = await vscode.window.showWarningMessage(
    `Delete "${picked.label}"?`, { modal: true }, 'Delete',
  );
  if (confirm !== 'Delete') return;

  await deleteLinks([{ label: picked.link.label, group: picked.link.group }]);
  vscode.window.showInformationMessage(`Portl: "${picked.label}" deleted.`);
}

export async function deleteLinksDirect(links: FlatLink[]): Promise<void> {
  if (links.length === 0) return;
  const label   = links.length === 1 ? `"${links[0].label}"` : `${links.length} links`;
  const confirm = await vscode.window.showWarningMessage(
    `Delete ${label}?`, { modal: true }, 'Delete',
  );
  if (confirm !== 'Delete') return;
  await deleteLinks(links.map(l => ({ label: l.label, group: l.group })));
  vscode.window.showInformationMessage(`Portl: deleted ${label}.`);
}

export async function resetLinksCommand(): Promise<void> {
  const count   = getAllLinks().length;
  const noun    = count === 1 ? '1 link' : `${count} links`;
  const confirm = await vscode.window.showWarningMessage(
    `Reset all links? This will permanently delete ${noun} and cannot be undone.`,
    { modal: true },
    'Reset',
  );
  if (confirm !== 'Reset') return;
  await resetLinks();
  vscode.window.showInformationMessage('Portl: all links cleared.');
}
