/**
 * tagPanel.js - 标签管理面板
 * 负责标签的增删、选中、重命名、拖拽排序、快捷键绑定
 * 以及右键菜单的弹出与处理
 */

const TagPanel = {
  // ==================== DOM 引用 ====================

  _elements: {},

  // ==================== 状态 ====================

  /** 当前标签列表 [{id, name, shortcutKey}] */
  _tags: [],
  /** 当前选中的标签 ID 集合 */
  _selectedTags: new Set(),
  /** 标签 ID 计数器 */
  _idCounter: 0,
  /** 长按拖拽定时器 */
  _longPressTimer: null,
  /** 正在被拖拽的标签元素 */
  _draggedTagEl: null,

  // ==================== 回调 ====================

  /** 标签选中状态变化时回调 () → void */
  onSelectionChange: null,

  // ==================== 初始化 ====================

  /**
   * 初始化标签面板，缓存 DOM 引用并绑定事件
   */
  init() {
    this._elements = {
      tagsContainer: document.getElementById('tags-container'),
      tagsEmptyState: document.getElementById('tags-empty-state'),
      tagsList: document.getElementById('tags-list'),
      btnAddTagFirst: document.getElementById('btn-add-tag-first'),
      btnAddTag: document.getElementById('btn-add-tag'),
      contextMenu: document.getElementById('context-menu')
    };

    this._bindEvents();
  },

  // ==================== 事件绑定 ====================

  _bindEvents() {
    // 添加标签按钮
    this._elements.btnAddTagFirst.addEventListener('click', () => this.addTag());
    this._elements.btnAddTag.addEventListener('click', () => this.addTag());

    // 全局点击关闭右键菜单
    document.addEventListener('click', () => this._hideContextMenu());

    // 标签容器上的右键菜单（事件委托）
    this._elements.tagsContainer.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const tagEl = e.target.closest('.tag-chip');
      if (tagEl) {
        // 右键标签：显示标签专用菜单
        this._showTagContextMenu(e.clientX, e.clientY, tagEl);
      } else {
        // 右键空白处：显示批量操作菜单
        this._showPanelContextMenu(e.clientX, e.clientY);
      }
    });

    // 标签容器上的左键点击事件（事件委托）
    this._elements.tagsList.addEventListener('click', (e) => {
      const tagEl = e.target.closest('.tag-chip');
      if (tagEl) {
        // 如果点击的是输入框，不触发选中切换
        if (e.target.classList.contains('tag-rename-input')) return;
        const tagId = parseInt(tagEl.dataset.tagId);
        this.toggleTag(tagId);
      }
    });

    // 标签容器上的鼠标按下事件（用于长按拖拽检测）
    this._elements.tagsList.addEventListener('mousedown', (e) => {
      const tagEl = e.target.closest('.tag-chip');
      if (tagEl && !e.target.classList.contains('tag-rename-input')) {
        this._startLongPress(e, tagEl);
      }
    });
  },

  // ==================== 标签增删 ====================

  /**
   * 添加一个新标签
   * 名称为 "?"，亮红色，禁止再次添加直到被重命名
   */
  addTag() {
    // 检查当前是否有未命名标签
    const hasUnnamed = this._tags.some(t => t.name === '?');
    if (hasUnnamed) {
      alert('请先为当前未命名的标签（红色闪烁）命名后再添加新标签');
      return;
    }

    const newTag = {
      id: ++this._idCounter,
      name: '?',
      shortcutKey: this._getAutoShortcut(this._tags.length + 1)
    };

    this._tags.push(newTag);
    this._render();
  },

  /**
   * 删除指定 ID 的标签
   * @param {number} tagId - 标签 ID
   */
  removeTag(tagId) {
    this._tags = this._tags.filter(t => t.id !== tagId);
    this._selectedTags.delete(tagId);
    this._updateShortcutKeys();
    this._render();
    if (this.onSelectionChange) this.onSelectionChange();
  },

  /**
   * 删除所有标签
   */
  removeAllTags() {
    this._tags = [];
    this._selectedTags.clear();
    this._render();
    if (this.onSelectionChange) this.onSelectionChange();
  },

  /**
   * 重命名指定标签
   * @param {number} tagId - 标签 ID
   * @param {string} newName - 新名称
   */
  renameTag(tagId, newName) {
    const tag = this._tags.find(t => t.id === tagId);
    if (!tag) return;
    tag.name = newName;
    this._render();
  },

  // ==================== 标签选中 ====================

  /**
   * 切换标签选中状态
   * @param {number} tagId - 标签 ID
   */
  toggleTag(tagId) {
    if (this._selectedTags.has(tagId)) {
      this._selectedTags.delete(tagId);
    } else {
      this._selectedTags.add(tagId);
    }
    this._renderSelection();
    if (this.onSelectionChange) this.onSelectionChange();
  },

  /** 清除所有标签选中状态 */
  clearSelection() {
    this._selectedTags.clear();
    this._renderSelection();
  },

  /**
   * 根据标签名称列表设置选中状态
   * 用于预选中文件已有的标签
   * @param {string[]} tagNames - 标签名称数组
   */
  selectByNames(tagNames) {
    this._selectedTags.clear();
    for (const name of tagNames) {
      const tag = this._tags.find(t => t.name === name);
      if (tag) {
        this._selectedTags.add(tag.id);
      }
    }
    this._renderSelection();
  },

  /** 获取当前选中的标签名称列表 */
  getSelectedTagNames() {
    return this._tags
      .filter(t => this._selectedTags.has(t.id))
      .map(t => t.name);
  },

  // ==================== 快捷键 ====================

  /**
   * 通过快捷键切换标签选中
   * @param {string} key - 按键名称（如 '1', 'q', 'w'）
   */
  activateByShortcut(key) {
    const tag = this._tags.find(t => t.shortcutKey.toLowerCase() === key.toLowerCase());
    if (tag) {
      this.toggleTag(tag.id);
    }
  },

  /**
   * 根据标签索引获取快捷键（优先从持久化设置读取，否则使用默认值）
   * 前9个默认 1-9，后续默认为空
   * @param {number} index - 1-based 标签位置索引
   * @returns {string} 快捷键字符
   */
  _getAutoShortcut(index) {
    // 优先从持久化设置中按位置读取
    const persisted = SettingsManager.getTagShortcutAt(index);
    if (persisted !== null && persisted !== '') return persisted;
    // 默认规则：位置1-9 → 数字
    if (index <= 9) {
      return String(index);
    }
    return '';
  },

  /** 根据当前顺序更新所有标签的快捷键（从持久化设置按位置读取） */
  _updateShortcutKeys() {
    this._tags.forEach((tag, i) => {
      tag.shortcutKey = this._getAutoShortcut(i + 1);
    });
  },

  // ==================== 拖拽排序 ====================

  /**
   * 开始长按拖拽检测
   */
  _startLongPress(e, tagEl) {
    this._longPressTimer = setTimeout(() => {
      this._startDrag(tagEl);
    }, 400); // 长按400ms开始拖拽

    // 移动或松开鼠标取消长按
    const cancelHandler = () => {
      clearTimeout(this._longPressTimer);
      document.removeEventListener('mousemove', cancelHandler);
      document.removeEventListener('mouseup', cancelHandler);
    };
    document.addEventListener('mousemove', cancelHandler);
    document.addEventListener('mouseup', cancelHandler);
  },

  /**
   * 启动拖拽
   */
  _startDrag(tagEl) {
    tagEl.classList.add('dragging');
    this._draggedTagEl = tagEl;
    tagEl.draggable = true;

    // 监听拖拽事件
    this._elements.tagsList.addEventListener('dragstart', (e) => {
      if (e.target === tagEl) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', tagEl.dataset.tagId);
      }
    });

    this._elements.tagsList.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const targetEl = e.target.closest('.tag-chip');
      if (targetEl && targetEl !== this._draggedTagEl) {
        targetEl.classList.add('drag-over');
      }
    });

    this._elements.tagsList.addEventListener('dragleave', (e) => {
      const targetEl = e.target.closest('.tag-chip');
      if (targetEl) {
        targetEl.classList.remove('drag-over');
      }
    });

    this._elements.tagsList.addEventListener('drop', (e) => {
      e.preventDefault();
      const targetEl = e.target.closest('.tag-chip');
      if (targetEl) {
        targetEl.classList.remove('drag-over');
      }
      if (this._draggedTagEl) {
        this._draggedTagEl.classList.remove('dragging');
        this._draggedTagEl.draggable = false;
      }

      const fromId = parseInt(e.dataTransfer.getData('text/plain'));
      const toEl = e.target.closest('.tag-chip');
      if (!toEl || !fromId) return;
      const toId = parseInt(toEl.dataset.tagId);

      // 重新排列 this._tags
      const fromIndex = this._tags.findIndex(t => t.id === fromId);
      const toIndex = this._tags.findIndex(t => t.id === toId);
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;

      const [moved] = this._tags.splice(fromIndex, 1);
      this._tags.splice(toIndex, 0, moved);
      // 快捷键跟随新顺序
      this._updateShortcutKeys();
      this._render();
    });

    // 短暂延迟后设置 draggable 以触发原生拖拽
    setTimeout(() => {
      if (tagEl) tagEl.draggable = true;
    }, 50);
  },

  // ==================== 右键菜单 ====================

  /**
   * 显示标签专用右键菜单
   */
  _showTagContextMenu(x, y, tagEl) {
    const tagId = parseInt(tagEl.dataset.tagId);
    const tag = this._tags.find(t => t.id === tagId);
    if (!tag) return;

    this._renderContextMenu([
      { label: '重命名', icon: '✏️', action: () => this._promptRenameTag(tagId) },
      { label: '设置快捷键', icon: '⌨️', action: () => this._promptSetShortcut(tagId) },
      { label: '删除', icon: '🗑️', action: () => this.removeTag(tagId), danger: true },
      { separator: true },
      { label: '保存为常用', icon: '⭐', action: () => this._saveTagAsCommon(tag) }
    ], x, y);
  },

  /**
   * 显示面板空白处右键菜单
   */
  _showPanelContextMenu(x, y) {
    this._renderContextMenu([
      { label: '从常用标签中选择', icon: '📋', action: () => this._showCommonTagsSelector() },
      { label: '将当前所有标签添加为常用', icon: '💾', action: () => this._saveAllAsCommon() },
      { separator: true },
      { label: '删除所有标签', icon: '🗑️', action: () => this._confirmRemoveAll(), danger: true }
    ], x, y);
  },

  /**
   * 渲染右键菜单
   * @param {Array} items - 菜单项列表
   * @param {number} x - 鼠标 X
   * @param {number} y - 鼠标 Y
   */
  _renderContextMenu(items, x, y) {
    const menu = this._elements.contextMenu;
    menu.innerHTML = '';

    items.forEach(item => {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.className = 'context-menu-separator';
        menu.appendChild(sep);
      } else {
        const menuItem = document.createElement('div');
        menuItem.className = 'context-menu-item';
        if (item.danger) menuItem.classList.add('danger');
        menuItem.innerHTML = `<span>${item.icon || ''}</span><span>${item.label}</span>`;
        menuItem.addEventListener('click', () => {
          this._hideContextMenu();
          item.action();
        });
        menu.appendChild(menuItem);
      }
    });

    menu.style.display = 'block';
    // 防止菜单超出窗口边界
    menu.style.left = Math.min(x, window.innerWidth - 200) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - 200) + 'px';
  },

  /** 隐藏右键菜单 */
  _hideContextMenu() {
    this._elements.contextMenu.style.display = 'none';
  },

  // ==================== 标签操作 ====================

  /** 弹出重命名输入框 */
  _promptRenameTag(tagId) {
    const tag = this._tags.find(t => t.id === tagId);
    if (!tag) return;

    // 直接在标签上切换为输入框
    const tagEl = document.querySelector(`.tag-chip[data-tag-id="${tagId}"]`);
    if (!tagEl) return;

    const nameEl = tagEl.querySelector('.tag-name');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tag-rename-input';
    input.value = tag.name === '?' ? '' : tag.name;
    input.placeholder = '输入标签名';

    // 替换文本为输入框
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    const finishRename = async () => {
      const newName = input.value.trim() || '未命名';
      this.renameTag(tagId, newName);
      // 同步更新常用标签
      await this._updateCommonTagName(tag.name, newName);
    };

    input.addEventListener('blur', finishRename);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        input.blur(); // 触发 blur → finishRename
      } else if (e.key === 'Escape') {
        input.value = tag.name === '?' ? '' : tag.name;
        input.blur();
      }
    });
  },


  /**
   * 弹出快捷键设置对话框
   * 可设置为单个字母/数字键，位置 1-9 默认使用数字键，位置 ≥10 可手动设置字母键
   */
  _promptSetShortcut(tagId) {
    const tag = this._tags.find(t => t.id === tagId);
    if (!tag) return;

    const tagIndex = this._tags.indexOf(tag);
    const position = tagIndex + 1;

    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');

    let html = '<h2>设置标签快捷键</h2>';
    html += '<p style="margin-bottom:4px;">标签: <strong>' + this._escapeHTML(tag.name) + '</strong>（第 ' + position + ' 个）</p>';
    if (position <= 9) {
      html += '<p style="color:var(--text-muted);font-size:13px;margin-bottom:12px;">默认快捷键为数字 <strong>' + position + '</strong>，可按需改为其他键</p>';
    } else {
      html += '<p style="color:var(--text-muted);font-size:13px;margin-bottom:12px;">请输入单个字母键（A-Z）</p>';
    }
    html += '<div id="shortcut-capture-display" style="text-align:center;padding:32px 16px;font-size:48px;color:var(--accent-color);border:3px dashed var(--accent-color);border-radius:12px;margin-bottom:8px;">等待按键...</div>';
    html += '<p id="shortcut-capture-error" style="color:var(--danger-color);font-size:13px;text-align:center;display:none;"></p>';
    html += '<div class="btn-row" style="margin-top:12px;">';
    html += '<button id="btn-shortcut-clear" class="btn-secondary" style="margin-right:auto;">清除快捷键</button>';
    html += '<button id="btn-shortcut-cancel-set" class="btn-secondary">取消</button>';
    html += '</div>';

    content.innerHTML = html;
    overlay.style.display = 'flex';

    const errorEl = document.getElementById('shortcut-capture-error');

    // 清除/重置快捷键
    document.getElementById('btn-shortcut-clear').addEventListener('click', async () => {
      ShortcutsManager.stopCapture();
      await SettingsManager.clearTagShortcut(position);
      tag.shortcutKey = this._getAutoShortcut(position);
      this._render();
      overlay.style.display = 'none';
      this._showToast('标签「' + tag.name + '」快捷键已重置');
    });

    // 取消
    document.getElementById('btn-shortcut-cancel-set').addEventListener('click', () => {
      ShortcutsManager.stopCapture();
      overlay.style.display = 'none';
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        ShortcutsManager.stopCapture();
        overlay.style.display = 'none';
      }
    });

    // 开始捕获按键
    ShortcutsManager.startCapture(async (key) => {
      errorEl.style.display = 'none';

      // 验证：必须是单个字母 a-z 或数字 0-9
      if (!/^[a-z0-9]$/i.test(key)) {
        errorEl.textContent = '标签快捷键只能是单个字母或数字，请重试';
        errorEl.style.display = 'block';
        return;
      }

      // 冲突检测（标签间 + 全局）
      const conflict = SettingsManager.checkTagShortcutConflict(position, key);
      if (conflict) {
        if (conflict.type === 'tag') {
          const conflictPosTag = this._tags[parseInt(conflict.target) - 1];
          const conflictName = conflictPosTag ? conflictPosTag.name : '?';
          errorEl.textContent = '与标签「' + conflictName + '」的快捷键冲突 (' + key.toUpperCase() + ')';
        } else {
          const conflictLabel = ShortcutsManager.ACTION_LABELS[conflict.target] || conflict.target;
          errorEl.textContent = '与全局功能「' + conflictLabel + '」的快捷键冲突 (' + key.toUpperCase() + ')';
        }
        errorEl.style.display = 'block';
        return;
      }

      ShortcutsManager.stopCapture();
      // 持久化到 settings
      await SettingsManager.setTagShortcut(position, key.toLowerCase());
      tag.shortcutKey = key.toLowerCase();
      this._render();
      overlay.style.display = 'none';
      this._showToast('标签「' + tag.name + '」快捷键已设置为 ' + key.toUpperCase());
    });
  },


  /** 确认后删除所有标签 */
  _confirmRemoveAll() {
    if (confirm('确定要删除所有标签吗？此操作不可撤回。')) {
      this.removeAllTags();
    }
  },

  // ==================== 常用标签操作 ====================

  /**
   * 保存单个标签为常用
   */
  async _saveTagAsCommon(tag) {
    if (tag.name === '?') {
      alert('请先为标签命名后再保存为常用');
      return;
    }
    const commonTags = await window.electronAPI.readCommonTags();
    if (!commonTags.includes(tag.name)) {
      commonTags.push(tag.name);
      await window.electronAPI.writeCommonTags(commonTags);
      this._showToast(`标签"${tag.name}"已保存为常用`);
    } else {
      this._showToast(`标签"${tag.name}"已是常用标签`);
    }
  },

  /**
   * 将当前所有标签保存为常用（去重）
   */
  async _saveAllAsCommon() {
    const validTags = this._tags.filter(t => t.name !== '?');
    if (validTags.length === 0) {
      alert('没有可保存的标签（请先命名未命名的标签）');
      return;
    }
    const commonTags = await window.electronAPI.readCommonTags();
    let addedCount = 0;
    for (const tag of validTags) {
      if (!commonTags.includes(tag.name)) {
        commonTags.push(tag.name);
        addedCount++;
      }
    }
    await window.electronAPI.writeCommonTags(commonTags);
    this._showToast(`已添加 ${addedCount} 个标签为常用（${validTags.length} 个中）`);
  },

  /**
   * 更新常用标签中的名称
   */
  async _updateCommonTagName(oldName, newName) {
    if (oldName === '?' || oldName === newName) return;
    const commonTags = await window.electronAPI.readCommonTags();
    const index = commonTags.indexOf(oldName);
    if (index !== -1) {
      commonTags[index] = newName;
      await window.electronAPI.writeCommonTags(commonTags);
    }
  },

  /**
   * 显示常用标签多选弹窗
   */
  async _showCommonTagsSelector() {
    const commonTags = await window.electronAPI.readCommonTags();
    if (commonTags.length === 0) {
      alert('没有常用标签，请先在菜单栏的常用标签选项中添加');
      return;
    }

    // 构建弹窗内容：标签芯片风格，与分类窗口一致
    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');

    let html = '<h2>从常用标签中选择</h2>';
    html += '<input type="text" id="common-tags-search" placeholder="搜索标签...">';
    // 标签芯片容器（flex-wrap 布局，点击选中/取消，选中蓝色高亮）
    html += '<div id="common-tags-select" style="display:flex;flex-wrap:wrap;gap:8px;max-height:300px;overflow-y:auto;padding:8px 0;">';
    commonTags.forEach((name, i) => {
      html += `
        <div class="tag-chip common-select-chip" data-tag-name="${this._escapeHTML(name)}" data-index="${i}" style="cursor:pointer;">
          <span class="tag-name">${this._escapeHTML(name)}</span>
        </div>`;
    });
    html += '</div>';
    html += '<p style="color:var(--text-muted);margin-top:8px;font-size:11px;font-style:italic;">点击标签选中/取消，蓝色为已选中</p>';
    html += '<div class="btn-row">';
    html += '<button id="btn-common-tags-cancel" class="btn-secondary">取消</button>';
    html += '<button id="btn-common-tags-confirm" class="btn-primary">添加选中</button>';
    html += '</div>';

    content.innerHTML = html;
    overlay.style.display = 'flex';

    // 已选中的标签集合
    const selected = new Set();

    // 搜索过滤
    const searchInput = document.getElementById('common-tags-search');
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.toLowerCase();
      document.querySelectorAll('.common-select-chip').forEach(chip => {
        const text = chip.querySelector('.tag-name').textContent.toLowerCase();
        chip.style.display = text.includes(query) ? 'inline-flex' : 'none';
      });
    });

    // 点击芯片切换选中状态（视觉反馈）
    content.querySelectorAll('.common-select-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const name = chip.dataset.tagName;
        if (selected.has(name)) {
          selected.delete(name);
          chip.classList.remove('selected');
        } else {
          selected.add(name);
          chip.classList.add('selected');
        }
      });
    });

    // 取消按钮
    document.getElementById('btn-common-tags-cancel').addEventListener('click', () => {
      overlay.style.display = 'none';
    });

    // 确认按钮
    document.getElementById('btn-common-tags-confirm').addEventListener('click', () => {
      selected.forEach(tagName => {
        if (!this._tags.some(t => t.name === tagName)) {
          const newTag = {
            id: ++this._idCounter,
            name: tagName,
            shortcutKey: this._getAutoShortcut(this._tags.length + 1)
          };
          this._tags.push(newTag);
        }
      });
      this._updateShortcutKeys();
      this._render();
      overlay.style.display = 'none';
      this._showToast(`已添加 ${selected.size} 个标签`);
    });
  },

  /**
   * 全量重新渲染标签列表
   */
  _render() {
    const list = this._elements.tagsList;
    const emptyState = this._elements.tagsEmptyState;
    const addBtn = this._elements.btnAddTag;

    // 更新空状态和添加按钮
    if (this._tags.length === 0) {
      emptyState.style.display = 'flex';
      addBtn.style.display = 'none';
    } else {
      emptyState.style.display = 'none';
      addBtn.style.display = 'inline-flex';
    }

    // 检查是否有未命名标签，有则禁用添加按钮
    const hasUnnamed = this._tags.some(t => t.name === '?');
    if (hasUnnamed) {
      addBtn.classList.add('disabled');
    } else {
      addBtn.classList.remove('disabled');
    }

    // 渲染标签芯片
    list.innerHTML = this._tags.map(tag => this._renderTagHTML(tag)).join('');
  },

  /**
   * 渲染单个标签的 HTML
   * @param {object} tag - 标签对象
   * @returns {string} HTML 字符串
   */
  _renderTagHTML(tag) {
    const isSelected = this._selectedTags.has(tag.id);
    const isUnnamed = tag.name === '?';
    const classes = [
      'tag-chip',
      isSelected ? 'selected' : '',
      isUnnamed ? 'unnamed' : ''
    ].filter(Boolean).join(' ');

    const shortcutBadge = tag.shortcutKey
      ? `<span class="shortcut-badge">${this._escapeHTML(tag.shortcutKey)}</span>`
      : '';

    return `
      <div class="${classes}" data-tag-id="${tag.id}">
        ${shortcutBadge}
        <span class="tag-name">${this._escapeHTML(tag.name)}</span>
      </div>`;
  },

  /**
   * 仅更新标签选中状态（不重建整个列表，性能优化）
   */
  _renderSelection() {
    const allChips = this._elements.tagsList.querySelectorAll('.tag-chip');
    allChips.forEach(chip => {
      const tagId = parseInt(chip.dataset.tagId);
      if (this._selectedTags.has(tagId)) {
        chip.classList.add('selected');
      } else {
        chip.classList.remove('selected');
      }
    });
  },

  // ==================== 工具方法 ====================

  /** HTML 转义，防止 XSS */
  _escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  /** 显示短暂提示 */
  _showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 3000);
  }
};
