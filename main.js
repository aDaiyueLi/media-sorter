/**
 * main.js - Electron 主进程
 * 负责窗口管理、原生菜单栏、文件系统操作、JSON 数据读写
 * 通过 IPC 与渲染进程通信，处理所有需要 Node.js 能力的请求
 */

const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// ==================== 全局状态 ====================
let mainWindow = null;

// ==================== 路径工具 ====================

/** 获取用户数据目录，存放 settings.json / common-tags.json / tag-history.json */
function getDataDir() {
  const dir = path.join(app.getPath('userData'), 'data');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** 获取指定 JSON 数据文件的完整路径 */
function getDataPath(filename) {
  return path.join(getDataDir(), filename);
}

/** 安全读取 JSON 文件，不存在时返回默认值 */
function readJSON(filename, defaultValue) {
  const filePath = getDataPath(filename);
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error(`读取 ${filename} 失败:`, err.message);
  }
  return defaultValue;
}

/** 安全写入 JSON 文件（格式化缩进，便于用户手动编辑） */
function writeJSON(filename, data) {
  const filePath = getDataPath(filename);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return { success: true };
  } catch (err) {
    console.error(`写入 ${filename} 失败:`, err.message);
    return { success: false, error: err.message };
  }
}

// ==================== 文件系统操作 ====================

/** 支持的媒体文件扩展名 */
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif'];
const VIDEO_EXTENSIONS = ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv'];
const ALL_MEDIA_EXTENSIONS = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS];

/**
 * 扫描目录中的媒体文件
 * @param {string} folderPath - 文件夹绝对路径
 * @param {string} sortBy - 排序方式: 'name' | 'date' | 'size'
 * @returns {{success: boolean, files: Array, error?: string}}
 *   每个文件对象包含: name, path, ext, type('image'|'video'), size, mtime, existingTags
 */
function listMediaFiles(folderPath, sortBy) {
  try {
    if (!fs.existsSync(folderPath)) {
      return { success: false, error: `文件夹不存在: ${folderPath}` };
    }

    const stat = fs.statSync(folderPath);
    if (!stat.isDirectory()) {
      return { success: false, error: '所选路径不是文件夹' };
    }

    // 读取目录下所有文件
    const allFiles = fs.readdirSync(folderPath);
    const mediaFiles = [];

    for (const filename of allFiles) {
      const ext = path.extname(filename).toLowerCase();
      if (!ALL_MEDIA_EXTENSIONS.includes(ext)) continue;

      const filePath = path.join(folderPath, filename);
      const fileStat = fs.statSync(filePath);
      if (!fileStat.isFile()) continue;

      // 判断文件类型
      const isImage = IMAGE_EXTENSIONS.includes(ext);
      const isVideo = VIDEO_EXTENSIONS.includes(ext);
      const fileType = isImage ? 'image' : 'video';

      // 解析文件名中已有的标签
      // 使用正则匹配文件名最末尾的 (tag1_tag2) 格式
      // 例如 photo(1)(风景_旅行).jpg → 识别出 ['风景', '旅行']
      const nameWithoutExt = path.basename(filename, ext);
      const tagMatch = nameWithoutExt.match(/\(([^)]+)\)$/);
      let existingTags = [];
      if (tagMatch) {
        // 括号内的内容用 _ 分隔即视为标签
        existingTags = tagMatch[1].split('_').filter(t => t.trim());
      }

      mediaFiles.push({
        name: filename,
        path: filePath,
        ext: ext,
        type: fileType,
        size: fileStat.size,
        mtime: fileStat.mtime.toISOString(),
        existingTags: existingTags
      });
    }

    // 排序处理
    switch (sortBy) {
      case 'date':
        mediaFiles.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
        break;
      case 'size':
        mediaFiles.sort((a, b) => b.size - a.size);
        break;
      case 'name':
      default:
        mediaFiles.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
        break;
    }

    return { success: true, files: mediaFiles };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * 重命名文件 —— 在文件名末尾追加或替换标签括号
 * @param {string} filePath - 原文件绝对路径
 * @param {string[]} tags - 标签数组
 * @returns {{success: boolean, newName?: string, newPath?: string, error?: string}}
 */
function renameFileWithTags(filePath, tags) {
  try {
    if (!fs.existsSync(filePath)) {
      return { success: false, error: `文件不存在: ${filePath}` };
    }

    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const baseName = path.basename(filePath, ext);

    // 移除文件名末尾已有的标签括号（仅匹配最末尾的 (...格式）
    const nameWithoutTags = baseName.replace(/\(([^)]+)\)$/, '');

    // 拼接新文件名: 原名(标签1_标签2).ext
    const tagStr = tags.join('_');
    const newBaseName = `${nameWithoutTags}(${tagStr})`;
    const newName = `${newBaseName}${ext}`;
    const newPath = path.join(dir, newName);

    // 如果新旧名称相同，无需重命名
    if (filePath === newPath) {
      return { success: true, newName, newPath, unchanged: true };
    }

    fs.renameSync(filePath, newPath);
    return { success: true, newName, newPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * 撤回重命名 —— 将文件名恢复为打标签前的原始名称
 * 同时处理文件移动的撤回（移回原位）
 * @param {{originalPath: string, modifiedPath: string, modifiedName: string, movedTo?: string}} record
 */
function undoRename(record) {
  try {
    // 如果文件已被移动到分类文件夹，先移回原位
    if (record.movedTo) {
      // 文件在 movedTo/<modifiedName> 下
      const currentPath = path.join(record.movedTo, record.modifiedName);
      if (fs.existsSync(currentPath)) {
        // 确保原始目录存在
        const originalDir = path.dirname(record.originalPath);
        if (!fs.existsSync(originalDir)) {
          fs.mkdirSync(originalDir, { recursive: true });
        }
        // 移回原位，同时恢复原始文件名
        fs.renameSync(currentPath, record.originalPath);
        return { success: true };
      }
      // 如果 movedTo 路径找不到，尝试其他可能位置
      // 也尝试在源目录中查找（仅重命名、未移动的情况）
    }

    // 仅重命名的情况：把 modifiedName 改回 originalName（同一目录下）
    if (fs.existsSync(record.originalPath)) {
      return { success: true, unchanged: true };
    }

    const dir = path.dirname(record.originalPath);
    const modifiedPath = path.join(dir, record.modifiedName);
    if (fs.existsSync(modifiedPath)) {
      fs.renameSync(modifiedPath, record.originalPath);
      return { success: true };
    }

    return { success: false, error: `无法找到要撤回的文件: ${modifiedPath} 或 ${record.originalPath}` };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * 移动文件到分类文件夹
 * @param {string} filePath - 当前文件路径
 * @param {string} targetFolder - 目标文件夹（分类根目录/第一个标签/）
 */
function moveFile(filePath, targetFolder) {
  try {
    if (!fs.existsSync(filePath)) {
      return { success: false, error: `文件不存在: ${filePath}` };
    }

    if (!fs.existsSync(targetFolder)) {
      fs.mkdirSync(targetFolder, { recursive: true });
    }

    const fileName = path.basename(filePath);
    const newPath = path.join(targetFolder, fileName);

    // 如果目标位置已有同名文件，添加序号避免覆盖
    let finalPath = newPath;
    let counter = 1;
    while (fs.existsSync(finalPath)) {
      const ext = path.extname(fileName);
      const baseName = path.basename(fileName, ext);
      finalPath = path.join(targetFolder, `${baseName}_(${counter})${ext}`);
      counter++;
    }

    fs.renameSync(filePath, finalPath);
    return { success: true, newPath: finalPath, movedTo: targetFolder };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * 撤回移动 —— 把文件从分类文件夹移回原位
 */
function undoMove(currentPath, originalPath) {
  try {
    if (!fs.existsSync(currentPath)) {
      return { success: false, error: `文件不存在: ${currentPath}` };
    }
    const originalDir = path.dirname(originalPath);
    if (!fs.existsSync(originalDir)) {
      fs.mkdirSync(originalDir, { recursive: true });
    }
    fs.renameSync(currentPath, originalPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ==================== 菜单栏构建 ====================

/**
 * 构建应用原生菜单栏
 * 菜单项通过 IPC 发送消息到渲染进程，触发对应操作
 */
function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '选择文件夹',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu-select-folder')
        },
        {
          label: '设置分类后文件夹',
          accelerator: 'CmdOrCtrl+D',
          click: () => mainWindow?.webContents.send('menu-set-move-folder')
        },
        { type: 'separator' },
        {
          label: '导入设置',
          click: () => handleImportSettings()
        },
        {
          label: '导出设置',
          click: () => handleExportSettings()
        },
        { type: 'separator' },
        {
          label: '退出',
          accelerator: 'Alt+F4',
          click: () => app.quit()
        }
      ]
    },
    {
      label: '设置',
      submenu: [
        {
          label: '排序方式',
          submenu: [
            {
              label: '按文件名',
              type: 'radio',
              checked: true,
              click: () => mainWindow?.webContents.send('menu-sort-by', 'name')
            },
            {
              label: '按修改日期',
              type: 'radio',
              click: () => mainWindow?.webContents.send('menu-sort-by', 'date')
            },
            {
              label: '按文件大小',
              type: 'radio',
              click: () => mainWindow?.webContents.send('menu-sort-by', 'size')
            }
          ]
        },
        { type: 'separator' },
        {
          label: '快进快退秒数',
          submenu: [
            { label: '3 秒', type: 'radio', click: () => mainWindow?.webContents.send('menu-seek-seconds', 3) },
            { label: '5 秒', type: 'radio', checked: true, click: () => mainWindow?.webContents.send('menu-seek-seconds', 5) },
            { label: '10 秒', type: 'radio', click: () => mainWindow?.webContents.send('menu-seek-seconds', 10) },
            { label: '15 秒', type: 'radio', click: () => mainWindow?.webContents.send('menu-seek-seconds', 15) },
            { label: '30 秒', type: 'radio', click: () => mainWindow?.webContents.send('menu-seek-seconds', 30) }
          ]
        },
        { type: 'separator' },
        {
          label: '文件列表循环',
          type: 'checkbox',
          checked: true,
          click: (item) => mainWindow?.webContents.send('menu-loop-files', item.checked)
        }
      ]
    },
    {
      label: '快捷键',
      submenu: [
        {
          label: '快捷键设置',
          accelerator: 'CmdOrCtrl+K',
          click: () => mainWindow?.webContents.send('menu-shortcut-settings')
        },
        { type: 'separator' },
        {
          label: '恢复默认快捷键',
          click: () => mainWindow?.webContents.send('menu-reset-shortcuts')
        }
      ]
    },
    {
      label: '常用标签',
      submenu: [
        {
          label: '管理常用标签',
          click: () => mainWindow?.webContents.send('menu-manage-common-tags')
        }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '快捷键速查',
          accelerator: 'F1',
          click: () => mainWindow?.webContents.send('menu-show-help')
        },
        { type: 'separator' },
        {
          label: '关于',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '关于 - 媒体文件分类工具',
              message: '媒体文件分类工具 v1.0.0',
              detail: '一款用于快速浏览图片/视频/GIF并通过标签快速分类的桌面工具。\n\n技术栈: Electron + HTML/CSS/JS\n数据存储: JSON 本地文件'
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

/** 处理设置导入：打开文件选择对话框，读取 JSON 并发送到渲染进程 */
async function handleImportSettings() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '导入设置',
    filters: [{ name: 'JSON 文件', extensions: ['json'] }],
    properties: ['openFile']
  });

  if (result.canceled || result.filePaths.length === 0) return;

  try {
    const content = fs.readFileSync(result.filePaths[0], 'utf-8');
    const settings = JSON.parse(content);
    mainWindow?.webContents.send('menu-import-settings', settings);
  } catch (err) {
    dialog.showErrorBox('导入失败', `无法读取设置文件:\n${err.message}`);
  }
}

/** 处理设置导出：从渲染进程获取当前设置，保存为 JSON 文件 */
async function handleExportSettings() {
  // 先请求渲染进程发送当前设置
  mainWindow?.webContents.send('menu-request-export-settings');
}

// ==================== 窗口创建 ====================

function createWindow() {
  // 尝试读取上次窗口尺寸
  const settings = readJSON('settings.json', {});
  const windowWidth = settings.windowSize?.width || 1400;
  const windowHeight = settings.windowSize?.height || 900;

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    minWidth: 900,
    minHeight: 600,
    title: '媒体文件分类工具',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,  // 安全：隔离渲染进程上下文
      nodeIntegration: false,  // 安全：禁止渲染进程直接访问 Node.js
      webSecurity: true        // 允许加载本地文件（媒体文件通过 file:// 协议显示）
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 窗口大小变化时保存尺寸
  mainWindow.on('resize', () => {
    const [width, height] = mainWindow.getSize();
    const currentSettings = readJSON('settings.json', {});
    currentSettings.windowSize = { width, height };
    writeJSON('settings.json', currentSettings);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  buildMenu();
}

// ==================== IPC 处理器注册 ====================

function registerIPC() {
  // --- 文件夹选择 ---
  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择包含媒体文件的文件夹',
      properties: ['openDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, cancelled: true };
    }
    return { success: true, folderPath: result.filePaths[0] };
  });

  // --- 选择分类目标文件夹 ---
  ipcMain.handle('select-target-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择分类文件的根目录',
      properties: ['openDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, cancelled: true };
    }
    return { success: true, folderPath: result.filePaths[0] };
  });

  // --- 扫描媒体文件 ---
  ipcMain.handle('list-media-files', (event, folderPath, sortBy) => {
    return listMediaFiles(folderPath, sortBy);
  });

  // --- 重命名文件 ---
  ipcMain.handle('rename-file', (event, filePath, tags) => {
    return renameFileWithTags(filePath, tags);
  });

  // --- 撤回重命名 ---
  ipcMain.handle('undo-rename', (event, record) => {
    return undoRename(record);
  });

  // --- 移动文件 ---
  ipcMain.handle('move-file', (event, filePath, targetFolder) => {
    return moveFile(filePath, targetFolder);
  });

  // --- 撤回移动 ---
  ipcMain.handle('undo-move', (event, currentPath, originalPath) => {
    return undoMove(currentPath, originalPath);
  });

  // --- JSON 数据读写 ---
  ipcMain.handle('read-settings', () => {
    return readJSON('settings.json', {});
  });

  ipcMain.handle('write-settings', (event, settings) => {
    return writeJSON('settings.json', settings);
  });

  ipcMain.handle('read-common-tags', () => {
    return readJSON('common-tags.json', []);
  });

  ipcMain.handle('write-common-tags', (event, tags) => {
    return writeJSON('common-tags.json', tags);
  });

  ipcMain.handle('read-history', () => {
    return readJSON('tag-history.json', []);
  });

  ipcMain.handle('write-history', (event, history) => {
    return writeJSON('tag-history.json', history);
  });

  // --- 导出设置文件 ---
  ipcMain.handle('export-settings-file', async (event, settings) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出设置',
      defaultPath: 'media-sorter-settings.json',
      filters: [{ name: 'JSON 文件', extensions: ['json'] }]
    });
    if (result.canceled) return { success: false, cancelled: true };

    try {
      fs.writeFileSync(result.filePath, JSON.stringify(settings, null, 2), 'utf-8');
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

// ==================== 应用生命周期 ====================

app.whenReady().then(() => {
  registerIPC();
  createWindow();

  app.on('activate', () => {
    // macOS 点击 Dock 图标时重新创建窗口
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // 所有平台均退出（非 macOS 标准行为，但符合 Windows 用户预期）
  app.quit();
});
