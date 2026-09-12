# print-raw.ps1 (Fassung 2)
# Sendet rohe ESC/POS-Bytes an eine Windows-Druckerwarteschlange (Datentyp RAW, Treiber wird umgangen),
# wartet, bis der Spooler den Auftrag an den Drucker abgegeben hat, und entfernt haengende Auftraege.
#
# Aufruf:  powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File print-raw.ps1 -Printer "TM-T20II" -File job.bin [-Timeout 10]
# stdout:  JSON  {"jobId":123,"bytes":220,"status":"accepted|removed|error","fehler":null}
# Exit:    0 = vom Drucker angenommen, 2 = hing im Spooler und wurde entfernt, 1 = Fehler (Warteschlange fehlt, WritePrinter, ...)
param(
  [Parameter(Mandatory)][string]$Printer,
  [Parameter(Mandatory)][string]$File,
  [string]$DocName = "Kasse",
  [int]$Timeout = 10
)
$ErrorActionPreference = 'Stop'

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
  // Liefert die Spooler-Job-ID; wirft bei Fehlern.
  public static int Send(string printer, byte[] data, string docName, out int written) {
    IntPtr h;
    if (!OpenPrinterW(printer, out h, IntPtr.Zero)) throw new Exception("OpenPrinter fehlgeschlagen, Win32-Fehler " + Marshal.GetLastWin32Error());
    try {
      var di = new DOCINFOW(); di.pDocName = docName; di.pDataType = "RAW";
      int jobId = StartDocPrinterW(h, 1, di);
      if (jobId == 0) throw new Exception("StartDocPrinter fehlgeschlagen, Win32-Fehler " + Marshal.GetLastWin32Error());
      try {
        if (!StartPagePrinter(h)) throw new Exception("StartPagePrinter fehlgeschlagen, Win32-Fehler " + Marshal.GetLastWin32Error());
        IntPtr p = Marshal.AllocHGlobal(data.Length);
        Marshal.Copy(data, 0, p, data.Length);
        bool ok = WritePrinter(h, p, data.Length, out written);
        Marshal.FreeHGlobal(p);
        EndPagePrinter(h);
        if (!ok) throw new Exception("WritePrinter fehlgeschlagen, Win32-Fehler " + Marshal.GetLastWin32Error());
        return jobId;
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
"@

function Out-Result([int]$jobId, [int]$bytes, [string]$status, [string]$fehler, [int]$code) {
  $o = [ordered]@{ jobId = $jobId; bytes = $bytes; status = $status; fehler = $fehler }
  Write-Output ($o | ConvertTo-Json -Compress)
  exit $code
}

try {
  Add-Type -TypeDefinition $src -Language CSharp
  $bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $File))
  $written = 0
  $jobId = [RawPrinter]::Send($Printer, $bytes, $DocName, [ref]$written)
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  Out-Result 0 0 'error' $_.Exception.Message 1
}

# Warten, bis der Auftrag den Spooler verlassen hat (= vom Drucker in den Puffer uebernommen).
$deadline = (Get-Date).AddSeconds($Timeout)
$bad = 'Error|Offline|PaperOut|Blocked|UserIntervention|Deleting'
while ($true) {
  $job = Get-PrintJob -PrinterName $Printer -ID $jobId -ErrorAction SilentlyContinue
  if (-not $job) { Out-Result $jobId $written 'accepted' $null 0 }
  $st = [string]$job.JobStatus
  if ($st -match $bad -or (Get-Date) -gt $deadline) {
    try { Remove-PrintJob -PrinterName $Printer -ID $jobId -ErrorAction Stop } catch { }
    $grund = if ($st -match $bad) { "Auftrag im Zustand '$st', entfernt" } else { "Auftrag nach $Timeout s noch im Spooler, entfernt" }
    [Console]::Error.WriteLine($grund)
    Out-Result $jobId $written 'removed' $grund 2
  }
  Start-Sleep -Milliseconds 500
}
