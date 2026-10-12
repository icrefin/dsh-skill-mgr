/** 删除与回收站：行内删除的确认、已删除技能列表、恢复与清空。 */
export const zhTrash = {
  'delete.confirmTitle': '移入回收站？',
  'delete.confirmText': '确定把「{name}」移入回收站吗？可随时恢复。',
  'delete.confirm': '移入回收站',
  'delete.done': '已移入回收站：{name}',
  'trash.heading': '已删除的技能（可恢复）',
  'trash.restore': '恢复',
  'trash.restored': '已恢复 {name}',
  'trash.clear': '清空回收站',
  'trash.clearConfirmTitle': '清空回收站？',
  'trash.clearConfirmText': '回收站里的技能会被永久删除，无法恢复。此操作不可撤销。',
  'trash.clearConfirm': '永久删除',
  'trash.cleared': '回收站已清空',
} as const

export const enTrash: Record<keyof typeof zhTrash, string> = {
  'delete.confirmTitle': 'Move to trash?',
  'delete.confirmText': 'Move "{name}" to trash? It can be restored anytime.',
  'delete.confirm': 'Move to trash',
  'delete.done': 'Moved to trash: {name}',
  'trash.heading': 'Deleted skills (restorable)',
  'trash.restore': 'Restore',
  'trash.restored': 'Restored {name}',
  'trash.clear': 'Empty trash',
  'trash.clearConfirmTitle': 'Empty the trash?',
  'trash.clearConfirmText': 'Skills in the trash will be permanently deleted and cannot be restored.',
  'trash.clearConfirm': 'Delete permanently',
  'trash.cleared': 'Trash emptied',
}