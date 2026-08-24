# Extracts the plain text of the provided Blueprint-First architecture
# document (.docx) into docs/spec so the source-of-truth travels with the
# project. Read-only against the .docx; writes only inside this repository.
#
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File tools\extract-spec.ps1

param(
    [string]$DocxPath = 'C:\Users\adede\OneDrive\Documents\victor 5.docx',
    [string]$OutPath = ''
)

if (-not $OutPath -or $OutPath.Length -eq 0) {
    $OutPath = Join-Path $PSScriptRoot '..\docs\spec\blueprint-first-architecture-2.0.extracted.txt'
}

if (-not (Test-Path $DocxPath)) {
    Write-Error "Source document not found: $DocxPath"
    exit 2
}

Add-Type -AssemblyName System.IO.Compression.FileSystem

$zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $DocxPath).Path)
try {
    $entry = $zip.Entries | Where-Object { $_.FullName -eq 'word/document.xml' }
    if (-not $entry) {
        Write-Error 'Not a Word document (word/document.xml missing).'
        exit 3
    }
    $reader = New-Object System.IO.StreamReader($entry.Open())
    try { $xml = $reader.ReadToEnd() } finally { $reader.Close() }
}
finally { $zip.Dispose() }

# Paragraph and line breaks become newlines before tag stripping.
$xml = $xml -replace '<w:p [^>]*>', "`n" -replace '<w:p>', "`n" -replace '<w:br[^>]*/>', "`n" -replace '<w:tab[^>]*/>', "`t"
$text = $xml -replace '<[^>]+>', ''

# Minimal entity decoding.
$text = $text.Replace('&amp;', '&').Replace('&lt;', '<').Replace('&gt;', '>').Replace('&quot;', '"').Replace('&apos;', "'")

# Collapse runs of blank lines.
$text = [regex]::Replace($text, "(`r?`n){3,}", "`n`n")

$fullOut = [System.IO.Path]::GetFullPath($OutPath)
$dir = Split-Path $fullOut -Parent
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$writer = New-Object System.IO.StreamWriter($fullOut, $false, (New-Object System.Text.UTF8Encoding($false)))
try { $writer.Write($text) } finally { $writer.Close() }

$hash = Get-FileHash $DocxPath -Algorithm SHA256
Write-Output ("Extracted '{0}' ({1} bytes)" -f $fullOut, (Get-Item $fullOut).Length)
Write-Output ("Source SHA256: {0}" -f $hash.Hash)
