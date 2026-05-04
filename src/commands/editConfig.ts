import * as vscode from 'vscode';

export async function editConfig(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.openSettings', 'portl.links');
}
