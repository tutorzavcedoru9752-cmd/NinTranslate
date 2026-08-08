# NinTranslate

![NinTranslate Logo](resources/brand/nintranslate-window.png)

NinTranslate 是一款面向 Windows 与 macOS 的截图翻译软件。使用全局快捷键或托盘/菜单栏图标，即可框选屏幕文字，在本地完成十语种 OCR，并把识别后的文字发送给百度翻译或 Microsoft Translator。

## 主要功能

- 从其他应用上方唤起区域截图
- 本地识别简体中文、繁体中文、英语、日语、韩语、法语、德语、西班牙语、葡萄牙语和俄语
- 翻译服务自动判断截图中的主要语言，默认翻译成简体中文
- 可在设置页选择长期默认目标语言，也可在结果页仅为当前截图切换目标语言
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

- 第一次截图时会加载约 18.1 MB 的十语种离线模型，因此会比之后的截图稍慢。
- 一张截图按照一种主要语言识别和翻译；多语言混排内容可能需要人工校对。
- 结果页修改目标语言会直接复用已识别文字，不会重新截图或重新 OCR，也不会修改设置页中的默认语言。
- 截图始终只在本机内存中处理，翻译服务收到的仍然只有识别后的文字。

## 本地开发

环境要求：

- Node.js 18 或更高版本
- npm
- 构建 macOS 安装包时必须在 macOS 环境运行

安装依赖并启动：

```powershell
npm.cmd ci
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
- Tesseract.js
- Vitest
- electron-builder

## 当前版本

`1.5.0`

## 许可证

本项目使用 [MIT License](LICENSE)。
