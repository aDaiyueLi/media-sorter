/**
 * settings.js - 设置管理器
 * 负责用户设置的读写、默认值管理、设置导入导出
 * 所有设置通过 IPC 持久化到 data/settings.json
 */

const SettingsManager = {
  // ==================== 默认设置 ====================

  /** 默认设置值 */
  DEFAULTS: {
    sortBy: 'name',           // 文件排序方式: 'name' | 'date' | 'size'
    seekSeconds: 5,            // 快进快退秒数
    volume: 0.8,               // 视频音量 (0-1)
    loopFileList: true,        // 文件列表边界时是否循环
    moveTargetFolder: '',      // 分类文件夹根目录（空=不移动）
    lastOpenedFolder: '',      // 上次打开的文件夹
    windowSize: { width: 1400, height: 900 },
    shortcuts: {
      // 文件导航
      prevFile: 'PageUp',
      nextFile: 'PageDown',
      rotate: 'Shift',
      // 媒体控制
      playPause: 'Space',
      seekBack: 'ArrowLeft',
      seekForward: 'ArrowRight',
      zoomIn: 'ArrowUp',
      zoomOut: 'ArrowDown',
      volumeUp: '=',
      volumeDown: '-',
      // 确认操作
      confirm: 'Enter',
      undo: 'Backspace'
      // 标签快捷键 (1-9, 字母键) 不在 shortcuts 中，由 tagPanel 动态管理
    }
  },

  /** 当前设置缓存 */
  _current: null,

  // ==================== 初始化 ====================

  /**
   * 从主进程加载设置，合并默认值
   * @returns {Promise<object>} 合并后的设置对象
   */
  async load() {
    const stored = await window.electronAPI.readSettings();
    // 深度合并：stored 覆盖 defaults
    this._current = this._deepMerge(this.DEFAULTS, stored);
    return this._current;
  },

  /**
   * 获取当前设置（内存缓存）
   * @returns {object} 当前设置对象
   */
  get() {
    if (!this._current) {
      this._current = { ...this.DEFAULTS };
    }
    return this._current;
  },

  /**
   * 更新单个设置项并持久化
   * @param {string} key - 设置键名（支持点语法如 'shortcuts.confirm'）
   * @param {*} value - 新值
   */
  async set(key, value) {
    if (!this._current) await this.load();
    // 支持点语法设置嵌套属性
    const keys = key.split('.');
    let obj = this._current;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]]) obj[keys[i]] = {};
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    await this._save();
  },

  /**
   * 批量更新设置
   * @param {object} updates - 要更新的设置键值对
   */
  async update(updates) {
    if (!this._current) await this.load();
    Object.assign(this._current, updates);
    await this._save();
  },

  /**
   * 获取快捷键映射
   * @returns {object} { 功能名: 按键 }
   */
  getShortcuts() {
    const settings = this.get();
    return settings.shortcuts || this.DEFAULTS.shortcuts;
  },

  /**
   * 更新快捷键并保存
   * @param {string} action - 功能名
   * @param {string} key - 新按键
   */
  async setShortcut(action, key) {
    await this.set(`shortcuts.${action}`, key);
  },

  /**
   * 检测快捷键冲突
   * @param {string} action - 要设置的功能名
   * @param {string} newKey - 新按键
   * @returns {string|null} 冲突的功能名，无冲突返回 null
   */
  checkConflict(action, newKey) {
    const shortcuts = this.getShortcuts();
    for (const [name, key] of Object.entries(shortcuts)) {
      if (name !== action && key === newKey) {
        return name; // 返回冲突的功能名
      }
    }
    return null;
  },

  /**
   * 导入设置（从 JSON 对象）
   * @param {object} importedSettings - 导入的设置对象
   */
  async importSettings(importedSettings) {
    if (!this._current) await this.load();
    // 深度合并：导入的设置覆盖当前设置
    this._current = this._deepMerge(this._current, importedSettings);
    await this._save();
  },

  /**
   * 导出当前设置为 JSON 文件
   */
  async exportToFile() {
    if (!this._current) await this.load();
    return await window.electronAPI.exportSettingsFile(this._current);
  },

  // ==================== 内部方法 ====================

  /** 持久化到磁盘 */
  async _save() {
    await window.electronAPI.writeSettings(this._current);
  },

  /**
   * 深度合并对象
   * 用于 settings.json 为扁平结构但包含 nested shortcuts 对象
   * @param {object} defaults - 默认值
   * @param {object} stored - 存储的值
   * @returns {object} 合并后的对象
   */
  _deepMerge(defaults, stored) {
    if (!stored || typeof stored !== 'object') {
      return { ...defaults };
    }
    const result = { ...stored };
    for (const key of Object.keys(defaults)) {
      if (!(key in result)) {
        result[key] = defaults[key];
      } else if (
        typeof defaults[key] === 'object' &&
        defaults[key] !== null &&
        !Array.isArray(defaults[key]) &&
        typeof result[key] === 'object' &&
        result[key] !== null &&
        !Array.isArray(result[key])
      ) {
        // 嵌套对象递归合并
        result[key] = this._deepMerge(defaults[key], result[key]);
      }
    }
    return result;
  }
};
