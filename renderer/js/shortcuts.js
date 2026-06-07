/**
 * shortcuts.js - 快捷键系统
 * 统一管理所有快捷键的注册、触发、自定义设置
 * 支持冲突检测和全局键盘事件监听
 */

const ShortcutsManager = {
  // ==================== 状态 ====================

  /** 当前快捷键映射: { action: key } */
  _shortcuts: {},

  /** 注册的回调函数: { action: Function } */
  _callbacks: {},

  /** 是否正在捕获按键（用于设置面板） */
  _isCapturing: false,
  _captureCallback: null,

  // ==================== 功能名称中文映射 ====================

  /**
   * 功能名称的中文显示名（用于设置面板）
   */
  ACTION_LABELS: {
    prevFile: '上一个文件',
    nextFile: '下一个文件',
    rotate: '旋转 90°',
    playPause: '播放/暂停',
    seekBack: '快退',
    seekForward: '快进',
    zoomIn: '图片放大',
    zoomOut: '图片缩小',
    volumeUp: '音量增大',
    volumeDown: '音量减小',
    confirm: '确认打标签',
    undo: '撤回操作'
  },

  /** 功能分类（用于设置面板分组显示） */
  ACTION_CATEGORIES: {
    '文件导航': ['prevFile', 'nextFile', 'rotate'],
    '媒体控制': ['playPause', 'seekBack', 'seekForward', 'zoomIn', 'zoomOut', 'volumeUp', 'volumeDown'],
    '操作确认': ['confirm', 'undo']
  },

  // ==================== 查找 ====================

  /**
   * 根据按键查找对应的全局功能
   * @param {string} key - 按键名称
   * @returns {string|null} 功能名，未找到返回 null
   */
  findActionByKey(key) {
    for (const [action, registeredKey] of Object.entries(this._shortcuts)) {
      if (registeredKey && registeredKey.toLowerCase() === key.toLowerCase()) {
        return action;
      }
    }
    return null;
  },

  // ==================== 初始化 ====================

  /**
   * 初始化快捷键系统，加载设置并绑定全局键盘事件
   */
  init() {
    this._shortcuts = SettingsManager.getShortcuts();
    document.addEventListener('keydown', (e) => this._onKeyDown(e));
  },

  /**
   * 重新加载快捷键设置（设置变更后调用）
   */
  reload() {
    this._shortcuts = SettingsManager.getShortcuts();
  },

  // ==================== 注册回调 ====================

  /**
   * 注册功能的快捷键回调
   * @param {string} action - 功能名称
   * @param {Function} callback - 回调函数
   */
  register(action, callback) {
    this._callbacks[action] = callback;
  },

  /**
   * 批量注册回调
   * @param {object} map - { action: callback }
   */
  registerAll(map) {
    Object.assign(this._callbacks, map);
  },

  // ==================== 键盘事件处理 ====================

  /**
   * 全局键盘事件处理
   * 根据按键查找对应的功能并触发回调
   * @param {KeyboardEvent} e - 键盘事件
   */
  _onKeyDown(e) {
    // 如果正在捕获按键（设置面板），截获事件
    if (this._isCapturing) {
      e.preventDefault();
      e.stopPropagation();
      if (this._captureCallback) {
        this._captureCallback(this._eventToKeyName(e));
      }
      return;
    }

    // 忽略输入框中的按键（标签重命名等场景）
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
      return;
    }

    const keyName = this._eventToKeyName(e);

    // 查找是否有快捷键匹配
    for (const [action, registeredKey] of Object.entries(this._shortcuts)) {
      if (!registeredKey) continue; // 跳过未设置的快捷键
      if (registeredKey.toLowerCase() === keyName.toLowerCase()) {
        e.preventDefault();
        const callback = this._callbacks[action];
        if (callback) callback();
        return;
      }
    }

    // 处理标签快捷键（1-9 和字母键，不在 settings 中管理）
    // 当没有匹配到全局快捷键时，传递给标签面板处理
    if (/^[1-9a-z]$/i.test(keyName)) {
      // 标签快捷键只对单个字符生效
      TagPanel.activateByShortcut(keyName);
    }
  },

  /**
   * 将键盘事件转换为标准按键名称
   * @param {KeyboardEvent} e - 键盘事件
   * @returns {string} 如 'Enter', 'PageUp', 'ArrowLeft', 'Space', 'Shift'
   *  或单字符如 'a', '=', '-'
   */
  _eventToKeyName(e) {
    // 特殊键映射
    const specialKeys = {
      ' ': 'Space',
      'ArrowUp': 'ArrowUp',
      'ArrowDown': 'ArrowDown',
      'ArrowLeft': 'ArrowLeft',
      'ArrowRight': 'ArrowRight',
      'PageUp': 'PageUp',
      'PageDown': 'PageDown',
      'Shift': 'Shift',
      'Backspace': 'Backspace',
      'Enter': 'Enter',
      'Escape': 'Escape',
      'Tab': 'Tab',
      'Delete': 'Delete',
      'Control': 'Control',
      'Alt': 'Alt',
      'Meta': 'Meta'
    };

    if (specialKeys[e.key]) return specialKeys[e.key];
    if (e.code === 'Space') return 'Space';

    // 对于数字和字母键，直接返回小写字符
    // Shift+= 返回 '=', Shift+- 返回 '-'
    if (e.key.length === 1) {
      return e.key.toLowerCase();
    }

    return e.key;
  },

  // ==================== 按键捕获（设置面板用） ====================

  /**
   * 开始捕获下一个按键
   * @param {Function} callback - 捕获到按键后的回调，参数为按键名称
   */
  startCapture(callback) {
    this._isCapturing = true;
    this._captureCallback = callback;
  },

  /** 停止捕获 */
  stopCapture() {
    this._isCapturing = false;
    this._captureCallback = null;
  },

  // ==================== 设置面板渲染 ====================

  /**
   * 渲染快捷键设置面板到模态弹窗中
   */
  renderSettingsPanel() {
    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');

    const categories = this.ACTION_CATEGORIES;
    let html = '<h2>快捷键设置</h2>';
    html += '<p style="color: var(--text-muted); margin-bottom: 16px; font-size: 13px;">点击「修改」按钮后按下新按键即可自定义快捷键</p>';

    for (const [category, actions] of Object.entries(categories)) {
      html += `<h3 style="margin-top: 16px; margin-bottom: 8px; color: var(--text-secondary); font-size: 14px;">${category}</h3>`;
      html += '<table class="shortcut-table"><thead><tr><th>功能</th><th>当前快捷键</th><th>操作</th></tr></thead><tbody>';

      for (const action of actions) {
        const currentKey = this._shortcuts[action] || '未设置';
        const label = this.ACTION_LABELS[action] || action;
        html += `
          <tr>
            <td>${label}</td>
            <td><span class="shortcut-key" id="shortcut-display-${action}">${currentKey}</span></td>
            <td><button class="btn-edit-shortcut" data-action="${action}" style="padding:4px 12px; border:1px solid var(--border-color); border-radius:4px; background:var(--bg-tertiary); color:var(--text-primary); cursor:pointer;">修改</button></td>
          </tr>`;
      }

      html += '</tbody></table>';
    }

    // 标签快捷键部分（动态读取当前标签列表，最多30个）
    const tags = TagPanel._tags;
    if (tags && tags.length > 0) {
      html += '<h3 style="margin-top: 16px; margin-bottom: 8px; color: var(--text-secondary); font-size: 14px;">标签快捷键</h3>';
      html += '<p style="color: var(--text-muted); font-size: 12px; margin-bottom: 8px;">前9个默认数字键 1-9，后续可手动设为字母键。最多支持前30个标签</p>';
      html += '<table class="shortcut-table"><thead><tr><th>位置</th><th>标签名</th><th>快捷键</th><th>操作</th></tr></thead><tbody>';
      tags.forEach((tag, i) => {
        const pos = i + 1;
        if (pos > 30) return;
        const currentKey = tag.shortcutKey || '未设置';
        html += '<tr>'
          + '<td>' + pos + '</td>'
          + '<td>' + this._escapeHTML(tag.name) + '</td>'
          + '<td><span class="shortcut-key" id="tag-shortcut-display-' + pos + '">' + currentKey + '</span></td>'
          + '<td><button class="btn-edit-shortcut btn-edit-tag-shortcut" data-tag-pos="' + pos + '" style="padding:4px 12px; border:1px solid var(--border-color); border-radius:4px; background:var(--bg-tertiary); color:var(--text-primary); cursor:pointer;">修改</button></td>'
          + '</tr>';
      });
      html += '</tbody></table>';
    }

    // 冲突提示区域
    html += '<div id="shortcut-conflict-warning" style="margin-top: 16px; padding: 8px 12px; background-color: rgba(255, 107, 107, 0.15); border: 1px solid var(--danger-color); border-radius: 6px; color: var(--danger-color); font-size: 13px; display: none;"></div>';

    html += '<div class="btn-row">';
    html += '<button id="btn-shortcuts-close" class="btn-primary">完成</button>';
    html += '</div>';

    content.innerHTML = html;
    overlay.style.display = 'flex';

    // 绑定修改按钮事件（全局快捷键）
    content.querySelectorAll('.btn-edit-shortcut:not(.btn-edit-tag-shortcut)').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        this._onEditShortcut(action, btn);
      });
    });

    // 绑定修改按钮事件（标签快捷键）
    content.querySelectorAll('.btn-edit-tag-shortcut').forEach(btn => {
      btn.addEventListener('click', () => {
        const pos = parseInt(btn.dataset.tagPos);
        this._onEditTagShortcut(pos, btn);
      });
    });

    // 关闭按钮
    document.getElementById('btn-shortcuts-close').addEventListener('click', () => {
      overlay.style.display = 'none';
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.stopCapture();
        overlay.style.display = 'none';
      }
    });
  },

  /**
   * 处理快捷键修改按钮点击
   * @param {string} action - 功能名
   * @param {HTMLElement} btn - 被点击的按钮元素
   */
  _onEditShortcut(action, btn) {
    const originalText = btn.textContent;
    btn.textContent = '等待按键...';
    btn.style.color = 'var(--accent-color)';
    btn.style.borderColor = 'var(--accent-color)';

    this.startCapture(async (newKey) => {
      this.stopCapture();
      btn.textContent = originalText;
      btn.style.color = '';
      btn.style.borderColor = '';

      // 冲突检测
      const conflict = SettingsManager.checkConflict(action, newKey);
      const warningEl = document.getElementById('shortcut-conflict-warning');

      if (conflict) {
        const conflictLabel = this.ACTION_LABELS[conflict] || conflict;
        warningEl.textContent = `⚠ 快捷键冲突：与「${conflictLabel}」的快捷键相同 (${newKey})，请重新设置`;
        warningEl.style.display = 'block';
        return;
      }

      warningEl.style.display = 'none';
      // 保存新快捷键
      await SettingsManager.setShortcut(action, newKey);
      this.reload();
      // 更新显示
      const displayEl = document.getElementById(`shortcut-display-${action}`);
      if (displayEl) displayEl.textContent = newKey;
    });
  },

  /**
   * 处理标签快捷键修改按钮点击
   * @param {number} position - 标签位置（1-based）
   * @param {HTMLElement} btn - 被点击的按钮元素
   */
  _onEditTagShortcut(position, btn) {
    const tags = TagPanel._tags;
    if (!tags || position > tags.length) return;

    const tag = tags[position - 1];
    const originalText = btn.textContent;
    btn.textContent = '等待按键...';
    btn.style.color = 'var(--accent-color)';
    btn.style.borderColor = 'var(--accent-color)';

    this.startCapture((newKey) => {
      this.stopCapture();
      btn.textContent = originalText;
      btn.style.color = '';
      btn.style.borderColor = '';

      const warningEl = document.getElementById('shortcut-conflict-warning');

      // 验证：必须是单个字母或数字
      if (!/^[a-z0-9]$/i.test(newKey)) {
        warningEl.textContent = '标签快捷键只能是单个字母或数字（A-Z / 0-9）';
        warningEl.style.display = 'block';
        return;
      }

      // 检查与已有标签快捷键的冲突
      const conflictTag = TagPanel._tags.find(
        (t, i) => i !== (position - 1) && t.shortcutKey && t.shortcutKey.toLowerCase() === newKey.toLowerCase()
      );
      if (conflictTag) {
        warningEl.textContent = '与标签「' + conflictTag.name + '」的快捷键冲突 (' + newKey.toUpperCase() + ')';
        warningEl.style.display = 'block';
        return;
      }

      // 检查与全局快捷键的冲突
      const globalConflict = this.findActionByKey(newKey);
      if (globalConflict) {
        const conflictLabel = this.ACTION_LABELS[globalConflict] || globalConflict;
        warningEl.textContent = '与全局功能「' + conflictLabel + '」的快捷键冲突 (' + newKey.toUpperCase() + ')';
        warningEl.style.display = 'block';
        return;
      }

      warningEl.style.display = 'none';
      // 直接更新标签的快捷键
      tag.shortcutKey = newKey.toLowerCase();
      TagPanel._render();
      // 更新显示
      const displayEl = document.getElementById('tag-shortcut-display-' + position);
      if (displayEl) displayEl.textContent = newKey.toLowerCase();
    });
  },

  /** HTML 转义 */
  _escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};
