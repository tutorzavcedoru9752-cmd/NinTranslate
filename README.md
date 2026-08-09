# NinTranslate

![NinTranslate Logo](resources/brand/nintranslate-window.png)

NinTranslate 是一款面向 Windows 与 macOS 的截图翻译软件。使用全局快捷键或托盘/菜单栏图标，即可框选屏幕文字，在本地完成十语种 OCR，并把识别后的文字发送给百度翻译或 Microsoft Translator。

## 主要功能

- 从其他应用上方唤起区域截图
- 本地识别简体中文、繁体中文、英语、日语、韩语、法语、德语、西班牙语、葡萄牙语和俄语
- 可选择“中英快速”或“多语言自动识别”；只有中英需求时不再运行其他语种模型
- 翻译服务自动判断截图中的主要语言，默认翻译成简体中文
- 可在设置页选择长期默认目标语言，也可在结果页仅为当前截图切换目标语言
- 本地版面分析区分标题、正文和多栏阅读顺序；结果页可编辑识别原文并重新翻译
- 支持正确交换原文、译文及对应语言
- 可复制、固定、关闭和调整大小的翻译结果窗
- 最多保存 500 条纯文字历史，支持搜索、复制、删除和全部清空
- 百度翻译与 Microsoft Translator 适配器
- 使用 Windows 用户级加密或 macOS 钥匙串保护翻译凭据
- Windows 安装版、Windows 便携版和 macOS 原生安装包

## 默认快捷键

- Windows：`Alt + Shift + T`
- macOS：`Command + Shift + T`

快捷键可在设置页中修改。如果快捷键已被其他软件占用，NinTranslate 会提示重新设置。

## 隐私说明

- 截图只在本机内存中用于 OCR，不写入历史文件。
- 翻译服务只接收 OCR 识别后的文字、源语言和目标语言，不接收截图。
- 历史记录只保存时间、语言方向、原文和译文。
- API 凭据只在 Electron 主进程中解密，界面进程不能读取明文密钥。

## macOS 首次使用

1. 根据 Mac 芯片下载对应版本：
   - Apple 芯片（M1、M2、M3、M4 等）：`arm64`
   - Intel 芯片：`x64`
2. 打开 `.dmg`，把 NinTranslate 拖入“应用程序”文件夹。
3. 首次截图时，按照提示前往“系统设置 → 隐私与安全性 → 屏幕与系统音频录制”，允许 NinTranslate。
4. 完全退出并重新打开 NinTranslate，再使用 `Command + Shift + T` 截图。
5. 在设置页填写自己的百度翻译或 Microsoft Translator 凭据并测试连接。

未使用 Apple Developer 证书签名的测试版本可能被“安全性与隐私”拦截。可在 Finder 中按住 Control 点击应用并选择“打开”，或在系统设置的“隐私与安全性”中确认打开。正式公开分发建议完成 Apple 代码签名和公证。

## Windows 首次使用

- 安装版：`NinTranslate-Setup-x64.exe`
- 便携版：`NinTranslate-Portable-x64.exe`

安装或启动后，在设置页填写翻译服务凭据；默认使用 `Alt + Shift + T` 截图。

## 多语言识别说明

- 设置页“文字识别模式”默认为“中英快速（推荐）”：每张截图只运行一次中英 PP-OCRv5 Mobile 识别，保留本地版面分析，不会自动升级到大型 Server 模型。
- 需要繁体中文、日语、韩语、法语、德语、西班牙语、葡萄牙语或俄语时，可切换为“多语言自动识别”；保存后从下一张截图开始生效。
- 第一次截图时会启动 RapidOCR/ONNX 本地识别引擎并加载模型，因此可能需要数秒；之后会复用已启动的引擎。OCR 与版面模型共 9 个，约 144.18 MiB。
- 多语言模式会比较四套 PP-OCRv5 Mobile 识别字库；当中日韩或拉丁文字结果的置信度不足时，自动惰性加载 PP-OCRv5 Server 高精度识别模型并比较结果。检测器继续使用更适合界面整行文字的 Mobile 版本，避免 Server 检测器把句子切成过多单词框。
- 一张截图按照一种主要语言识别和翻译；多语言混排内容可能需要人工校对。
- 软件先用本地版面模型识别标题、正文等区域，再重建同一基线上的 OCR 碎片，结合长水平分隔线、行距、标点和稳健 XY-cut 多栏排序判断真实段落；同一句的视觉换行会重新连接。深色界面会先在内存中去除彩色子像素边缘，降低漏行概率。模型无结果或失败时自动退回几何规则，不影响翻译。
- 对高置信度但常见的字形混淆进行保守校正，例如技术语境中重复出现的 `Al`/`AI`、英文缩写撇号与编号后的空格；不会调用在线大模型改写原文。
- 结果页“编辑原文”显示的就是实际送去翻译的文字。`Enter` 创建人工指定的真实段落，`Ctrl/Command + Enter` 保存并重译，`Esc` 取消。人工换行不会再被自动重排。
- 结果页原文上方可切换“智能分段 / 保留视觉行 / 合并为一段”。切换会复用内存中的逐行 OCR 结果重新翻译，不重新截图；人工编辑后则以用户内容为最高优先级。
- 结果页修改目标语言会直接复用已识别文字，不会重新截图或重新 OCR，也不会修改设置页中的默认语言。
- 结果页原文标题会明确显示翻译服务检测出的原文语言，并在底部显示本次使用的识别模式；界面不显示处理耗时。
- 截图始终只在本机内存中处理，翻译服务收到的仍然只有识别后的文字。

## 本地开发

环境要求：

- Node.js 18 或更高版本
- npm
- Python 3.12（用于构建 RapidOCR 本地运行环境）
- 构建 macOS 安装包时必须在 macOS 环境运行

安装依赖并启动：

```powershell
npm.cmd ci
python -m pip install -r scripts/rapidocr-requirements.txt
npm.cmd run build:rapidocr
npm.cmd run dev
```

运行自动化检查：

```powershell
npm.cmd test -- --run
npm.cmd run typecheck
```

构建 Windows：

```powershell
npm.cmd run dist:win
```

在 macOS 上构建：

```bash
npm ci
npm run dist:mac -- --arm64
npm run dist:mac -- --x64
```

构建结果位于 `release/`。

## 技术栈

- Electron
- TypeScript
- React
- RapidOCR 3.8.1
- PaddleOCR PP-OCRv5 多语言模型
- RapidLayout 1.2.1 与 PaddleOCR 本地版面模型
- ONNX Runtime
- Vitest
- electron-builder

## 当前版本

`1.6.1`（本地开发版，尚未发布）

## 许可证

本项目使用 [MIT License](LICENSE)。
