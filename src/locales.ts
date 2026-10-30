/** English and Chinese copy for the no-workspace picker option. */
export const NS = 'projectless-chat'

/** Default copy for locales without a dedicated translation. */
export const en = {
  none: 'No workspace',
  busy: 'Preparing chat…',
  retry: 'Retry',
  failure: 'Could not complete the selection',
  addWorkspace: 'Add workspace…',
  cancel: 'Cancel',
  pickTitle: 'Select Workspace Directory',
  path: 'Directory path',
  go: 'Go',
  up: 'Up',
  showHidden: 'Show hidden folders',
  loading: 'Loading…',
  truncated: 'There are more folders than can be displayed.',
  selectDirectory: 'Select this directory',
  folderName: 'Folder name',
  newFolder: 'New folder',
} as const

/** Dictionary keys owned by this plugin. */
export type ProjectlessKey = keyof typeof en

/** Simplified Chinese copy. */
export const zh: Record<ProjectlessKey, string> = {
  none: '不在项目中工作',
  busy: '正在准备会话…',
  retry: '重试',
  failure: '无法完成工作区选择',
  addWorkspace: '添加工作区…',
  cancel: '取消',
  pickTitle: '选择工作区目录',
  path: '目录路径',
  go: '前往',
  up: '上一级',
  showHidden: '显示隐藏文件夹',
  loading: '加载中…',
  truncated: '文件夹较多，仅显示部分结果。',
  selectDirectory: '选择此目录',
  folderName: '文件夹名称',
  newFolder: '新建文件夹',
}
