# 媒体文件分类工具

一款 Windows 本地单机工具，用于快速浏览图片/视频/GIF，通过可视化标签面板给文件打标签并自动重命名分类。

---

## 需求方案

### 使用场景

用户需要对大量媒体文件进行快速分类。传统方式需要逐个查看文件 → 手动移动到不同文件夹 → 回头忘记分到哪了。本工具提供：

1. **边看边分**：左侧查看媒体，右侧点击标签即可打上分类标记
2. **快捷键流**：纯键盘操作下，浏览 → 按数字键打标签 → Enter 确认 → 自动切下一个，流畅高效
3. **重命名式分类**：标签直接写入文件名 `photo(风景_旅行).jpg`，不依赖数据库，跨平台可识别
4. **可撤回**：误操作随时 Backspace 撤回

### 核心功能

- 图片查看：缩放（滚轮/上下键）、拖拽平移、旋转 90°
- 视频播放：播放/暂停、快进快退、音量控制、自定义控制栏
- GIF 播放控制：暂停时冻结帧，恢复时继续动画
- 标签面板：增删、重命名、拖拽排序、多选、快捷键绑定（1-9/字母键）
- 右键菜单：从常用标签批量添加、保存为常用、删除全部
- 常用标签预设：菜单栏管理，一键导入
- 快捷键全可自定义：含冲突检测
- 文件重命名 + 撤回：标签追加到文件名末尾括号中
- 移动文件到分类文件夹：可选功能
- 设置导入/导出：JSON 格式
- 启动恢复上次文件夹

---

## 技术方案

| 维度 | 选择 | 原因 |
|------|------|------|
| 框架 | Electron 33 | 跨平台、HTML5 媒体播放成熟、UI 灵活 |
| 前端 | 原生 HTML/CSS/JS | 无构建步骤、轻量 |
| 数据存储 | JSON 本地文件 | 可读可编辑，用户偏好 |
| 打包 | electron-builder | 生成 Windows NSIS 安装包 |
| 安全 | contextIsolation + preload | 渲染进程隔离，最小权限 |

### 架构

```
Main Process (main.js)
  ├── 窗口管理 (BrowserWindow)
  ├── 原生菜单栏 (Menu.buildFromTemplate)
  ├── 文件系统操作 (fs)
  └── JSON 读写 (settings / history / common-tags)
       ↕ IPC (preload.js - contextBridge)
Renderer Process (renderer/)
  ├── index.html        → 主界面布局
  ├── js/app.js         → 应用初始化、模块协调
  ├── js/mediaViewer.js → 图片/视频/GIF 查看器
  ├── js/tagPanel.js    → 标签管理面板
  ├── js/shortcuts.js   → 快捷键系统
  ├── js/settings.js    → 设置管理
  └── js/history.js     → 历史记录管理
```

### 文件名括号处理策略

- 打标签时，仅在文件名**末尾**追加 `(标签1_标签2)` 格式
- 读取时，用正则 `/\(([^)]+)\)$/` 仅匹配文件名最末尾的括号作为标签
- 例如 `photo(1).jpg` → 打标签后 → `photo(1)(风景).jpg`，再次打开能正确识别 `风景`
- 其他位置的括号不受影响

---

## 项目结构

```
media-sorter/
├── package.json              # 项目配置、依赖、打包配置
├── main.js                   # Electron 主进程（窗口、菜单、IPC、文件系统）
├── preload.js                # 安全 IPC 桥接层
├── renderer/
│   ├── index.html            # 主界面 HTML
│   ├── styles/
│   │   ├── main.css          # 全局样式、布局、弹窗、滚动条
│   │   ├── viewer.css        # 媒体查看器样式
│   │   └── tags.css          # 标签面板样式
│   └── js/
│       ├── app.js            # 应用主控制器、模块协调、确认/撤回
│       ├── mediaViewer.js    # 图片/视频/GIF 查看器
│       ├── tagPanel.js       # 标签管理面板
│       ├── shortcuts.js      # 快捷键系统
│       ├── settings.js       # 设置管理（读写 JSON）
│       └── history.js        # 标签历史记录管理
├── data/                     # 用户数据（运行时生成）
│   ├── settings.json         # 用户设置
│   ├── common-tags.json      # 常用标签预设
│   └── tag-history.json      # 打标签历史记录
└── dist/                     # 打包输出（electron-builder 生成）
```

---

## 核心模块说明

### main.js — Electron 主进程

- `BrowserWindow` 创建窗口，加载 `renderer/index.html`
- `Menu.buildFromTemplate` 构建原生菜单栏
- `ipcMain.handle` 注册所有 IPC 处理器：文件夹选择、文件扫描、重命名、移动、JSON 读写
- `listMediaFiles()` 扫描目录中的图片 (jpg/png/gif/webp/bmp/tiff) 和视频 (mp4/avi/mov/mkv/webm/flv/wmv)
- `renameFileWithTags()` 在文件名末尾追加/替换 `(标签1_标签2)` 括号
- `undoRename()` 撤回重命名（含移回功能）
- `moveFile()` 移动文件到分类文件夹

### preload.js — 安全桥接

- 通过 `contextBridge.exposeInMainWorld` 暴露 `window.electronAPI`
- 渲染进程只能调用白名单中的方法
- `onMenuEvent` 监听主进程菜单栏事件

### mediaViewer.js — 媒体查看器

- **图片**：`<img>` + CSS `transform: scale()/translate()/rotate()` 实现缩放/拖动/旋转
- **缩放**：鼠标滚轮/上下方向键，缩放范围 10%~500%
- **拖动**：mousedown/mousemove/mouseup，改变 translate 偏移
- **旋转**：Shift 键/按钮，每次 ±90°
- **视频**：HTML5 `<video>` + 自定义控制栏（替代原生 controls）
- **GIF**：`<img>` 加载，暂停时用 canvas 捕获当前帧替换为静态图
- **文件导航**：PageUp/PageDown 切换，支持边界循环
- **音量记忆**：切换视频保持音量，持久化到 settings.json

### tagPanel.js — 标签面板

- **标签渲染**：`.tag-chip` 元素，显示快捷键角标 + 标签名
- **未命名标签**：名称为 `?`，亮红色脉冲动画，禁止添加新标签
- **选中/取消**：左键点击切换
- **拖拽排序**：HTML5 Drag & Drop API，快捷键自动跟随新位置
- **右键标签**：重命名 / 删除 / 保存为常用
- **右键空白**：从常用标签选择 / 全部保存为常用 / 删除全部
- **快捷键**：前 9 个 1-9，后续可自定义字母

### shortcuts.js — 快捷键系统

- 全局 `keydown` 事件监听
- `_eventToKeyName()` 将键盘事件转为标准化按键名
- 支持全部快捷键自定义，含冲突检测
- `renderSettingsPanel()` 渲染快捷键设置表格 UI
- 标签快捷键（1-9/字母）独立处理，不在全局 shortcuts 中

### app.js — 主控制器

- `init()`: 加载设置→初始化所有模块→注册快捷键→绑定菜单事件→恢复上次文件夹
- `confirmTagging()`: 获取选中标签→重命名文件→（可选移动）→写入历史→清标签→切下一个
- `undoTagging()`: 获取最后记录→撤回重命名/移动→删除历史→切回该文件→恢复标签选中
- `_setupMenuListeners()`: 注册所有菜单栏事件的监听器

---

## 安装与使用

### 环境要求

- Node.js 18+
- Windows 10+ / macOS 12+ / Linux

### 开发运行

```bash
# 进入项目目录
cd media-sorter

# 安装依赖（中国用户设置 Electron 镜像）
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" npm install

# 启动应用
npm start
```

### 打包为安装程序

```bash
# 生成便携版 exe
npm run build

# 生成 NSIS 安装包
npm run build:installer
```

输出在 `dist/` 目录。

### 使用流程

1. 打开软件
2. 左侧点击 **＋** 选择包含媒体文件的文件夹
3. 右侧点击 **＋** 添加分类标签（输入名称后回车确认）
4. 浏览文件，点击标签或按数字键 1-9 选中标签
5. 按 **Enter** 确认打标签 → 文件自动重命名并切换到下一个
6. 按 **Backspace** 撤回上次操作

---

## 快捷键速查表

### 文件导航
| 快捷键 | 功能 |
|--------|------|
| PageUp | 上一个文件 |
| PageDown | 下一个文件 |
| Shift | 旋转 90° |

### 媒体控制
| 快捷键 | 功能 |
|--------|------|
| Space | 播放/暂停 |
| ← | 快退 |
| → | 快进 |
| ↑ | 图片放大 |
| ↓ | 图片缩小 |
| +/= | 音量增大 |
| - | 音量减小 |

### 标签操作
| 快捷键 | 功能 |
|--------|------|
| 1-9 | 切换标签 1-9 选中状态 |
| 字母键 | 切换对应字母标签 |

### 确认操作
| 快捷键 | 功能 |
|--------|------|
| Enter | 确认打标签 |
| Backspace | 撤回上次操作 |

> 所有快捷键可在菜单栏 → 快捷键设置中自定义

---

## 设置文件说明

### settings.json
```json
{
  "sortBy": "name",           // 排序: name|date|size
  "seekSeconds": 5,            // 快进快退秒数
  "volume": 0.8,               // 视频音量 0-1
  "loopFileList": true,        // 边界循环
  "moveTargetFolder": "",      // 分类根目录（空=不移动）
  "lastOpenedFolder": "",      // 上次打开文件夹
  "windowSize": { "width": 1400, "height": 900 },
  "shortcuts": { ... }         // 全部快捷键
}
```

### common-tags.json
```json
["风景", "人物", "美食", "动物", "建筑"]
```

### tag-history.json
```json
[{
  "id": 1,
  "originalName": "IMG_001.jpg",
  "modifiedName": "IMG_001(风景_旅行).jpg",
  "originalPath": "C:/待分类/IMG_001.jpg",
  "tags": ["风景", "旅行"],
  "taggedAt": "2026-06-07T14:30:00",
  "movedTo": "C:/分类文件夹/风景/"
}]
```
