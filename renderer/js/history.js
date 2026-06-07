/**
 * history.js - 标签历史记录管理器
 * 管理打标签的历史记录，支持新增、撤回、查询
 * 所有记录通过 IPC 持久化到 data/tag-history.json
 */

const HistoryManager = {
  /** 当前历史记录缓存 */
  _records: null,

  // ==================== 初始化 ====================

  /**
   * 从主进程加载历史记录
   * @returns {Promise<Array>} 历史记录数组
   */
  async load() {
    this._records = await window.electronAPI.readHistory();
    return this._records;
  },

  /**
   * 获取全部历史记录
   * @returns {Array}
   */
  getAll() {
    if (!this._records) this._records = [];
    return this._records;
  },

  /**
   * 获取最近一条记录
   * @returns {object|null} 最近记录，无记录返回 null
   */
  getLast() {
    const records = this.getAll();
    if (records.length === 0) return null;
    return records[records.length - 1];
  },

  // ==================== 记录操作 ====================

  /**
   * 新增一条标签记录
   * @param {object} record - 记录对象
   * @param {string} record.originalName - 原始文件名
   * @param {string} record.modifiedName - 修改后文件名
   * @param {string} record.originalPath - 原始完整路径
   * @param {string[]} record.tags - 被打上的标签
   * @param {string} [record.movedTo] - 移动目标文件夹（可选）
   * @returns {Promise<object>} 添加的记录（含 id 和时间戳）
   */
  async add(record) {
    if (!this._records) await this.load();
    const newRecord = {
      id: this._records.length > 0
        ? Math.max(...this._records.map(r => r.id)) + 1
        : 1,
      originalName: record.originalName,
      modifiedName: record.modifiedName,
      originalPath: record.originalPath,
      tags: record.tags,
      taggedAt: new Date().toISOString(),
      movedTo: record.movedTo || null
    };
    this._records.push(newRecord);
    await this._save();
    return newRecord;
  },

  /**
   * 删除最后一条记录（撤回操作）
   * @returns {Promise<object|null>} 被删除的记录，无记录返回 null
   */
  async removeLast() {
    if (!this._records) await this.load();
    if (this._records.length === 0) return null;
    const removed = this._records.pop();
    await this._save();
    return removed;
  },

  /**
   * 根据 ID 删除记录
   * @param {number} id - 记录 ID
   */
  async removeById(id) {
    if (!this._records) await this.load();
    const index = this._records.findIndex(r => r.id === id);
    if (index === -1) return null;
    const removed = this._records.splice(index, 1)[0];
    await this._save();
    return removed;
  },

  // ==================== 内部方法 ====================

  /** 持久化到磁盘 */
  async _save() {
    await window.electronAPI.writeHistory(this._records);
  }
};
