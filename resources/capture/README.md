Windows screen-capture helper is built from `scripts/native/ScreenCapture.cs` by `npm run build:capture`.
It uses inbox .NET Framework and Win32 GDI, captures only on request, sends BMP frames over stdio,
and does not write images to disk or use the network. The helper binary is a generated build artifact.
macOS uses Electron's system screen capture and the same in-memory BMP transport.

Starting with 1.6.3, Windows uses `screen-overlay.exe` from `scripts/native/ScreenOverlay.cs`.
It captures and paints the selection UI in one native process. Full-screen pixels stay there;
only the enhanced selected crop is sent to Electron. Warmup paints a locally generated blank
frame without reading the desktop or displaying a window. Helper failures are recoverable.
