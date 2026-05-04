import * as vscode from 'vscode';
import { getAllLinks } from './linkStore';
import { FlatLink } from './types';

export class PortlTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly link?: FlatLink,
    public readonly groupName?: string,
  ) {
    super(label, collapsibleState);

    if (link) {
      this.contextValue = 'link';
      this.tooltip      = link.description ?? link.target;
      this.description  = link.description ?? link.target;
      this.iconPath     = new vscode.ThemeIcon('link');
      this.command      = {
        command:   'portl.openFromTree',
        title:     'Open Link',
        arguments: [this],
      };
    } else {
      this.contextValue = 'group';
      this.iconPath     = new vscode.ThemeIcon('folder');
    }
  }
}

export class PortlTreeProvider implements vscode.TreeDataProvider<PortlTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<PortlTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: PortlTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: PortlTreeItem): PortlTreeItem[] {
    const links = getAllLinks();

    if (!element) {
      const groups  = [...new Set(links.filter(l => l.group).map(l => l.group!))];
      const result: PortlTreeItem[] = [];
      for (const group of groups) {
        result.push(new PortlTreeItem(group, vscode.TreeItemCollapsibleState.Expanded, undefined, group));
      }
      for (const link of links.filter(l => !l.group)) {
        result.push(new PortlTreeItem(link.label, vscode.TreeItemCollapsibleState.None, link));
      }
      return result;
    }

    if (element.groupName) {
      return links
        .filter(l => l.group === element.groupName)
        .map(l => new PortlTreeItem(l.label, vscode.TreeItemCollapsibleState.None, l));
    }

    return [];
  }
}
