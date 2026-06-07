/**
 * preload.js - 安全的 IPC 桥接层
 * 使用 contextBridge 向渲染进程暴露有限且安全的 API
 * 渲染进程通过 window.electronAPI 调用这些方法
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ==================== 文件夹选择 ====================

  /** 打开系统文件夹选择对话框，选择包含媒体文件的文件夹 */
  selectFolder: () => ipcRenderer.invoke('select-folder'),

  /** 打开系统文件夹选择对话框，选择分类文件的根目录 */
  selectTargetFolder: () => ipcRenderer.invoke('select-target-folder'),

  // ==================== 文件操作 ====================

  /**
   * 扫描指定文件夹中的媒体文件
   * @param {string} folderPath - 文件夹路径
   * @param {string} sortBy - 排序方式 'name'|'date'|'size'
   */
  listMediaFiles: (folderPath, sortBy) =>
    ipcRenderer.invoke('list-media-files', folderPath, sortBy),

  /**
   * 重命名文件，在文件名末尾追加或替换标签括号
   * @param {string} filePath - 原文件路径
   * @param {string[]} tags - 标签数组
   */
  renameFile: (filePath, tags) =>
    ipcRenderer.invoke('rename-file', filePath, tags),

  /**
   * 撤回上一次重命名操作
   * @param {object} record - 历史记录条目
   */
  undoRename: (record) => ipcRenderer.invoke('undo-rename', record),

  /**
   * 移动文件到目标文件夹
   * @param {string} filePath - 当前文件路径
   * @param {string} targetFolder - 目标文件夹
   */
  moveFile: (filePath, targetFolder) =>
    ipcRenderer.invoke('move-file', filePath, targetFolder),

  /**
   * 撤回移动操作
   */
  undoMove: (currentPath, originalPath) =>
    ipcRenderer.invoke('undo-move', currentPath, originalPath),

  // ==================== JSON 数据读写 ====================

  /** 读取用户设置 */
  readSettings: () => ipcRenderer.invoke('read-settings'),

  /** 写入用户设置 */
  writeSettings: (settings) => ipcRenderer.invoke('write-settings', settings),

  /** 读取常用标签列表 */
  readCommonTags: () => ipcRenderer.invoke('read-common-tags'),

  /** 写入常用标签列表 */
  writeCommonTags: (tags) => ipcRenderer.invoke('write-common-tags', tags),

  /** 读取标签历史记录 */
  readHistory: () => ipcRenderer.invoke('read-history'),

  /** 写入标签历史记录 */
  writeHistory: (history) => ipcRenderer.invoke('write-history', history),

  // ==================== 设置导入导出 ====================

  /** 导出设置到 JSON 文件 */
  exportSettingsFile: (settings) =>
    ipcRenderer.invoke('export-settings-file', settings),

  // ==================== 菜单栏事件监听 ====================

  /**
   * 监听来自主进程菜单栏的事件
   * @param {string} channel - 事件名称
   * @param {Function} callback - 回调函数
   */
  onMenuEvent: (channel, callback) => {
    const validChannels = [
      'menu-select-folder',
      'menu-sort-by',
      'menu-seek-seconds',
      'menu-loop-files',
      'menu-shortcut-settings',
      'menu-reset-shortcuts',
      'menu-manage-common-tags',
      'menu-show-help',
      'menu-set-move-folder',
      'menu-import-settings',
      'menu-request-export-settings'
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
  },

  /** 移除菜单栏事件监听 */
  removeMenuListener: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});
