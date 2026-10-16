// Native Windows capture/selection UI. Full-screen pixels never leave this process.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class OverlayNative {
    [StructLayout(LayoutKind.Sequential)] internal struct BitmapInfo {
        public uint Size; public int Width, Height; public ushort Planes, BitCount;
        public uint Compression, SizeImage; public int XPels, YPels; public uint Used, Important;
    }
    [DllImport("user32.dll")] internal static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] internal static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")] internal static extern int ReleaseDC(IntPtr window, IntPtr dc);
    [DllImport("user32.dll")] internal static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] internal static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("gdi32.dll")] internal static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] internal static extern IntPtr CreateDIBSection(IntPtr dc, ref BitmapInfo info, uint usage, out IntPtr bits, IntPtr section, uint offset);
    [DllImport("gdi32.dll")] internal static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
    [DllImport("gdi32.dll")] internal static extern bool DeleteObject(IntPtr obj);
    [DllImport("gdi32.dll")] internal static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] internal static extern bool GdiFlush();
    [DllImport("gdi32.dll")] internal static extern bool BitBlt(IntPtr dest, int x, int y, int width, int height, IntPtr source, int sx, int sy, uint operation);
    [DllImport("dwmapi.dll")] internal static extern int DwmFlush();
    [DllImport("dwmapi.dll")] internal static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);
}

internal sealed class DesktopFrame : IDisposable {
    internal readonly Bitmap Image;
    IntPtr dc, dib, previous;
    internal DesktopFrame(Rectangle bounds, bool capture = true) {
        if (bounds.Width < 1 || bounds.Height < 1 || (long)bounds.Width * bounds.Height > 64000000) throw new Exception("Invalid screen dimensions");
        IntPtr source = OverlayNative.GetDC(IntPtr.Zero);
        try {
            dc = OverlayNative.CreateCompatibleDC(source);
            var info = new OverlayNative.BitmapInfo { Size = 40, Width = bounds.Width, Height = -bounds.Height,
                Planes = 1, BitCount = 32, SizeImage = checked((uint)(bounds.Width * bounds.Height * 4)) };
            IntPtr pixels;
            dib = OverlayNative.CreateDIBSection(source, ref info, 0, out pixels, IntPtr.Zero, 0);
            if (dc == IntPtr.Zero || dib == IntPtr.Zero || pixels == IntPtr.Zero) throw new Exception("Screen bitmap unavailable");
            previous = OverlayNative.SelectObject(dc, dib);
            if (capture && !OverlayNative.BitBlt(dc, 0, 0, bounds.Width, bounds.Height, source, bounds.X, bounds.Y, 0x00CC0020)) throw new Exception("Screen copy failed");
            OverlayNative.GdiFlush();
            // Wrap the DIB in place: no Marshal.Copy, PNG encoder, pipe or Chromium upload.
            Image = new Bitmap(bounds.Width, bounds.Height, bounds.Width * 4, PixelFormat.Format32bppRgb, pixels);
            if (!capture) using (var graphics = Graphics.FromImage(Image)) graphics.Clear(Color.FromArgb(24, 27, 34));
        } catch { Dispose(); throw; }
        finally { if (source != IntPtr.Zero) OverlayNative.ReleaseDC(IntPtr.Zero, source); }
    }
    public void Dispose() {
        if (Image != null) Image.Dispose();
        if (previous != IntPtr.Zero && dc != IntPtr.Zero) OverlayNative.SelectObject(dc, previous);
        if (dib != IntPtr.Zero) OverlayNative.DeleteObject(dib);
        if (dc != IntPtr.Zero) OverlayNative.DeleteDC(dc);
        dc = dib = previous = IntPtr.Zero;
    }
    internal void Draw(Graphics graphics, Rectangle clip) {
        IntPtr target = graphics.GetHdc();
        try { OverlayNative.BitBlt(target, clip.X, clip.Y, clip.Width, clip.Height, dc, clip.X, clip.Y, 0x00CC0020); }
        finally { graphics.ReleaseHdc(target); }
    }
}

// Semantic aliases preserve the existing Electron capture overlay's colors.
internal static class CaptureTheme {
    internal static readonly Color Mask = Color.FromArgb(107, 8, 10, 14);
    internal static readonly Color Surface = Color.FromArgb(235, 18, 21, 28);
    internal static readonly Color Text = Color.White;
    internal static readonly Color SecondaryText = Color.FromArgb(199, 206, 218);
    internal static readonly Color Selection = Color.FromArgb(76, 131, 255);
    internal static readonly Color Accent = Color.FromArgb(36, 107, 254);
}

internal sealed class CaptureSurface : Form {
    readonly OverlaySession owner;
    internal DesktopFrame Frame;
    internal float UiScale;
    internal CaptureSurface(OverlaySession owner, Rectangle bounds, float scale) {
        this.owner = owner; UiScale = scale;
        AutoScaleMode = AutoScaleMode.None; FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual; ShowInTaskbar = false; TopMost = true;
        Bounds = bounds; Cursor = Cursors.Cross; KeyPreview = true;
        AccessibleName = "截图选区，拖动框选文字，按 Escape 或右键取消";
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.Opaque, true);
        IntPtr handle = Handle;
        int disabled = 1;
        OverlayNative.DwmSetWindowAttribute(handle, 3, ref disabled, 4);
        // Warm GDI+, fonts and painting with a locally generated blank frame.
        // This does not read the desktop and never shows a warmup window.
        using (Frame = new DesktopFrame(bounds, false))
        using (var canvas = new Bitmap(bounds.Width, bounds.Height)) DrawToBitmap(canvas, ClientRectangle);
        Frame = null;
    }
    protected override bool ProcessCmdKey(ref Message msg, Keys keyData) {
        if (keyData == Keys.Escape) { owner.Cancel(); return true; }
        return base.ProcessCmdKey(ref msg, keyData);
    }
    protected override void OnMouseDown(MouseEventArgs e) {
        if (e.Button == MouseButtons.Right) { owner.Cancel(); return; }
        if (e.Button == MouseButtons.Left && Frame != null) { Capture = true; owner.Begin(PointToScreen(e.Location), UiScale); }
    }
    protected override void OnMouseMove(MouseEventArgs e) { if (Capture) owner.Move(PointToScreen(e.Location)); }
    protected override void OnMouseUp(MouseEventArgs e) {
        if (e.Button != MouseButtons.Left || !Capture) return;
        Capture = false; owner.End(PointToScreen(e.Location));
    }
    protected override void OnPaint(PaintEventArgs e) {
        if (Frame == null) { e.Graphics.Clear(Color.FromArgb(24, 27, 34)); return; }
        Frame.Draw(e.Graphics, e.ClipRectangle);
        using (var mask = new SolidBrush(CaptureTheme.Mask)) {
            var selected = owner.Selection;
            if (selected.IsEmpty) e.Graphics.FillRectangle(mask, ClientRectangle);
            else {
                selected.Offset(-Left, -Top);
                using (var outside = new Region(ClientRectangle)) { outside.Exclude(selected); e.Graphics.FillRegion(mask, outside); }
                using (var border = new Pen(CaptureTheme.Selection, Math.Max(2, 2 * UiScale))) e.Graphics.DrawRectangle(border, selected);
                float size = 6 * UiScale;
                using (var handle = new SolidBrush(CaptureTheme.Text)) {
                    e.Graphics.FillRectangle(handle, selected.Left - size / 2, selected.Top - size / 2, size, size);
                    e.Graphics.FillRectangle(handle, selected.Right - size / 2, selected.Bottom - size / 2, size, size);
                }
            }
        }
        if (owner.Selection.IsEmpty) {
            using (var title = new Font("Microsoft YaHei UI", 14 * UiScale, FontStyle.Bold, GraphicsUnit.Pixel))
            using (var caption = new Font("Microsoft YaHei UI", 12 * UiScale, FontStyle.Regular, GraphicsUnit.Pixel))
            using (var text = new SolidBrush(CaptureTheme.Text))
            using (var secondary = new SolidBrush(CaptureTheme.SecondaryText))
            using (var surface = new SolidBrush(CaptureTheme.Surface)) {
                string message = "拖动框选要翻译的文字", hint = "按 Esc / 右键取消";
                float padding = 16 * UiScale, gap = 18 * UiScale;
                var titleSize = e.Graphics.MeasureString(message, title);
                var hintSize = e.Graphics.MeasureString(hint, caption);
                bool wrap = titleSize.Width + hintSize.Width + gap + padding * 2 > Width - 32 * UiScale;
                float width = Math.Min(Width - 32 * UiScale, (wrap ? Math.Max(titleSize.Width, hintSize.Width) : titleSize.Width + gap + hintSize.Width) + padding * 2);
                float height = (wrap ? titleSize.Height + hintSize.Height + 4 * UiScale : Math.Max(titleSize.Height, hintSize.Height)) + 20 * UiScale;
                float left = (Width - width) / 2, top = 28 * UiScale;
                float diameter = Math.Min(20 * UiScale, height);
                using (var shape = new GraphicsPath()) {
                    shape.AddArc(left, top, diameter, diameter, 180, 90);
                    shape.AddArc(left + width - diameter, top, diameter, diameter, 270, 90);
                    shape.AddArc(left + width - diameter, top + height - diameter, diameter, diameter, 0, 90);
                    shape.AddArc(left, top + height - diameter, diameter, diameter, 90, 90); shape.CloseFigure();
                    e.Graphics.FillPath(surface, shape);
                }
                e.Graphics.DrawString(message, title, text, left + padding, top + 10 * UiScale);
                e.Graphics.DrawString(hint, caption, secondary, wrap ? left + padding : left + padding + titleSize.Width + gap,
                    wrap ? top + 14 * UiScale + titleSize.Height : top + 11 * UiScale);
            }
        }
    }
    internal void ClearFrame() { if (Frame != null) { Frame.Dispose(); Frame = null; } }
    protected override void Dispose(bool disposing) { if (disposing) ClearFrame(); base.Dispose(disposing); }
}

internal sealed class OverlaySession : ApplicationContext {
    readonly Control dispatcher = new Control();
    readonly List<CaptureSurface> windows = new List<CaptureSurface>();
    readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 256000000 };
    readonly object outputLock = new object();
    string active;
    Point start, end;
    bool dragging;
    float startScale = 1;
    internal Rectangle Selection { get { return dragging ? Rectangle.FromLTRB(Math.Min(start.X, end.X), Math.Min(start.Y, end.Y), Math.Max(start.X, end.X), Math.Max(start.Y, end.Y)) : Rectangle.Empty; } }
    internal OverlaySession() {
        IntPtr handle = dispatcher.Handle;
        new Thread(ReadCommands) { IsBackground = true }.Start();
        Send(new { type = "ready" });
    }
    void Send(object message) { lock (outputLock) { Console.Out.WriteLine(json.Serialize(message)); Console.Out.Flush(); } }
    void ReadCommands() {
        string line;
        while ((line = Console.ReadLine()) != null) {
            string command = line;
            try { dispatcher.BeginInvoke((Action)(() => Command(command))); } catch (InvalidOperationException) { return; }
        }
        try { dispatcher.BeginInvoke((Action)(() => ExitThread())); } catch (InvalidOperationException) { }
    }
    void Configure(string description) {
        string[] displays = description.Split(';');
        if (displays.Length < 1 || displays.Length > 32) throw new Exception("Invalid display count");
        while (windows.Count > displays.Length) { windows[windows.Count - 1].Dispose(); windows.RemoveAt(windows.Count - 1); }
        for (int i = 0; i < displays.Length; i++) {
            string[] values = displays[i].Split(',');
            if (values.Length != 5) throw new Exception("Invalid display bounds");
            var bounds = new Rectangle(int.Parse(values[0], CultureInfo.InvariantCulture), int.Parse(values[1], CultureInfo.InvariantCulture),
                int.Parse(values[2], CultureInfo.InvariantCulture), int.Parse(values[3], CultureInfo.InvariantCulture));
            float scale = float.Parse(values[4], CultureInfo.InvariantCulture);
            if (scale < .5f || scale > 8 || bounds.Width < 1 || bounds.Height < 1 || (long)bounds.Width * bounds.Height > 64000000) throw new Exception("Invalid display dimensions");
            if (i == windows.Count) windows.Add(new CaptureSurface(this, bounds, scale));
            else { windows[i].Bounds = bounds; windows[i].UiScale = scale; }
        }
    }
    void Command(string command) {
        string[] parts = command.Split('|');
        string id = parts.Length > 1 ? parts[1] : "";
        try {
            if (parts[0] == "quit") { ExitThread(); return; }
            if (parts[0] == "cancel") { if (active == id) Cancel(); return; }
            if (parts[0] == "warm") { Configure(parts[2]); Send(new { type = "warmed", id }); return; }
            if (parts[0] != "select" || active != null) return;
            var watch = Stopwatch.StartNew();
            Configure(parts[2]); dragging = false;
            OverlayNative.DwmFlush();
            foreach (var window in windows) { window.ClearFrame(); window.Frame = new DesktopFrame(window.Bounds); }
            double grabMs = watch.Elapsed.TotalMilliseconds;
            active = id;
            CaptureSurface focus = windows[0];
            foreach (var window in windows) {
                window.Show();
                // Reassert native z-order on every activation, even if another
                // application's always-on-top window became active while idle.
                OverlayNative.SetWindowPos(window.Handle, new IntPtr(-1), 0, 0, 0, 0, 0x0013);
                window.Invalidate(); window.Update();
                if (window.Bounds.Contains(Cursor.Position)) focus = window;
            }
            OverlayNative.SetForegroundWindow(focus.Handle); focus.Activate();
            OverlayNative.DwmFlush();
            Send(new { type = "shown", id, nativeGrabMs = grabMs, nativeTotalMs = watch.Elapsed.TotalMilliseconds });
        } catch (Exception error) { HideAndRelease(); Send(new { type = "error", id, message = error.Message }); }
    }
    internal void Begin(Point point, float scale) { if (active == null) return; start = end = point; startScale = scale; dragging = true; Redraw(); }
    internal void Move(Point point) { if (!dragging) return; end = point; Redraw(); }
    void Redraw() { foreach (var window in windows) window.Invalidate(); }
    internal void Cancel() {
        string id = active; HideAndRelease();
        if (id != null) Send(new { type = "canceled", id });
    }
    void HideAndRelease() {
        active = null; dragging = false;
        foreach (var window in windows) { window.Capture = false; window.Hide(); window.ClearFrame(); }
    }
    internal void End(Point point) {
        if (active == null || !dragging) return;
        end = point; Rectangle selection = Selection;
        if (selection.Width < 8 * startScale || selection.Height < 8 * startScale) { dragging = false; Redraw(); return; }
        string id = active;
        try {
            if ((long)selection.Width * selection.Height > 64000000) throw new Exception("Selected region too large");
            Bitmap crop = new Bitmap(selection.Width, selection.Height, PixelFormat.Format32bppRgb);
            using (var graphics = Graphics.FromImage(crop)) {
                graphics.Clear(Color.White);
                foreach (var window in windows) {
                    Rectangle overlap = Rectangle.Intersect(selection, window.Bounds);
                    if (overlap.IsEmpty || window.Frame == null) continue;
                    var source = new Rectangle(overlap.X - window.Left, overlap.Y - window.Top, overlap.Width, overlap.Height);
                    var target = new Rectangle(overlap.X - selection.X, overlap.Y - selection.Y, overlap.Width, overlap.Height);
                    graphics.DrawImage(window.Frame.Image, target, source, GraphicsUnit.Pixel);
                }
            }
            HideAndRelease();
            // Only the selected crop crosses the process boundary. No full-screen
            // PNG work or browser rendering occurs on the shortcut's critical path.
            Task.Run(() => {
                try {
                    using (crop) using (var enhanced = Enhance(crop)) using (var stream = new MemoryStream()) {
                        enhanced.Save(stream, ImageFormat.Png);
                        Send(new { type = "selected", id, imageDataUrl = "data:image/png;base64," + Convert.ToBase64String(stream.ToArray()),
                            bounds = new { x = selection.X, y = selection.Y, width = selection.Width, height = selection.Height } });
                    }
                } catch (Exception error) { Send(new { type = "error", id, message = error.Message }); }
            });
        } catch (Exception error) { HideAndRelease(); Send(new { type = "error", id, message = error.Message }); }
    }
    static Bitmap Enhance(Bitmap source) {
        double scale = source.Width < 1400 ? Math.Min(2, 2800.0 / source.Width) : 1;
        var result = new Bitmap((int)Math.Round(source.Width * scale), (int)Math.Round(source.Height * scale), PixelFormat.Format32bppRgb);
        using (var graphics = Graphics.FromImage(result)) {
            graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
            graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
            graphics.DrawImage(source, new Rectangle(0, 0, result.Width, result.Height));
        }
        var data = result.LockBits(new Rectangle(0, 0, result.Width, result.Height), ImageLockMode.ReadWrite, PixelFormat.Format32bppRgb);
        try {
            byte[] row = new byte[result.Width * 4];
            for (int y = 0; y < result.Height; y++) {
                IntPtr address = IntPtr.Add(data.Scan0, y * data.Stride);
                Marshal.Copy(address, row, 0, row.Length);
                for (int x = 0; x < row.Length; x += 4) {
                    double gray = row[x + 2] * .299 + row[x + 1] * .587 + row[x] * .114;
                    byte value = (byte)Math.Max(0, Math.Min(255, Math.Round((gray - 128) * 1.16 + 128)));
                    row[x] = row[x + 1] = row[x + 2] = value; row[x + 3] = 255;
                }
                Marshal.Copy(row, 0, address, row.Length);
            }
        } finally { result.UnlockBits(data); }
        return result;
    }
    protected override void ExitThreadCore() {
        HideAndRelease(); foreach (var window in windows) window.Dispose(); windows.Clear(); dispatcher.Dispose(); base.ExitThreadCore();
    }
}

internal static class ScreenOverlay {
    [STAThread] static void Main() {
        try { OverlayNative.SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) { }
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new OverlaySession());
    }
}
