# NinTranslate

![NinTranslate Logo](resources/brand/nintranslate-window.png)

NinTranslate 是一款面向 Windows 10/11 64 位系统的截图翻译软件。按下 `Alt + Shift + T` 或双击系统托盘图标，即可框选屏幕文字，在本地完成中英文 OCR，并把识别后的文字发送给百度翻译或 Microsoft Translator。

## 主要功能

- 全局快捷键和托盘双击唤起区域截图
- 本地简体中文、英文 OCR
- 自动判断中译英或英译中，并支持手动交换语言
- 可复制、固定、关闭和调整大小的翻译结果窗
- 最多保存 500 条纯文字历史，支持搜索、复制、删除和全部清空
- 百度翻译与 Microsoft Translator 适配器
- Windows 用户级加密保存翻译服务凭据
- 安装版与便携版构建

## 隐私说明

- 截图只在本机内存中用于 OCR，不写入历史文件。
- 翻译服务只接收识别后的文字、源语言和目标语言，不接收截图。
- 历史记录只保存时间、语言方向、原文和译文。
- API 密钥只在 Electron 主进程中解密，渲染进程不能读取明文密钥。

## 下载与使用

推荐从 GitHub Releases 下载：

- `NinTranslate-Setup-x64.exe`：安装版
- `NinTranslate-Portable-x64.exe`：便携版

首次使用时，在“设置”中选择翻译服务并填写自己的凭据。百度翻译用户需要 APP ID 和密钥；配置完成后点击“测试连接”。

## 本地开发

环境要求：

- Windows 10/11 64 位
- Node.js 18 或更高版本
- npm

安装依赖并运行：

```powershell
npm.cmd ci
npm.cmd run dev
```

运行自动化测试：

```powershell
npm.cmd test -- --run
npm.cmd run typecheck
```

构建安装版和便携版：

```powershell
npm.cmd run dist
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

`1.3.0`

## 许可协议

本项目使用 [MIT License](LICENSE)。
