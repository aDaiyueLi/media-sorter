/**
 * mediaViewer.js - 媒体查看器
 * 负责图片/视频/GIF 的加载、显示与控制
 *
 * 图片：缩放（鼠标滚轮/上下键）、拖拽平移、旋转
 * 视频：播放/暂停、快进快退、音量、自定义控制栏
 * GIF：播放/暂停（canvas 冻结帧方案）
 * 文件导航：上/下一个文件、文件列表管理
 */

const MediaViewer = {
  // ==================== DOM 引用 ====================

  _elements: {},

  // ==================== 状态 ====================

  /** 当前文件列表 */
  _files: [],
  /** 当前文件索引 */
  _currentIndex: -1,
  /** 当前文件夹路径 */
  _folderPath: '',
  /** 当前媒体类型: 'image' | 'video' */
  _mediaType: null,

  // 图片状态
  _imgScale: 1,          // 图片缩放比例 (0.1 ~ 5.0)
  _imgTranslateX: 0,     // 图片 X 偏移 (px)
  _imgTranslateY: 0,     // 图片 Y 偏移 (px)
  _imgRotation: 0,       // 图片旋转角度 (0/90/180/270 度)
  _isDragging: false,
  _dragStartX: 0,
  _dragStartY: 0,
  _dragStartTranslateX: 0,
  _dragStartTranslateY: 0,

  // 视频状态
  _volume: 0.8,
  _isVideoPlaying: false,

  // GIF 状态
  _isGifPaused: false,
  _gifCanvas: null,      // 暂停时捕获的帧 canvas
  _gifSrc: '',           // GIF 原始 src

  // ==================== 回调 ====================

  /** 文件切换时的回调 (newIndex, oldIndex) → void */
  onFileChange: null,

  // ==================== 初始化 ====================

  /**
   * 初始化媒体查看器，缓存 DOM 引用并绑定事件
   */
  init() {
    this._elements = {
      folderPathText: document.getElementById('folder-path-text'),
      fileNameText: document.getElementById('file-name-text'),
      fileCountText: document.getElementById('file-count-text'),
      mediaContainer: document.getElementById('media-container'),
      mediaEmptyState: document.getElementById('media-empty-state'),
      imageViewer: document.getElementById('image-viewer'),
      videoViewer: document.getElementById('video-viewer'),
      mediaLoading: document.getElementById('media-loading'),
      controlBar: document.getElementById('control-bar'),
      btnPlayPause: document.getElementById('btn-play-pause'),
      btnSeekBack: document.getElementById('btn-seek-back'),
      btnSeekForward: document.getElementById('btn-seek-forward'),
      progressBar: document.getElementById('progress-bar'),
      timeCurrent: document.getElementById('time-current'),
      timeDuration: document.getElementById('time-duration'),
      volumeSlider: document.getElementById('volume-slider'),
      btnVolumeIcon: document.getElementById('btn-volume-icon'),
      volumeDisplay: document.getElementById('volume-display'),
      btnPrevFile: document.getElementById('btn-prev-file'),
      btnNextFile: document.getElementById('btn-next-file'),
      btnRotate: document.getElementById('btn-rotate'),
      btnAddFolderLeft: document.getElementById('btn-add-folder-left'),
      folderPath: document.getElementById('folder-path')
    };

    this._bindEvents();
  },

  // ==================== 事件绑定 ====================

  /**
   * 绑定所有媒体查看器相关事件
   */
  _bindEvents() {
    const el = this._elements;

    // 文件夹选择事件
    el.btnAddFolderLeft.addEventListener('click', () => this._onSelectFolder());
    el.folderPath.addEventListener('click', () => this._onSelectFolder());

    // 图片事件
    el.imageViewer.addEventListener('mousedown', (e) => this._onImageMouseDown(e));
    el.imageViewer.addEventListener('wheel', (e) => this._onImageWheel(e), { passive: false });

    // 视频事件
    el.videoViewer.addEventListener('timeupdate', () => this._onVideoTimeUpdate());
    el.videoViewer.addEventListener('loadedmetadata', () => this._onVideoLoaded());
    el.videoViewer.addEventListener('ended', () => this._onVideoEnded());
    el.videoViewer.addEventListener('play', () => this._onVideoPlayState(true));
    el.videoViewer.addEventListener('pause', () => this._onVideoPlayState(false));

    // 控制栏按钮
    el.btnPlayPause.addEventListener('click', () => this.togglePlayPause());
    el.btnSeekBack.addEventListener('click', () => this.seekBackward());
    el.btnSeekForward.addEventListener('click', () => this.seekForward());
    el.progressBar.addEventListener('input', () => this._onProgressInput());
    el.progressBar.addEventListener('change', () => this._onProgressChange());
    el.btnVolumeIcon.addEventListener('click', () => this._onToggleMute());

    // 移除音量滑块引用 —— 改用百分比显示
    delete el.volumeSlider;

    // 文件导航
    el.btnPrevFile.addEventListener('click', () => this.previousFile());
    el.btnNextFile.addEventListener('click', () => this.nextFile());
    el.btnRotate.addEventListener('click', () => this.rotate());

    // 全局鼠标事件（图片拖拽）
    document.addEventListener('mousemove', (e) => this._onImageMouseMove(e));
    document.addEventListener('mouseup', () => this._onImageMouseUp());
  },

  // ==================== 文件夹加载 ====================

  /** 点击选择文件夹后的处理流程 */
  async _onSelectFolder() {
    const result = await window.electronAPI.selectFolder();
    if (!result.success) return;

    this._folderPath = result.folderPath;
    const settings = SettingsManager.get();
    await this._loadFiles(settings.sortBy);

    // 保存上次打开文件夹
    await SettingsManager.set('lastOpenedFolder', this._folderPath);
  },

  /**
   * 扫描并加载文件列表
   * @param {string} sortBy - 排序方式
   */
  async _loadFiles(sortBy) {
    this._showLoading(true);
    const result = await window.electronAPI.listMediaFiles(this._folderPath, sortBy);
    this._showLoading(false);

    if (!result.success || result.files.length === 0) {
      this._files = [];
      this._currentIndex = -1;
      this._showEmpty(true);
      alert(result.error || '该文件夹中没有媒体文件');
      return;
    }

    this._files = result.files;
    this._currentIndex = 0;
    this._showEmpty(false);
    this._elements.folderPathText.textContent = this._folderPath;
    this._elements.controlBar.style.display = 'flex';
    await this._loadCurrentFile();
  },

  /**
   * 加载当前索引的文件
   * 根据文件类型切换到图片或视频模式
   */
  async _loadCurrentFile() {
    if (this._currentIndex < 0 || this._currentIndex >= this._files.length) return;

    const file = this._files[this._currentIndex];
    this._mediaType = file.type;

    // 将本地文件路径转换为 file:// URL（Electron 安全策略允许）
    const fileURL = this._pathToFileURL(file.path);

    // 更新信息栏
    this._elements.fileNameText.textContent = file.name;
    this._elements.fileCountText.textContent =
      `(${this._currentIndex + 1}/${this._files.length})`;

    // 隐藏两个查看器
    this._elements.imageViewer.style.display = 'none';
    this._elements.videoViewer.style.display = 'none';

    // 重置图片状态
    this._resetImageState();

    // 判断是否为 GIF（GIF 用图片加载但需要特殊处理）
    const isGif = file.ext === '.gif';

    if (file.type === 'image' && !isGif) {
      // 普通图片
      await this._loadImage(fileURL);
    } else if (isGif) {
      // GIF：先当图片加载（带动画），提供暂停控制
      await this._loadImage(fileURL);
      this._isGifPaused = false;
      this._gifSrc = fileURL;
      this._gifCanvas = null;
    } else {
      // 视频
      await this._loadVideo(fileURL);
    }

    // 更新控制栏按钮状态
    this._updateControlBar();

    // 通知文件切换
    if (this.onFileChange) {
      this.onFileChange(this._currentIndex, this._files[this._currentIndex]);
    }
  },

  /**
   * 将文件系统路径转为 file:// URL
   * Windows 路径如 C:\path\to\file.jpg → file:///C:/path/to/file.jpg
   * @param {string} filePath - 文件系统绝对路径
   * @returns {string} file:// URL
   */
  _pathToFileURL(filePath) {
    // 将反斜杠替换为正斜杠
    let url = filePath.replace(/\\/g, '/');
    // 添加 file:/// 前缀（Windows 路径不需要额外斜杠，因为盘符自带 :）
    if (!url.startsWith('file://')) {
      url = 'file:///' + encodeURI(url);
    }
    return url;
  },

  /** 显示/隐藏加载指示器 */
  _showLoading(show) {
    this._elements.mediaLoading.style.display = show ? 'flex' : 'none';
  },

  /** 显示/隐藏空状态 */
  _showEmpty(show) {
    this._elements.mediaEmptyState.style.display = show ? 'flex' : 'none';
    if (show) {
      this._elements.controlBar.style.display = 'none';
      this._elements.folderPathText.textContent = '未选择文件夹';
      this._elements.fileNameText.textContent = '';
      this._elements.fileCountText.textContent = '';
    }
  },

  // ==================== 图片加载与控制 ====================

  /**
   * 加载图片文件
   * @param {string} fileURL - 图片 file:// URL
   */
  async _loadImage(fileURL) {
    const img = this._elements.imageViewer;
    this._elements.videoViewer.style.display = 'none';

    return new Promise((resolve) => {
      img.onload = () => {
        img.style.display = 'block';
        // 重置缩放和平移到初始状态
        this._resetImageState();
        img.style.transform = this._getImageTransform();
        resolve();
      };
      img.onerror = () => {
        img.style.display = 'none';
        alert('无法加载图片文件');
        resolve();
      };
      img.src = fileURL;
    });
  },

  /** 重置图片缩放、平移、旋转状态 */
  _resetImageState() {
    this._imgScale = 1;
    this._imgTranslateX = 0;
    this._imgTranslateY = 0;
    this._imgRotation = 0;
    this._isDragging = false;
    this._isGifPaused = false;
    this._gifCanvas = null;
  },

  /**
   * 获取图片当前的 CSS transform 字符串
   * @returns {string} 如 'scale(1.5) translate(10px, 20px) rotate(90deg)'
   */
  _getImageTransform() {
    return `scale(${this._imgScale}) translate(${this._imgTranslateX}px, ${this._imgTranslateY}px) rotate(${this._imgRotation}deg)`;
  },

  /** 鼠标按下开始拖拽 */
  _onImageMouseDown(e) {
    if (this._mediaType !== 'image') return;
    this._isDragging = true;
    this._dragStartX = e.clientX;
    this._dragStartY = e.clientY;
    this._dragStartTranslateX = this._imgTranslateX;
    this._dragStartTranslateY = this._imgTranslateY;
    e.preventDefault();
  },

  /** 鼠标移动拖拽中 */
  _onImageMouseMove(e) {
    if (!this._isDragging || this._mediaType !== 'image') return;
    const dx = e.clientX - this._dragStartX;
    const dy = e.clientY - this._dragStartY;
    this._imgTranslateX = this._dragStartTranslateX + dx / this._imgScale;
    this._imgTranslateY = this._dragStartTranslateY + dy / this._imgScale;
    this._elements.imageViewer.style.transform = this._getImageTransform();
  },

  /** 鼠标松开结束拖拽 */
  _onImageMouseUp() {
    this._isDragging = false;
  },

  /**
   * 鼠标滚轮缩放图片
   * 以鼠标位置为中心缩放
   */
  _onImageWheel(e) {
    if (this._mediaType !== 'image') return;
    e.preventDefault();

    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const newScale = Math.max(0.1, Math.min(5.0, this._imgScale + delta));

    // 计算鼠标相对于图片的位置，实现以鼠标为中心的缩放
    const rect = this._elements.mediaContainer.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // 调整平移量以保持鼠标位置不变
    const scaleChange = newScale / this._imgScale;
    this._imgTranslateX = mouseX + (this._imgTranslateX - mouseX / this._imgScale) * this._imgScale;
    this._imgTranslateX = this._imgTranslateX / scaleChange;
    this._imgTranslateX = (mouseX + (this._imgTranslateX - mouseX / this._imgScale) * this._imgScale) / scaleChange;

    // 简化版：保持中心缩放
    this._imgScale = newScale;
    this._elements.imageViewer.style.transform = this._getImageTransform();
  },

  /**
   * 通过上下方向键缩放图片
   * @param {string} direction - 'in' 放大 | 'out' 缩小
   */
  zoom(direction) {
    if (this._mediaType !== 'image') return;
    const delta = direction === 'in' ? 0.1 : -0.1;
    this._imgScale = Math.max(0.1, Math.min(5.0, this._imgScale + delta));
    this._elements.imageViewer.style.transform = this._getImageTransform();
  },

  /**
   * 顺时针旋转图片 90°
   */
  rotate() {
    if (this._mediaType === 'video') return; // 视频不支持旋转
    this._imgRotation = (this._imgRotation + 90) % 360;
    this._elements.imageViewer.style.transform = this._getImageTransform();
  },

  // ==================== 视频加载与控制 ====================

  /**
   * 加载视频文件
   * @param {string} fileURL - 视频 file:// URL
   */
  async _loadVideo(fileURL) {
    const video = this._elements.videoViewer;
    this._elements.imageViewer.style.display = 'none';

    return new Promise((resolve) => {
      video.onloadedmetadata = () => {
        video.style.display = 'block';
        // 恢复音量记忆
        video.volume = this._volume;
        // 更新音量百分比显示
        this._updateVolumeDisplay();
        // 更新时长显示
        this._elements.timeDuration.textContent = this._formatTime(video.duration);
        this._elements.progressBar.max = video.duration;
        // 自动播放
        video.play().catch(() => {});
        resolve();
      };
      video.onerror = () => {
        video.style.display = 'none';
        alert('无法加载视频文件');
        resolve();
      };
      video.src = fileURL;
      video.load();
    });
  },

  /**
   * 切换播放/暂停
   * 对于图片模式的 GIF，使用 canvas 冻结帧方案
   */
  togglePlayPause() {
    if (this._mediaType === 'video') {
      const video = this._elements.videoViewer;
      if (video.paused) {
        video.play();
      } else {
        video.pause();
      }
    } else if (this._mediaType === 'image') {
      // GIF 播放/暂停
      this._toggleGifPause();
    }
  },

  /** 快退 seekSeconds 秒 */
  seekBackward() {
    if (this._mediaType !== 'video') return;
    const seconds = SettingsManager.get().seekSeconds || 5;
    const video = this._elements.videoViewer;
    video.currentTime = Math.max(0, video.currentTime - seconds);
  },

  /** 快进 seekSeconds 秒 */
  seekForward() {
    if (this._mediaType !== 'video') return;
    const seconds = SettingsManager.get().seekSeconds || 5;
    const video = this._elements.videoViewer;
    video.currentTime = Math.min(video.duration || Infinity, video.currentTime + seconds);
  },

  /** 视频时间更新回调：同步进度条和时间显示 */
  _onVideoTimeUpdate() {
    const video = this._elements.videoViewer;
    const progress = this._elements.progressBar;
    if (!video.duration) return;
    progress.value = video.currentTime;
    this._elements.timeCurrent.textContent = this._formatTime(video.currentTime);
  },

  /** 视频元数据加载完成 */
  _onVideoLoaded() {
    const video = this._elements.videoViewer;
    video.volume = this._volume;
    this._updateVolumeDisplay();
    this._elements.timeDuration.textContent = this._formatTime(video.duration);
    this._elements.progressBar.max = video.duration;
  },

  /** 视频播放结束 */
  _onVideoEnded() {
    // 不自动循环，停留在最后一帧
  },

  /** 视频播放状态变更同步按钮图标 */
  _onVideoPlayState(playing) {
    this._isVideoPlaying = playing;
    this._elements.btnPlayPause.textContent = playing ? '⏸' : '⏵';
    if (playing) {
      this._elements.btnPlayPause.classList.add('playing');
    } else {
      this._elements.btnPlayPause.classList.remove('playing');
    }
  },

  /** 进度条拖拽中（实时） */
  _onProgressInput() {
    const video = this._elements.videoViewer;
    const progress = this._elements.progressBar;
    this._elements.timeCurrent.textContent = this._formatTime(parseFloat(progress.value));
  },

  /** 进度条拖拽完成（跳转） */
  _onProgressChange() {
    const video = this._elements.videoViewer;
    const progress = this._elements.progressBar;
    video.currentTime = parseFloat(progress.value);
  },

  /** 音量滑块变化 —— 已废弃，改用 +/- 快捷键调节并显示百分比 */
  _onVolumeInput() {
    // 此方法已不再被调用（音量滑块已移除）
    // 保留空实现以防旧代码引用
  },

  /** 静音切换 */
  _onToggleMute() {
    const video = this._elements.videoViewer;
    if (this._volume > 0) {
      // 暂存并静音
      this._volumeBeforeMute = this._volume;
      this._volume = 0;
    } else {
      // 恢复
      this._volume = this._volumeBeforeMute || 0.8;
    }
    if (this._mediaType === 'video') {
      video.volume = this._volume;
    }
    this._updateVolumeIcon(this._volume);
    this._updateVolumeDisplay();
    SettingsManager.set('volume', this._volume);
  },

  /**
   * 更新音量百分比显示文字
   */
  _updateVolumeDisplay() {
    const display = this._elements.volumeDisplay;
    if (display) {
      display.textContent = Math.round(this._volume * 100) + '%';
    }
  },

  /** 根据音量更新喇叭图标 */
  _updateVolumeIcon(volume) {
    const icon = this._elements.btnVolumeIcon;
    if (volume === 0) {
      icon.textContent = '🔇';
    } else if (volume < 0.3) {
      icon.textContent = '🔈';
    } else if (volume < 0.7) {
      icon.textContent = '🔉';
    } else {
      icon.textContent = '🔊';
    }
  },

  // ==================== GIF 播放/暂停控制 ====================

  /**
   * 切换 GIF 播放/暂停
   * 暂停时：用 canvas 捕获当前帧并替换 img 显示
   * 恢复时：重新加载原始 GIF 并恢复动画
   */
  _toggleGifPause() {
    const img = this._elements.imageViewer;
    const file = this._files[this._currentIndex];
    if (!file || file.ext !== '.gif') return;

    if (this._isGifPaused) {
      // 恢复播放：重新加载 GIF
      img.src = '';
      img.src = this._gifSrc;
      this._isGifPaused = false;
      this._gifCanvas = null;
      this._elements.btnPlayPause.textContent = '⏵';
    } else {
      // 暂停：用 canvas 捕获当前帧
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      this._gifCanvas = canvas;
      // 将 img 的 src 替换为 canvas 的静态帧
      img.src = canvas.toDataURL();
      this._isGifPaused = true;
      this._elements.btnPlayPause.textContent = '▶';
    }
  },

  // ==================== 文件导航 ====================

  /**
   * 切换到上一个文件
   * 到达边界时根据 loopFileList 设置决定是否循环
   */
  async previousFile() {
    if (this._files.length === 0) return;
    const settings = SettingsManager.get();
    let newIndex = this._currentIndex - 1;
    if (newIndex < 0) {
      if (settings.loopFileList) {
        newIndex = this._files.length - 1;
      } else {
        this._showToast('已到达第一个文件');
        return;
      }
    }
    this._currentIndex = newIndex;
    await this._loadCurrentFile();
  },

  /**
   * 切换到下一个文件
   */
  async nextFile() {
    if (this._files.length === 0) return;
    const settings = SettingsManager.get();
    let newIndex = this._currentIndex + 1;
    if (newIndex >= this._files.length) {
      if (settings.loopFileList) {
        newIndex = 0;
      } else {
        this._showToast('已到达最后一个文件');
        return;
      }
    }
    this._currentIndex = newIndex;
    await this._loadCurrentFile();
  },

  /**
   * 切换到指定索引的文件
   * @param {number} index - 目标索引
   */
  async goToFile(index) {
    if (index < 0 || index >= this._files.length) return;
    this._currentIndex = index;
    await this._loadCurrentFile();
  },

  /**
   * 重新加载当前文件列表（排序方式变更时调用）
   * @param {string} sortBy - 新排序方式
   */
  async reloadWithSort(sortBy) {
    if (!this._folderPath) return;
    const currentFilePath = this._files.length > 0 && this._currentIndex >= 0
      ? this._files[this._currentIndex].path
      : null;

    await this._loadFiles(sortBy);

    // 尝试恢复到之前查看的文件
    if (currentFilePath) {
      const idx = this._files.findIndex(f => f.path === currentFilePath);
      if (idx >= 0) {
        this._currentIndex = idx;
        await this._loadCurrentFile();
      }
    }
  },

  // ==================== 工具方法 ====================

  /**
   * 格式化秒数为 mm:ss 显示格式
   * @param {number} seconds - 秒数
   * @returns {string} 如 '02:35'
   */
  _formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  },

  /**
   * 显示短暂的提示消息
   * @param {string} message - 提示文本
   */
  _showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    // 3秒后自动移除
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 3000);
  },

  /**
   * 根据当前媒体类型更新控制栏按钮可见性
   */
  _updateControlBar() {
    const isVideo = this._mediaType === 'video';
    const file = this._files[this._currentIndex];
    const isGif = file && file.ext === '.gif';

    // 视频/GIF 时显示播放控制，图片时不显示
    const mediaControls = document.getElementById('media-controls');
    mediaControls.style.display = (isVideo || isGif) ? 'flex' : 'none';

    // 播放/暂停按钮文案
    if (isVideo) {
      this._elements.btnPlayPause.textContent = this._isVideoPlaying ? '⏸' : '⏵';
    } else if (isGif) {
      this._elements.btnPlayPause.textContent = this._isGifPaused ? '▶' : '⏸';
    }

    // 旋转按钮：视频不支持
    this._elements.btnRotate.style.display = isVideo ? 'none' : 'inline-flex';
  },

  /** 获取当前文件对象 */
  getCurrentFile() {
    if (this._currentIndex >= 0 && this._files.length > 0) {
      return this._files[this._currentIndex];
    }
    return null;
  },

  /** 获取文件列表 */
  getFiles() {
    return this._files;
  },

  /** 获取当前索引 */
  getCurrentIndex() {
    return this._currentIndex;
  },

  /** 获取文件夹路径 */
  getFolderPath() {
    return this._folderPath;
  }
};
