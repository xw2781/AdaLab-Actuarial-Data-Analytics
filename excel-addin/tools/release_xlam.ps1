param(
    [string]$BetaPath = (Join-Path $PSScriptRoot "..\beta\ARCRHO_BETA.xlam"),
    [string]$ReleasePath = "E:\ArcRho Server\Excel Add-ins\ArcRho.xlam",
    [string]$CustomUIPath = (Join-Path $PSScriptRoot "customUI.xml"),
    [string]$SignatureDir = (Join-Path $PSScriptRoot "..\signature"),
    [string]$ArchiveDir = (Join-Path $PSScriptRoot "..\beta\Archive"),
    [string]$ExtractDir = (Join-Path $PSScriptRoot "..\beta\_release_unpack")
)

$ErrorActionPreference = "Stop"

function Resolve-FullPath([string]$Path) {
    $executionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
}

function Clear-ReadOnly([string]$Path) {
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        $item = Get-Item -LiteralPath $Path
        if (($item.Attributes -band [System.IO.FileAttributes]::ReadOnly) -ne 0) {
            $item.Attributes = $item.Attributes -band (-bnot [System.IO.FileAttributes]::ReadOnly)
        }
    }
}

function Copy-SignatureFiles([string]$SourceDir, [string]$TargetDir) {
    $signatureNames = @(
        "vbaProjectSignature.bin",
        "vbaProjectSignatureAgile.bin",
        "vbaProjectSignatureV3.bin"
    )

    foreach ($name in $signatureNames) {
        $source = Join-Path $SourceDir $name
        if (Test-Path -LiteralPath $source -PathType Leaf) {
            Copy-Item -LiteralPath $source -Destination $TargetDir -Force
            Write-Host "Updated signature file: $name"
        }
        else {
            Write-Warning "Signature file not found: $source"
        }
    }
}

function Get-RibbonLabelForWorkbook([string]$WorkbookPath) {
    [System.IO.Path]::GetFileNameWithoutExtension($WorkbookPath)
}

function New-CustomUIXmlForWorkbook([string]$RibbonXmlPath, [string]$WorkbookPath, [string]$WorkingDir) {
    if (-not (Test-Path -LiteralPath $WorkingDir -PathType Container)) {
        New-Item -ItemType Directory -Path $WorkingDir | Out-Null
    }

    $label = Get-RibbonLabelForWorkbook $WorkbookPath
    [xml]$xml = Get-Content -LiteralPath $RibbonXmlPath -Raw

    $namespaceUri = $xml.DocumentElement.NamespaceURI
    if ([string]::IsNullOrEmpty($namespaceUri)) {
        $tab = $xml.SelectSingleNode("//tab")
    }
    else {
        $namespaceManager = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
        $namespaceManager.AddNamespace("ui", $namespaceUri)
        $tab = $xml.SelectSingleNode("//ui:tab", $namespaceManager)
    }

    if ($null -eq $tab) {
        throw "Ribbon XML does not contain a tab element: $RibbonXmlPath"
    }

    $tab.SetAttribute("label", $label)

    $tempPath = Join-Path $WorkingDir ("customUI.{0}.xml" -f [System.Guid]::NewGuid().ToString("N"))
    $settings = New-Object System.Xml.XmlWriterSettings
    $settings.Indent = $true
    $settings.OmitXmlDeclaration = $true
    $settings.Encoding = New-Object System.Text.UTF8Encoding($false)

    $writer = [System.Xml.XmlWriter]::Create($tempPath, $settings)
    try {
        $xml.Save($writer)
    }
    finally {
        $writer.Close()
    }

    Write-Host "Using ribbon tab label: $label"
    $tempPath
}

function Update-XlamPackageFromUnpackedFiles(
    [string]$WorkbookPath,
    [string]$RibbonXmlPath,
    [string]$SignaturesPath,
    [string]$WorkingDir,
    [string]$LabelWorkbookPath = $WorkbookPath
) {
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    if (Test-Path -LiteralPath $WorkingDir) {
        Remove-Item -LiteralPath $WorkingDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $WorkingDir | Out-Null

    [System.IO.Compression.ZipFile]::ExtractToDirectory($WorkbookPath, $WorkingDir)

    $customUIDir = Join-Path $WorkingDir "customUI"
    if (-not (Test-Path -LiteralPath $customUIDir -PathType Container)) {
        New-Item -ItemType Directory -Path $customUIDir | Out-Null
    }

    $tempRibbonXmlPath = New-CustomUIXmlForWorkbook $RibbonXmlPath $LabelWorkbookPath ([System.IO.Path]::GetTempPath())
    try {
        Copy-Item -LiteralPath $tempRibbonXmlPath -Destination (Join-Path $customUIDir "customUI.xml") -Force
    }
    finally {
        if (Test-Path -LiteralPath $tempRibbonXmlPath -PathType Leaf) {
            Remove-Item -LiteralPath $tempRibbonXmlPath -Force
        }
    }
    Write-Host "Updated ribbon XML: $RibbonXmlPath"

    $xlDir = Join-Path $WorkingDir "xl"
    if (-not (Test-Path -LiteralPath $xlDir -PathType Container)) {
        throw "Unpacked workbook is missing xl folder: $WorkbookPath"
    }

    Copy-SignatureFiles $SignaturesPath $xlDir

    $zipPath = [System.IO.Path]::ChangeExtension($WorkbookPath, ".zip")
    if (Test-Path -LiteralPath $zipPath -PathType Leaf) {
        Remove-Item -LiteralPath $zipPath -Force
    }

    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $WorkingDir,
        $zipPath,
        [System.IO.Compression.CompressionLevel]::Optimal,
        $false
    )

    Clear-ReadOnly $WorkbookPath
    Move-Item -LiteralPath $zipPath -Destination $WorkbookPath -Force
    Remove-Item -LiteralPath $WorkingDir -Recurse -Force
}

$betaPathFull = Resolve-FullPath $BetaPath
$releasePathFull = Resolve-FullPath $ReleasePath
$customUIPathFull = Resolve-FullPath $CustomUIPath
$signatureDirFull = Resolve-FullPath $SignatureDir
$archiveDirFull = Resolve-FullPath $ArchiveDir
$extractDirFull = Resolve-FullPath $ExtractDir

if (-not (Test-Path -LiteralPath $betaPathFull -PathType Leaf)) {
    throw "Beta XLAM not found: $betaPathFull"
}

if (-not (Test-Path -LiteralPath $customUIPathFull -PathType Leaf)) {
    throw "Ribbon XML not found: $customUIPathFull"
}

if (-not (Test-Path -LiteralPath $signatureDirFull -PathType Container)) {
    throw "Signature folder not found: $signatureDirFull"
}

if (-not (Test-Path -LiteralPath $archiveDirFull -PathType Container)) {
    New-Item -ItemType Directory -Path $archiveDirFull | Out-Null
}

Update-XlamPackageFromUnpackedFiles $betaPathFull $customUIPathFull $signatureDirFull $extractDirFull $betaPathFull

if (Test-Path -LiteralPath $releasePathFull -PathType Leaf) {
    Clear-ReadOnly $releasePathFull
    $timestamp = Get-Date -Format "yy.MM.dd-HH.mm.ss"
    $milliseconds = (Get-Date).Millisecond
    $archiveName = "ArcRho v.$timestamp ($milliseconds).xlam"
    $archivePath = Join-Path $archiveDirFull $archiveName
    Move-Item -LiteralPath $releasePathFull -Destination $archivePath -Force
    Write-Host "Archived existing XLAM: $archivePath"
}

Copy-Item -LiteralPath $betaPathFull -Destination $releasePathFull -Force
Update-XlamPackageFromUnpackedFiles $releasePathFull $customUIPathFull $signatureDirFull $extractDirFull $releasePathFull
(Get-Item -LiteralPath $releasePathFull).Attributes =
    (Get-Item -LiteralPath $releasePathFull).Attributes -bor [System.IO.FileAttributes]::ReadOnly

Write-Host "Released XLAM: $releasePathFull"
