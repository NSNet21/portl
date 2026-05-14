import * as vscode from 'vscode';
import { FlatLink } from '../types';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * เปิด user settings.json + กระโดด cursor ไปที่ตำแหน่งของ link/group ที่กำหนด
 *
 * แนวทาง: text-based search (ไม่ต้อง parse jsonc) — ใช้ลำดับ:
 *   "portl.links" → "GroupName" → "nestedItems" → "Label"
 * เริ่ม search จาก offset ของ match ก่อนหน้าเสมอ เพื่อจำกัด scope ของแต่ละขั้น
 */
export async function editLink(link: FlatLink): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.openSettingsJson');

  // รอให้ editor จริง ๆ active (executeCommand resolved ก่อน UI อัปเดตได้)
  await new Promise(r => setTimeout(r, 80));

  const editor = vscode.window.activeTextEditor;
  if (!editor || !editor.document.fileName.endsWith('settings.json')) {
    vscode.window.showWarningMessage('Could not open settings.json — please try again.');
    return;
  }

  const text = editor.document.getText();

  // 1) หา "portl.links"
  const portlMatch = /"portl\.links"\s*:\s*\{/.exec(text);
  if (!portlMatch) {
    vscode.window.showInformationMessage('portl.links not yet in settings.json — add via "Portl: Add" first.');
    return;
  }

  let searchFrom = portlMatch.index + portlMatch[0].length;

  // 2) ถ้าอยู่ใน group → หา group แล้วเลื่อนเข้า nestedItems
  if (link.group) {
    const groupRegex = new RegExp(`"${escapeRegex(link.group)}"\\s*:\\s*\\{`, 'g');
    groupRegex.lastIndex = searchFrom;
    const groupMatch = groupRegex.exec(text);
    if (!groupMatch) {
      vscode.window.showWarningMessage(`Group "${link.group}" not found in settings.json.`);
      return;
    }

    const nestedRegex = /"nestedItems"\s*:\s*\{/g;
    nestedRegex.lastIndex = groupMatch.index + groupMatch[0].length;
    const nestedMatch = nestedRegex.exec(text);
    if (!nestedMatch) {
      vscode.window.showWarningMessage(`"nestedItems" not found in group "${link.group}".`);
      return;
    }
    searchFrom = nestedMatch.index + nestedMatch[0].length;
  }

  // 3) หา label key
  const labelRegex = new RegExp(`"${escapeRegex(link.label)}"\\s*:`, 'g');
  labelRegex.lastIndex = searchFrom;
  const labelMatch = labelRegex.exec(text);
  if (!labelMatch) {
    vscode.window.showWarningMessage(`Label "${link.label}" not found in settings.json.`);
    return;
  }

  // กระโดด cursor + reveal — วาง cursor ภายใน "" ของ label (หลัง opening quote)
  // +1 เพื่อข้ามเครื่องหมาย " เปิด → cursor อยู่ก่อนตัวอักษรแรกของ label พร้อมพิมพ์/แก้ได้เลย
  const position = editor.document.positionAt(labelMatch.index + 1);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(
    new vscode.Range(position, position),
    vscode.TextEditorRevealType.InCenter,
  );
}
