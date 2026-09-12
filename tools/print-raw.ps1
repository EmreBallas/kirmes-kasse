# Sendet eine Datei mit rohen ESC/POS-Bytes an einen Windows-Drucker (Datentyp RAW, Treiber wird umgangen).
# Aufruf: powershell -NoProfile -ExecutionPolicy Bypass -File tools\print-raw.ps1 -Printer "TM-T20II" -File bon.bin
param(
  [Parameter(Mandatory)][string]$Printer,
  [Parameter(Mandatory)][string]$File,
  [string]$DocName = "Kirmes RAW"
)
$src = @"
using System;
using System.Runtime.InteropServices;
public class RawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public class DOCINFOW {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool OpenPrinterW(string src, out IntPtr h, IntPtr pd);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)] static extern int StartDocPrinterW(IntPtr h, int level, [In] DOCINFOW di);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool WritePrinter(IntPtr h, IntPtr buf, int len, out int written);
  public static int Send(string printer, byte[] data, string docName) {
    IntPtr h;
    if (!OpenPrinterW(printer, out h, IntPtr.Zero)) throw new Exception("OpenPrinter fehlgeschlagen, Win32-Fehler " + Marshal.GetLastWin32Error());
    try {
      var di = new DOCINFOW(); di.pDocName = docName; di.pDataType = "RAW";
      if (StartDocPrinterW(h, 1, di) == 0) throw new Exception("StartDocPrinter fehlgeschlagen, Win32-Fehler " + Marshal.GetLastWin32Error());
      try {
        if (!StartPagePrinter(h)) throw new Exception("StartPagePrinter fehlgeschlagen, Win32-Fehler " + Marshal.GetLastWin32Error());
        IntPtr p = Marshal.AllocHGlobal(data.Length);
        Marshal.Copy(data, 0, p, data.Length);
        int written; bool ok = WritePrinter(h, p, data.Length, out written);
        Marshal.FreeHGlobal(p);
        EndPagePrinter(h);
        if (!ok) throw new Exception("WritePrinter fehlgeschlagen, Win32-Fehler " + Marshal.GetLastWin32Error());
        return written;
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
"@
Add-Type -TypeDefinition $src -Language CSharp
$bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $File))
$n = [RawPrinter]::Send($Printer, $bytes, $DocName)
Write-Output "Gesendet: $n Bytes an '$Printer'"
