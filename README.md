# NinTranslate

![NinTranslate Logo](resources/brand/nintranslate-window.png)

NinTranslate 是一款面向 Windows 与 macOS 的截图翻译软件。使用全局快捷键或托盘/菜单栏图标，即可框选屏幕文字，在本地完成中英文 OCR，并把识别后的文字发送给百度翻译或 Microsoft Translator。

## 主要功能

- 从其他应用上方唤起区域截图
- 本地简体中文、英文 OCR
- 自动判断中译英或英译中，并支持手动交换语言
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

`1.4.1`

## 许可证

本项目使用 [MIT License](LICENSE)。
