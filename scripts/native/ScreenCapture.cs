// Windows 10/11 inbox .NET Framework helper. No screenshot files or network access.
using System;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;

class ScreenCapture {
    [StructLayout(LayoutKind.Sequential)] struct BitmapInfo {
        public uint Size; public int Width, Height; public ushort Planes, BitCount;
        public uint Compression, SizeImage; public int XPels, YPels; public uint Used, Important;
    }
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr window);
    [DllImport("dwmapi.dll")] static extern int DwmFlush();
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr window, IntPtr dc);
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern IntPtr CreateDIBSection(IntPtr dc, ref BitmapInfo info, uint usage, out IntPtr bits, IntPtr section, uint offset);
    [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
    [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern bool GdiFlush();
    [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr dest, int x, int y, int width, int height, IntPtr source, int sourceX, int sourceY, uint operation);

    static byte[] Capture(int x, int y, int width, int height) {
        if (width < 1 || height < 1 || (long)width * height > 64000000) throw new ArgumentException("Invalid capture dimensions");
        int byteCount = checked(width * height * 4);
        IntPtr source = GetDC(IntPtr.Zero), target = IntPtr.Zero, bitmap = IntPtr.Zero, previous = IntPtr.Zero;
        try {
            if (source == IntPtr.Zero) throw new Exception("Screen DC unavailable");
            target = CreateCompatibleDC(source);
            var info = new BitmapInfo { Size = 40, Width = width, Height = -height, Planes = 1, BitCount = 32, SizeImage = (uint)byteCount };
            IntPtr pixels;
            bitmap = CreateDIBSection(source, ref info, 0, out pixels, IntPtr.Zero, 0);
            if (target == IntPtr.Zero || bitmap == IntPtr.Zero || pixels == IntPtr.Zero) throw new Exception("Screen bitmap unavailable");
            previous = SelectObject(target, bitmap);
            if (!BitBlt(target, 0, 0, width, height, source, x, y, 0x40CC0020)) throw new Exception("Screen copy failed");
            GdiFlush();
            byte[] result = new byte[54 + byteCount];
            using (var writer = new BinaryWriter(new MemoryStream(result))) {
                writer.Write((ushort)0x4D42); writer.Write(result.Length); writer.Write(0); writer.Write(54);
                writer.Write(40); writer.Write(width); writer.Write(-height); writer.Write((ushort)1); writer.Write((ushort)32);
                writer.Write(0); writer.Write(byteCount); writer.Write(0); writer.Write(0); writer.Write(0); writer.Write(0);
            }
            Marshal.Copy(pixels, result, 54, byteCount);
            return result;
        } finally {
            if (previous != IntPtr.Zero && target != IntPtr.Zero) SelectObject(target, previous);
            if (bitmap != IntPtr.Zero) DeleteObject(bitmap);
            if (target != IntPtr.Zero) DeleteDC(target);
            if (source != IntPtr.Zero) ReleaseDC(IntPtr.Zero, source);
        }
    }
    static void Main() {
        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch (EntryPointNotFoundException) { }
        using (var output = new BinaryWriter(Console.OpenStandardOutput())) {
            output.Write(0x434E494E); output.Flush(); // NINC: ready; never take a screenshot during warmup.
            string line;
            while ((line = Console.ReadLine()) != null) {
                try {
                    string[] request = line.Split('|');
                    if (request.Length == 2 && request[0].Length > 0) {
                        int disabled = 1;
                        foreach (string handle in request[0].Split(',')) {
                            // DWMWA_TRANSITIONS_FORCEDISABLED: capture overlays must appear
                            // and disappear immediately, without Windows fade animation.
                            DwmSetWindowAttribute(new IntPtr(long.Parse(handle, CultureInfo.InvariantCulture)), 3, ref disabled, 4);
                        }
                    }
                    // Finish pending hide/show composition before reading the desktop.
                    // This prevents a rapid recapture from including the previous overlay.
                    DwmFlush();
                    string[] displays = request[request.Length - 1].Split(';');
                    if (displays.Length > 32) throw new ArgumentException("Too many displays");
                    // Capture every monitor before sending any pixels, to keep the frozen instant close.
                    byte[][] frames = new byte[displays.Length][];
                    for (int i = 0; i < displays.Length; i++) {
                        string[] bounds = displays[i].Split(',');
                        if (bounds.Length != 4) throw new ArgumentException("Invalid bounds");
                        frames[i] = Capture(int.Parse(bounds[0], CultureInfo.InvariantCulture), int.Parse(bounds[1], CultureInfo.InvariantCulture),
                            int.Parse(bounds[2], CultureInfo.InvariantCulture), int.Parse(bounds[3], CultureInfo.InvariantCulture));
                    }
                    foreach (byte[] frame in frames) { output.Write(frame.Length); output.Write(frame); }
                    output.Flush();
                } catch (Exception error) { Console.Error.WriteLine(error.Message); output.Write(-1); output.Flush(); }
            }
        }
    }
}
