/**
 * app.js - 应用初始化与主控制器
 * 负责协调所有模块，处理确认/撤回操作，响应菜单栏事件
 */

const App = {
  // ==================== 初始化 ====================

  /**
   * 应用入口：初始化所有子模块，注册快捷键，绑定菜单事件
   */
  async init() {
    // 1. 加载设置和历史记录
    await SettingsManager.load();
    await HistoryManager.load();

    // 2. 初始化子模块
    MediaViewer.init();
    TagPanel.init();
    ShortcutsManager.init();

    // 3. 应用音量记忆（从设置中恢复）
    const settings = SettingsManager.get();
    if (settings.volume !== undefined) {
      MediaViewer._volume = settings.volume;
      if (MediaViewer._updateVolumeDisplay) {
        MediaViewer._updateVolumeDisplay();
      }
    }

    // 3.5 鼠标滚轮调节音量 —— 在媒体容器上监听滚轮事件
    this._initScrollVolume();

    // 3.6 双击快捷操作：空白区域双击左键=确认，双击右键=撤回
    this._initDoubleClickActions();

    // 4. 注册所有快捷键回调
    this._registerShortcuts();

    // 5. 设置文件切换回调（切换时清除标签选中）
    MediaViewer.onFileChange = (newIndex, file) => {
      TagPanel.clearSelection();
      if (file && file.existingTags && file.existingTags.length > 0) {
        TagPanel.selectByNames(file.existingTags);
      }
    };

    // 6. 绑定确认/撤回按钮
    document.getElementById('btn-confirm').addEventListener('click', () => this.confirmTagging());
    document.getElementById('btn-undo').addEventListener('click', () => this.undoTagging());

    // 7. 初始化面板分割线拖拽
    this._initPanelResizer();

    // 8. 监听菜单栏事件
    this._setupMenuListeners();

    // 9. 尝试恢复上次打开的文件夹
    await this._restoreLastFolder();

    console.log('媒体文件分类工具初始化完成');
  },

  // ==================== 快捷键注册 ====================

  _registerShortcuts() {
    const callbacks = {
      prevFile: () => MediaViewer.previousFile(),
      nextFile: () => MediaViewer.nextFile(),
      rotate: () => MediaViewer.rotate(),
      playPause: () => MediaViewer.togglePlayPause(),
      seekBack: () => MediaViewer.seekBackward(),
      seekForward: () => MediaViewer.seekForward(),
      zoomIn: () => MediaViewer.zoom('in'),
      zoomOut: () => MediaViewer.zoom('out'),
      volumeUp: () => this._adjustVolume(+0.05),
      volumeDown: () => this._adjustVolume(-0.05),
      confirm: () => this.confirmTagging(),
      undo: () => this.undoTagging()
    };
    ShortcutsManager.registerAll(callbacks);
  },

  // ==================== 音量调节 ====================

  /**
   * 调节视频音量（快捷键 +/- 和鼠标滚轮共用）
   * @param {number} delta - 音量变化量
   */
  _adjustVolume(delta) {
    const newVol = Math.max(0, Math.min(1, MediaViewer._volume + delta));
    MediaViewer._volume = newVol;
    const video = document.getElementById('video-viewer');
    if (video) video.volume = newVol;
    if (MediaViewer._updateVolumeDisplay) {
      MediaViewer._updateVolumeDisplay();
    }
    SettingsManager.set('volume', newVol);
  },

  /**
   * 鼠标滚轮调节音量
   * 当鼠标在媒体容器上方时，滚轮调节音量而非缩放图片
   * 仅在视频/GIF 模式下生效，图片模式仍用滚轮缩放
   */
  _initScrollVolume() {
    const mediaContainer = document.getElementById('media-container');
    mediaContainer.addEventListener('wheel', (e) => {
      const file = MediaViewer.getCurrentFile();
      if (!file) return;
      const isVideoOrGif = file.type === 'video' || file.ext === '.gif';
      if (!isVideoOrGif) return;
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      this._adjustVolume(delta);
    }, { passive: false });
  },

  /**
   * 双击快捷操作：
   * - 空白区域双击左键 → 确认打标签
   * - 空白区域双击右键 → 撤回操作
   * 适用范围：文件查看窗口、分类面板空白区域
   */
  _initDoubleClickActions() {
    // 右键双击检测状态
    this._rightClickState = { target: null, time: 0 };

    // 判断点击位置是否为空白区域（排除按钮、标签芯片、输入框等）
    const isBlankArea = (target) => {
      if (!target) return false;
      const tag = target.tagName;
      if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'A') return false;
      if (target.closest('.tag-chip')) return false;
      if (target.closest('.btn-add-large')) return false;
      if (target.closest('#control-bar')) return false;
      if (target.closest('#action-bar')) return false;
      if (target.closest('#viewer-info-bar')) return false;
      if (target.closest('#progress-bar-container')) return false;
      return true;
    };

    // 左键双击 = 确认
    document.addEventListener('dblclick', (e) => {
      if (!isBlankArea(e.target)) return;
      // 确认打标签
      this.confirmTagging();
    });

    // 右键双击检测 = 撤回
    document.addEventListener('contextmenu', (e) => {
      if (!isBlankArea(e.target)) return;
      const now = Date.now();
      const prev = this._rightClickState;

      // 同一目标区域 400ms 内连续两次右键 → 视为双击
      if (prev.target === e.target && (now - prev.time) < 400) {
        e.preventDefault();
        e.stopPropagation();
        prev.target = null;
        prev.time = 0;
        this.undoTagging();
        return;
      }

      prev.target = e.target;
      prev.time = now;
    });
  },

  // ==================== 确认打标签 ====================

  /**
   * 确认打标签操作：
   * 1. 获取当前文件和选中的标签
   * 2. 重命名文件（在原文件夹内追加标签括号）
   * 3. 如果有分类后文件夹设置，将文件移动到该文件夹
   * 4. 从文件列表中移除该文件
   * 5. 写入历史记录，刷新视图
   */
  async confirmTagging() {
    const file = MediaViewer.getCurrentFile();
    if (!file) {
      alert('请先选择文件夹并加载媒体文件');
      return;
    }

    const settings = SettingsManager.get();

    // 强制要求必须先设置分类后文件夹
    if (!settings.moveTargetFolder) {
      alert('请先在菜单栏 文件 → 设置分类后文件夹 中选择目标文件夹');
      return;
    }

    const selectedTags = TagPanel.getSelectedTagNames();
    if (selectedTags.length === 0) {
      alert('请至少选择一个标签');
      return;
    }

    // 第一步：重命名文件（在原文件夹内）
    const renameResult = await window.electronAPI.renameFile(file.path, selectedTags);
    if (!renameResult.success && !renameResult.unchanged) {
      alert(`重命名失败: ${renameResult.error}`);
      return;
    }

    const renamedPath = renameResult.newPath || file.path;
    const newName = renameResult.newName || file.name;

    // 构建历史记录
    const record = {
      originalName: file.name,
      modifiedName: newName,
      originalPath: file.path,
      tags: selectedTags
    };

    // 第二步：移动文件到分类后文件夹
    const targetFolder = settings.moveTargetFolder.replace(/\\+$/, '');
    const moveResult = await window.electronAPI.moveFile(renamedPath, targetFolder);
    if (moveResult.success) {
      record.movedTo = moveResult.movedTo || targetFolder;
    } else {
      alert(`移动文件失败: ${moveResult.error}`);
      return;
    }

    // 第三步：从内存文件列表中移除该文件
    const files = MediaViewer.getFiles();
    const currentIdx = MediaViewer.getCurrentIndex();
    files.splice(currentIdx, 1);

    // 写入历史记录
    await HistoryManager.add(record);

    // 刷新视图
    if (files.length === 0) {
      MediaViewer._showEmpty(true);
      TagPanel.clearSelection();
    } else {
      let newIdx = currentIdx;
      if (newIdx >= files.length) newIdx = files.length - 1;
      MediaViewer._currentIndex = newIdx;
      await MediaViewer._loadCurrentFile();
      TagPanel.clearSelection();
    }
  },

  // ==================== 撤回操作 ====================

  /**
   * 撤回上一次打标签操作：
   * 1. 获取最后一条历史记录
   * 2. 撤回文件移动（移回源文件夹）+ 撤回重命名
   * 3. 删除历史记录
   * 4. 重新扫描源文件夹，定位到被撤回的文件
   */
  async undoTagging() {
    const lastRecord = HistoryManager.getLast();
    if (!lastRecord) {
      alert('没有可撤回的操作');
      return;
    }

    // 撤回移动 + 重命名
    const undoResult = await window.electronAPI.undoRename(lastRecord);
    if (!undoResult.success && !undoResult.unchanged) {
      alert(`撤回失败: ${undoResult.error}`);
      return;
    }

    // 删除历史记录
    await HistoryManager.removeLast();

    // 计算源文件夹路径（originalPath 的目录部分）
    const sourceFolder = lastRecord.originalPath.replace(/\\[^\\]+$/, '');

    // 重新扫描源文件夹
    const settings = SettingsManager.get();
    const res = await window.electronAPI.listMediaFiles(sourceFolder, settings.sortBy);

    if (res.success && res.files.length > 0) {
      MediaViewer._files = res.files;
      MediaViewer._folderPath = sourceFolder;
      MediaViewer._showEmpty(false);
      document.getElementById('folder-path-text').textContent = sourceFolder;
      document.getElementById('control-bar').style.display = 'flex';

      // 在刷新后的列表中定位被撤回的文件
      let targetIdx = res.files.findIndex(f => f.path === lastRecord.originalPath);
      if (targetIdx < 0) {
        targetIdx = res.files.findIndex(f => f.name === lastRecord.originalName);
      }

      if (targetIdx >= 0) {
        MediaViewer._currentIndex = targetIdx;
        await MediaViewer._loadCurrentFile();
        TagPanel.clearSelection();
        TagPanel.selectByNames(lastRecord.tags);
        this._showToast('已撤回上一次操作');
      } else {
        MediaViewer._currentIndex = 0;
        await MediaViewer._loadCurrentFile();
        TagPanel.clearSelection();
        this._showToast('已撤回，但文件可能已被移动');
      }
    } else {
      this._showToast('已撤回，但无法刷新文件夹');
    }
  },

  // ==================== 菜单栏事件监听 ====================

  _setupMenuListeners() {
    const api = window.electronAPI;

    api.onMenuEvent('menu-select-folder', async () => {
      const result = await api.selectFolder();
      if (result.success) {
        MediaViewer._folderPath = result.folderPath;
        await MediaViewer._loadFiles(SettingsManager.get().sortBy);
        await SettingsManager.set('lastOpenedFolder', result.folderPath);
      }
    });

    api.onMenuEvent('menu-sort-by', async (sortBy) => {
      await SettingsManager.set('sortBy', sortBy);
      await MediaViewer.reloadWithSort(sortBy);
    });

    api.onMenuEvent('menu-seek-seconds', async (seconds) => {
      await SettingsManager.set('seekSeconds', seconds);
    });

    api.onMenuEvent('menu-loop-files', async (loop) => {
      await SettingsManager.set('loopFileList', loop);
    });

    api.onMenuEvent('menu-shortcut-settings', () => {
      ShortcutsManager.renderSettingsPanel();
    });

    api.onMenuEvent('menu-reset-shortcuts', async () => {
      await SettingsManager.set('shortcuts', SettingsManager.DEFAULTS.shortcuts);
      await SettingsManager.set('tagShortcuts', SettingsManager.DEFAULTS.tagShortcuts);
      ShortcutsManager.reload();
      TagPanel._updateShortcutKeys();
      TagPanel._render();
    });

    api.onMenuEvent('menu-manage-common-tags', () => {
      this._renderCommonTagsManager();
    });

    api.onMenuEvent('menu-show-help', () => {
      this._renderHelpDialog();
    });

    // 设置分类后文件夹（菜单栏 → 文件 → 设置分类后文件夹）
    api.onMenuEvent('menu-set-move-folder', async () => {
      const result = await api.selectTargetFolder();
      if (result.success && result.folderPath) {
        // 校验：分类后文件夹必须与当前源文件夹不同
        const sourceFolder = MediaViewer.getFolderPath();
        if (sourceFolder && result.folderPath === sourceFolder) {
          alert('分类后文件夹不能与当前展示文件的文件夹相同，请选择其他文件夹');
          return;
        }
        await SettingsManager.set('moveTargetFolder', result.folderPath);
        // 更新顶部信息栏显示
        document.getElementById('move-folder-text').textContent = '→ ' + result.folderPath;
        this._showToast('分类后文件夹已设置为: ' + result.folderPath);
      }
    });

    api.onMenuEvent('menu-import-settings', async (importedSettings) => {
      await SettingsManager.importSettings(importedSettings);
      ShortcutsManager.reload();
      this._showToast('设置已导入');
    });

    api.onMenuEvent('menu-request-export-settings', async () => {
      await SettingsManager.exportToFile();
    });
  },

  // ==================== 面板分割线 ====================

  _initPanelResizer() {
    const resizer = document.getElementById('panel-resizer');
    const tagsPanel = document.getElementById('tags-panel');
    let isResizing = false, startX = 0, startWidth = 0;

    resizer.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = tagsPanel.offsetWidth;
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const dx = startX - e.clientX;
      const newWidth = Math.max(200, Math.min(450, startWidth + dx));
      tagsPanel.style.width = newWidth + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) { isResizing = false; document.body.style.cursor = ''; }
    });
  },

  // ==================== 常用标签管理器 ====================

  async _renderCommonTagsManager() {
    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');
    const commonTags = await window.electronAPI.readCommonTags();

    let html = '<h2>管理常用标签</h2>';
    html += '<p style="color:var(--text-muted);margin-bottom:12px;font-size:13px;">添加、删除常用的分类标签，方便快速复用</p>';
    html += '<div style="display:flex;gap:8px;margin-bottom:16px;">';
    html += '<input type="text" id="input-new-common-tag" placeholder="输入新常用标签名称" style="flex:1;">';
    html += '<button id="btn-add-common-tag" class="btn-primary">添加</button></div>';
    html += '<div id="common-tags-chips-container" style="display:flex;flex-wrap:wrap;gap:8px;max-height:300px;overflow-y:auto;padding:4px 0;">';
    if (commonTags.length === 0) {
      html += '<p style="color:var(--text-muted);font-style:italic;width:100%;">暂无常用标签</p>';
    } else {
      commonTags.forEach((name, i) => {
        html += `<div class="tag-chip common-tag-chip" data-index="${i}" style="cursor:pointer;" title="点击删除「${this._escapeHTML(name)}」"><span class="tag-name">${this._escapeHTML(name)}</span><span style="margin-left:2px;opacity:0.5;font-size:12px;">✕</span></div>`;
      });
    }
    html += '</div><p style="color:var(--text-muted);margin-top:8px;font-size:11px;font-style:italic;">点击标签即可删除</p>';
    html += '<div class="btn-row"><button id="btn-common-tags-manage-close" class="btn-secondary">关闭</button></div>';

    content.innerHTML = html;
    overlay.style.display = 'flex';

    document.getElementById('btn-add-common-tag').addEventListener('click', async () => {
      const input = document.getElementById('input-new-common-tag');
      const name = input.value.trim();
      if (!name) return;
      const tags = await window.electronAPI.readCommonTags();
      if (!tags.includes(name)) {
        tags.push(name);
        await window.electronAPI.writeCommonTags(tags);
        input.value = '';
        this._renderCommonTagsManager();
      } else { alert('该标签已存在'); }
    });

    content.querySelectorAll('.common-tag-chip').forEach(chip => {
      chip.addEventListener('click', async () => {
        const index = parseInt(chip.dataset.index);
        const tags = await window.electronAPI.readCommonTags();
        tags.splice(index, 1);
        await window.electronAPI.writeCommonTags(tags);
        this._renderCommonTagsManager();
      });
    });

    document.getElementById('btn-common-tags-manage-close').addEventListener('click', () => { overlay.style.display = 'none'; });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.style.display = 'none'; });
  },

  // ==================== 帮助/快捷键速查 ====================

  _renderHelpDialog() {
    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');
    const shortcuts = SettingsManager.getShortcuts();

    let html = '<h2>快捷键速查表</h2>';
    const categories = ShortcutsManager.ACTION_CATEGORIES;
    for (const [category, actions] of Object.entries(categories)) {
      html += `<h3 style="margin-top:12px;color:var(--text-secondary);font-size:14px;">${category}</h3>`;
      html += '<table class="shortcut-table"><thead><tr><th>功能</th><th>快捷键</th></tr></thead><tbody>';
      for (const action of actions) {
        const key = shortcuts[action] || '未设置';
        const label = ShortcutsManager.ACTION_LABELS[action] || action;
        html += `<tr><td>${label}</td><td><span class="shortcut-key">${key}</span></td></tr>`;
      }
      html += '</tbody></table>';
    }
    html += '<h3 style="margin-top:12px;color:var(--text-secondary);font-size:14px;">标签快捷键</h3>';
    html += '<p style="font-size:13px;color:var(--text-muted);">前9个标签: <strong>数字键 1-9</strong><br>第10-30个标签: 可在快捷键设置中自定义单个字母键<br>按对应键切换标签选中状态</p>';
    html += '<div class="btn-row"><button id="btn-help-close" class="btn-primary">关闭</button></div>';

    content.innerHTML = html;
    overlay.style.display = 'flex';
    document.getElementById('btn-help-close').addEventListener('click', () => { overlay.style.display = 'none'; });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.style.display = 'none'; });
  },

  // ==================== 工具方法 ====================

  async _restoreLastFolder() {
    const settings = SettingsManager.get();
    if (settings.lastOpenedFolder) {
      try {
        const result = await window.electronAPI.listMediaFiles(settings.lastOpenedFolder, settings.sortBy);
        if (result.success && result.files.length > 0) {
          MediaViewer._folderPath = settings.lastOpenedFolder;
          MediaViewer._files = result.files;
          MediaViewer._currentIndex = 0;
          MediaViewer._showEmpty(false);
          document.getElementById('folder-path-text').textContent = settings.lastOpenedFolder;
          document.getElementById('control-bar').style.display = 'flex';
          // 恢复分类文件夹路径显示
          if (settings.moveTargetFolder) {
            document.getElementById('move-folder-text').textContent = '→ ' + settings.moveTargetFolder;
          }
          await MediaViewer._loadCurrentFile();
        }
      } catch (e) { console.log('恢复上次文件夹失败:', e.message); }
    }
  },

  _updateCurrentFileDisplay() {
    const file = MediaViewer.getCurrentFile();
    if (file) {
      document.getElementById('file-name-text').textContent = file.name;
      document.getElementById('file-count-text').textContent = `(${MediaViewer.getCurrentIndex() + 1}/${MediaViewer.getFiles().length})`;
    }
  },

  _escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  _showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 3000);
  }
};

// ==================== 启动应用 ====================
document.addEventListener('DOMContentLoaded', () => { App.init(); });
