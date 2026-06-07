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
      // 更新音量百分比显示
      if (MediaViewer._updateVolumeDisplay) {
        MediaViewer._updateVolumeDisplay();
      }
    }

    // 4. 注册所有快捷键回调
    this._registerShortcuts();

    // 5. 设置文件切换回调（切换时清除标签选中）
    MediaViewer.onFileChange = (newIndex, file) => {
      TagPanel.clearSelection();
      // 如果新文件已有标签，预选中
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

  /**
   * 将所有功能注册到快捷键系统
   */
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
   * 调节视频音量
   * @param {number} delta - 音量变化量（±0.05）
   */
  _adjustVolume(delta) {
    const newVol = Math.max(0, Math.min(1, MediaViewer._volume + delta));
    MediaViewer._volume = newVol;
    const video = document.getElementById('video-viewer');
    if (video) video.volume = newVol;
    MediaViewer._updateVolumeDisplay();
    SettingsManager.set('volume', newVol);
  },

  // ==================== 确认打标签 ====================

  /**
   * 确认打标签操作
   * 1. 获取当前文件和选中的标签
   * 2. 重命名文件（追加标签括号）
   * 3. 如果需要移动，移动文件到分类文件夹
   * 4. 写入历史记录
   * 5. 清除标签选中，自动切换到下一个文件
   */
  async confirmTagging() {
    const file = MediaViewer.getCurrentFile();
    if (!file) {
      alert('请先选择文件夹并加载媒体文件');
      return;
    }

    const selectedTags = TagPanel.getSelectedTagNames();
    if (selectedTags.length === 0) {
      alert('请至少选择一个标签');
      return;
    }

    // 重命名文件
    const renameResult = await window.electronAPI.renameFile(file.path, selectedTags);
    if (!renameResult.success) {
      alert(`重命名失败: ${renameResult.error}`);
      return;
    }

    // 构建历史记录
    const record = {
      originalName: file.name,
      modifiedName: renameResult.newName,
      originalPath: file.path,
      tags: selectedTags
    };

    // 如果设置了分类文件夹，移动文件
    const settings = SettingsManager.get();
    if (settings.moveTargetFolder) {
      const targetFolder = `${settings.moveTargetFolder.replace(/\\+$/, '')}\\${selectedTags[0]}\\`;
      const moveResult = await window.electronAPI.moveFile(renameResult.newPath || file.path, targetFolder);
      if (moveResult.success) {
        record.movedTo = moveResult.movedTo || targetFolder;
        // 更新文件路径
        file.path = moveResult.newPath;
      }
    } else if (renameResult.newPath) {
      // 文件被重命名，更新路径
      file.path = renameResult.newPath;
    }

    // 更新文件列表中的名称
    if (renameResult.newName) {
      file.name = renameResult.newName;
      file.existingTags = selectedTags;
    }

    // 添加历史记录
    await HistoryManager.add(record);

    // 更新界面显示
    this._updateCurrentFileDisplay();

    // 清除标签选中并切换到下一个文件
    TagPanel.clearSelection();
    await MediaViewer.nextFile();
  },

  // ==================== 撤回操作 ====================

  /**
   * 撤回上一次打标签操作
   * 1. 获取最后一条历史记录
   * 2. 撤回文件重命名（和可能的文件移动）
   * 3. 删除历史记录
   * 4. 切换回被撤回的文件
   */
  async undoTagging() {
    const lastRecord = HistoryManager.getLast();
    if (!lastRecord) {
      alert('没有可撤回的操作');
      return;
    }

    // 撤回重命名
    const result = await window.electronAPI.undoRename(lastRecord);
    if (!result.success) {
      alert(`撤回失败: ${result.error}`);
      return;
    }

    // 删除历史记录
    await HistoryManager.removeLast();

    // 重要：撤回后重新扫描文件列表，因为文件名已变化
    // 当前文件列表中的 name 和 path 可能已过时
    const files = MediaViewer.getFiles();

    // 先尝试在文件列表中找到被撤回的原始名对应的条目并恢复其 name
    // 撤回后文件名已复原，在文件列表中将对应条目的 name 恢复
    for (const f of files) {
      // 按修改后名匹配：找到那个被重命名过的条目
      if (f.name === lastRecord.modifiedName) {
        f.name = lastRecord.originalName;
        f.existingTags = [];
        break;
      }
    }

    // 通过原始路径查找目标索引
    let targetIndex = files.findIndex(
      f => f.path === lastRecord.originalPath
    );

    // 如果按 path 找不到，尝试按 name 匹配
    if (targetIndex < 0) {
      targetIndex = files.findIndex(
        f => f.name === lastRecord.originalName
      );
    }

    // 如果还是找不到（文件已被移动到其他位置等），退而求其次用当前索引
    if (targetIndex >= 0) {
      await MediaViewer.goToFile(targetIndex);
      // 恢复标签选中状态
      TagPanel.clearSelection();
      TagPanel.selectByNames(lastRecord.tags);
    } else {
      // 最后的兜底：尝试重新扫描一次文件夹
      const folderPath = MediaViewer.getFolderPath();
      if (folderPath) {
        const res = await window.electronAPI.listMediaFiles(folderPath, SettingsManager.get().sortBy);
        if (res.success && res.files.length > 0) {
          MediaViewer._files = res.files;
          // 在重新扫描后的列表中定位目标
          const newIdx = res.files.findIndex(
            f => f.path === lastRecord.originalPath || f.name === lastRecord.originalName
          );
          if (newIdx >= 0) {
            MediaViewer._currentIndex = newIdx;
            await MediaViewer._loadCurrentFile();
            TagPanel.clearSelection();
            TagPanel.selectByNames(lastRecord.tags);
          } else {
            this._updateCurrentFileDisplay();
          }
        }
      } else {
        this._updateCurrentFileDisplay();
      }
    }

    this._showToast('已撤回上一次操作');
  },

  // ==================== 菜单栏事件监听 ====================

  /**
   * 注册所有菜单栏事件的监听器
   */
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
      ShortcutsManager.reload();
    });

    api.onMenuEvent('menu-manage-common-tags', () => {
      this._renderCommonTagsManager();
    });

    api.onMenuEvent('menu-show-help', () => {
      this._renderHelpDialog();
    });

    api.onMenuEvent('menu-set-move-folder', async () => {
      const result = await api.selectTargetFolder();
      if (result.success) {
        await SettingsManager.set('moveTargetFolder', result.folderPath);
        this._showToast(`分类根目录已设置为: ${result.folderPath}`);
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

  /**
   * 初始化左右面板之间的拖拽分割线
   */
  _initPanelResizer() {
    const resizer = document.getElementById('panel-resizer');
    const tagsPanel = document.getElementById('tags-panel');
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

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
      if (isResizing) {
        isResizing = false;
        document.body.style.cursor = '';
      }
    });
  },

  // ==================== 常用标签管理器 ====================

  /**
   * 渲染常用标签管理面板（标签芯片风格，与分类窗口一致）
   */
  async _renderCommonTagsManager() {
    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');
    const commonTags = await window.electronAPI.readCommonTags();

    let html = '<h2>管理常用标签</h2>';
    html += '<p style="color: var(--text-muted); margin-bottom: 12px; font-size: 13px;">添加、删除常用的分类标签，方便快速复用</p>';

    // 新增标签输入
    html += '<div style="display: flex; gap: 8px; margin-bottom: 16px;">';
    html += '<input type="text" id="input-new-common-tag" placeholder="输入新常用标签名称" style="flex:1;">';
    html += '<button id="btn-add-common-tag" class="btn-primary">添加</button>';
    html += '</div>';

    // 标签芯片列表（flex-wrap 布局，与分类窗口一致）
    html += '<div id="common-tags-chips-container" style="display:flex; flex-wrap:wrap; gap:8px; max-height:300px; overflow-y:auto; padding:4px 0;">';
    if (commonTags.length === 0) {
      html += '<p style="color: var(--text-muted); font-style: italic; width:100%;">暂无常用标签</p>';
    } else {
      commonTags.forEach((name, i) => {
        html += `
          <div class="tag-chip common-tag-chip" data-index="${i}" style="cursor:pointer;" title="点击删除「${this._escapeHTML(name)}」">
            <span class="tag-name">${this._escapeHTML(name)}</span>
            <span class="tag-delete-x" style="margin-left:2px; opacity:0.5; font-size:12px;">✕</span>
          </div>`;
      });
    }
    html += '</div>';
    html += '<p style="color: var(--text-muted); margin-top:8px; font-size:11px; font-style:italic;">点击标签即可删除</p>';

    html += '<div class="btn-row">';
    html += '<button id="btn-common-tags-manage-close" class="btn-secondary">关闭</button>';
    html += '</div>';

    content.innerHTML = html;
    overlay.style.display = 'flex';

    // 添加标签
    document.getElementById('btn-add-common-tag').addEventListener('click', async () => {
      const input = document.getElementById('input-new-common-tag');
      const name = input.value.trim();
      if (!name) return;
      const tags = await window.electronAPI.readCommonTags();
      if (!tags.includes(name)) {
        tags.push(name);
        await window.electronAPI.writeCommonTags(tags);
        input.value = '';
        this._renderCommonTagsManager(); // 刷新列表
      } else {
        alert('该标签已存在');
      }
    });

    // 点击标签芯片删除
    content.querySelectorAll('.common-tag-chip').forEach(chip => {
      chip.addEventListener('click', async () => {
        const index = parseInt(chip.dataset.index);
        const tags = await window.electronAPI.readCommonTags();
        tags.splice(index, 1);
        await window.electronAPI.writeCommonTags(tags);
        this._renderCommonTagsManager(); // 刷新列表
      });
    });

    // 关闭
    document.getElementById('btn-common-tags-manage-close').addEventListener('click', () => {
      overlay.style.display = 'none';
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.style.display = 'none';
    });
  },

  // ==================== 帮助/快捷键速查 ====================

  /**
   * 渲染快捷键速查帮助弹窗
   */
  _renderHelpDialog() {
    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');
    const shortcuts = SettingsManager.getShortcuts();

    let html = '<h2>快捷键速查表</h2>';

    const categories = ShortcutsManager.ACTION_CATEGORIES;
    for (const [category, actions] of Object.entries(categories)) {
      html += `<h3 style="margin-top: 12px; color: var(--text-secondary); font-size: 14px;">${category}</h3>`;
      html += '<table class="shortcut-table"><thead><tr><th>功能</th><th>快捷键</th></tr></thead><tbody>';
      for (const action of actions) {
        const key = shortcuts[action] || '未设置';
        const label = ShortcutsManager.ACTION_LABELS[action] || action;
        html += `<tr><td>${label}</td><td><span class="shortcut-key">${key}</span></td></tr>`;
      }
      html += '</tbody></table>';
    }

    // 标签快捷键说明
    html += '<h3 style="margin-top: 12px; color: var(--text-secondary); font-size: 14px;">标签快捷键</h3>';
    html += '<p style="font-size: 13px; color: var(--text-muted);">前9个标签: <strong>数字键 1-9</strong><br>第10-30个标签: 可在快捷键设置中自定义单个字母键<br>按对应键切换标签选中状态</p>';

    html += '<div class="btn-row">';
    html += '<button id="btn-help-close" class="btn-primary">关闭</button>';
    html += '</div>';

    content.innerHTML = html;
    overlay.style.display = 'flex';

    document.getElementById('btn-help-close').addEventListener('click', () => {
      overlay.style.display = 'none';
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.style.display = 'none';
    });
  },

  // ==================== 工具方法 ====================

  /**
   * 恢复上次打开的文件夹
   */
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
          await MediaViewer._loadCurrentFile();
        }
      } catch (e) {
        // 文件夹可能不存在了，忽略
        console.log('恢复上次文件夹失败:', e.message);
      }
    }
  },

  /** 更新当前文件信息显示 */
  _updateCurrentFileDisplay() {
    const file = MediaViewer.getCurrentFile();
    if (file) {
      document.getElementById('file-name-text').textContent = file.name;
      document.getElementById('file-count-text').textContent =
        `(${MediaViewer.getCurrentIndex() + 1}/${MediaViewer.getFiles().length})`;
    }
  },

  /** HTML 转义 */
  _escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  /** 显示提示消息 */
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

// ==================== 启动应用 ====================
// 在 DOM 加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
