import * as vscode from 'vscode';
import { showAddLinkPanel } from '../webview/addLinkPanel';

export function addNewLink(context: vscode.ExtensionContext, onAdded?: () => void): void {
  showAddLinkPanel(context, onAdded);
}
