import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { addLink, getAllLinks } from '../linkStore';

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export function showAddLinkPanel(context: vscode.ExtensionContext, onAdded?: () => void): void {
  const panel = vscode.window.createWebviewPanel(
    'portlAddLink',
    'Portl: Add Link',
    vscode.ViewColumn.One,
    { enableScripts: true },
  );

  const allLinks       = getAllLinks();
  const existingGroups = [...new Set(allLinks.filter(l => l.group).map(l => l.group!))];
  const existingLabels = allLinks.map(l => l.label);
  const scriptPath     = path.join(context.extensionPath, 'out', 'webview', 'addLinkPanelScript.js');
  const scriptContent  = fs.readFileSync(scriptPath, 'utf8');
  const nonce          = getNonce();

  panel.webview.html = getHtml(existingGroups, existingLabels, scriptContent, nonce);

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.command !== 'add') return;
    if (!msg.label || !msg.target) return;

    await addLink({
      label:       msg.label,
      target:      msg.target,
      description: msg.description || undefined,
      group:       msg.group || undefined,
    });

    vscode.window.showInformationMessage(`Portl: "${msg.label}" saved.`);
    onAdded?.();
    panel.dispose();
  });
}

function getHtml(
  groups: string[],
  existingLabels: string[],
  scriptContent: string,
  nonce: string,
): string {
  const groupsJson         = JSON.stringify(groups);
  const existingLabelsJson = JSON.stringify(existingLabels);

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      padding: 28px 32px;
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      background: var(--vscode-editor-background);
      max-width: 540px;
    }

    h1 {
      font-size: 1em;
      font-weight: 600;
      letter-spacing: 0.02em;
      margin-bottom: 24px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--vscode-widget-border, #ffffff18);
    }

    .field { margin-bottom: 14px; }

    label {
      display: block;
      font-size: 0.78em;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 5px;
    }

    input, textarea {
      width: 100%;
      padding: 7px 10px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 3px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      outline: none;
      transition: border-color 0.1s;
    }

    input:focus, textarea:focus { border-color: var(--vscode-focusBorder); }
    input::placeholder, textarea::placeholder { color: var(--vscode-input-placeholderForeground); }

    textarea { resize: vertical; min-height: 80px; }

    .hint {
      font-size: 0.78em;
      color: var(--vscode-descriptionForeground);
      margin-top: 4px;
      opacity: 0.8;
    }

    .autocomplete { position: relative; }

    .suggestions {
      display: none;
      position: absolute;
      top: calc(100% + 2px);
      left: 0; right: 0;
      background: var(--vscode-dropdown-background, var(--vscode-input-background));
      border: 1px solid var(--vscode-focusBorder);
      border-radius: 3px;
      list-style: none;
      max-height: 140px;
      overflow-y: auto;
      z-index: 100;
    }

    .suggestions.open { display: block; }

    .suggestions li {
      padding: 6px 10px;
      cursor: pointer;
      font-size: var(--vscode-font-size);
    }

    .suggestions li:hover,
    .suggestions li.active {
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }

    .label-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 5px;
    }
    .label-row label { margin-bottom: 0; }

    .lorem-controls {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .lorem-controls input[type="number"] {
      width: 52px;
      padding: 3px 6px;
      font-size: 0.78em;
      text-align: center;
    }
    .lorem-controls button {
      width: auto;
      padding: 3px 9px;
      font-size: 0.78em;
      font-weight: 400;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .lorem-controls button:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .actions { margin-top: 20px; }

    button {
      width: 100%;
      padding: 8px 16px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 3px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      font-weight: 500;
      cursor: pointer;
      transition: background 0.1s;
    }

    button:hover { background: var(--vscode-button-hoverBackground); }

    .shortcut {
      text-align: center;
      font-size: 0.75em;
      color: var(--vscode-descriptionForeground);
      margin-top: 8px;
      opacity: 0.6;
    }
  </style>
</head>
<body>
  <h1>Add New Link</h1>

  <div class="field">
    <label>Label <span style="color:var(--vscode-errorForeground)">*</span></label>
    <input id="label" type="text" placeholder="e.g. Figma — Design System" autofocus />
    <p class="hint" id="label-warn" style="display:none;color:var(--vscode-editorWarning-foreground)">
      &#9888; Label already exists — saving will overwrite it.
    </p>
  </div>

  <div class="field">
    <label>Target <span style="color:var(--vscode-errorForeground)">*</span></label>
    <input id="target" type="text" placeholder="https://, file:///, onenote:, vscode://" />
    <p class="hint">Accepts any URI — web, file, or app scheme</p>
  </div>

  <div class="field">
    <label>Group</label>
    <div class="autocomplete">
      <input id="group" type="text" placeholder="Work, Local…" autocomplete="off" />
      <ul class="suggestions" id="group-suggestions"></ul>
    </div>
  </div>

  <div class="field">
    <div class="label-row">
      <label>Description</label>
      <div class="lorem-controls">
        <input type="number" id="lorem-count" value="30" min="1" max="200" title="Word count" />
        <button type="button" id="btn-lorem">Insert Lorem</button>
      </div>
    </div>
    <textarea id="description" placeholder="Optional detail — shown as sub-text in picker"></textarea>
  </div>

  <div class="actions">
    <button id="btn-add">Add Link</button>
    <p class="shortcut">Ctrl+Enter to submit</p>
  </div>

  <script nonce="${nonce}">
    const GROUPS          = ${groupsJson};
    const EXISTING_LABELS = ${existingLabelsJson};
    ${scriptContent}
  </script>
</body>
</html>`;
}
