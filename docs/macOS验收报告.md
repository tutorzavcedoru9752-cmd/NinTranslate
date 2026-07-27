# NinTranslate 1.4.0 macOS 验收报告

## 自动化验收

- TypeScript 类型检查：通过
- 单元测试：通过，4 个测试文件、13 项测试
- React/Vite 生产构建：通过
- macOS Apple 芯片构建：由 GitHub macOS 构建环境验证
- macOS Intel 构建：由 GitHub macOS 构建环境验证
- 安装包 SHA-256：随构建产物生成

## 已实现的 macOS 适配

- Apple 芯片和 Intel 双架构
- `.dmg` 安装包和 `.zip` 应用包
- 默认快捷键 `Command + Shift + T`
- 菜单栏图标
- 屏幕录制权限检测和系统设置跳转
- 跨全屏工作区显示截图选区
- macOS 登录时启动
- macOS 系统安全存储保护翻译凭据
- 保留本地 OCR、纯文字历史和不保存截图的隐私约束

## 必须在 Mac 实机完成的验收

- 首次启动时的系统安全提示
- 屏幕录制权限授权、退出和重新启动流程
- 单显示器与多显示器框选坐标
- Retina 缩放下的截图清晰度
- 菜单栏唤起和全局快捷键冲突提示
- 百度翻译真实凭据连接
- 历史保存、搜索、复制、删除和清空
- 结果窗口复制、固定、交换语言、重试、关闭和调整大小

## 分发状态

当前构建为未签名测试版，适合交给指定测试者使用。要实现普通用户双击安装且不出现 Gatekeeper 警告，需要 Apple Developer ID Application 证书，并通过 Apple 公证服务完成 notarization。
