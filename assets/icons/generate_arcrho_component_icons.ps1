param(
    [string]$OutDir = $PSScriptRoot
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

function New-RoundedRectPath([float]$X, [float]$Y, [float]$W, [float]$H, [float]$R) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $R * 2
    $path.AddArc($X, $Y, $d, $d, 180, 90)
    $path.AddArc($X + $W - $d, $Y, $d, $d, 270, 90)
    $path.AddArc($X + $W - $d, $Y + $H - $d, $d, $d, 0, 90)
    $path.AddArc($X, $Y + $H - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    $path
}

function Add-QuadraticCurve($Path, [float]$X0, [float]$Y0, [float]$Cx, [float]$Cy, [float]$X1, [float]$Y1) {
    $c1x = $X0 + (2.0 / 3.0) * ($Cx - $X0)
    $c1y = $Y0 + (2.0 / 3.0) * ($Cy - $Y0)
    $c2x = $X1 + (2.0 / 3.0) * ($Cx - $X1)
    $c2y = $Y1 + (2.0 / 3.0) * ($Cy - $Y1)
    $Path.AddBezier($X0, $Y0, $c1x, $c1y, $c2x, $c2y, $X1, $Y1)
}

function New-WingPath([int]$Size, [string]$Layer) {
    $s = $Size / 512.0
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath

    if ($Layer -eq "front") {
        $path.StartFigure()
        $path.AddLine(85 * $s, 420 * $s, 85 * $s, 200 * $s)
        Add-QuadraticCurve $path (85 * $s) (200 * $s) (170 * $s) (120 * $s) (360 * $s) (70 * $s)
        $path.AddLine(360 * $s, 70 * $s, 85 * $s, 420 * $s)
    }
    elseif ($Layer -eq "middle") {
        $path.StartFigure()
        $path.AddLine(85 * $s, 420 * $s, 130 * $s, 250 * $s)
        Add-QuadraticCurve $path (130 * $s) (250 * $s) (200 * $s) (180 * $s) (400 * $s) (120 * $s)
        $path.AddLine(400 * $s, 120 * $s, 85 * $s, 420 * $s)
    }
    else {
        $path.StartFigure()
        $path.AddLine(85 * $s, 420 * $s, 180 * $s, 300 * $s)
        Add-QuadraticCurve $path (180 * $s) (300 * $s) (240 * $s) (250 * $s) (430 * $s) (180 * $s)
        $path.AddLine(430 * $s, 180 * $s, 85 * $s, 420 * $s)
    }

    $path.CloseFigure()
    $path
}

function New-WingGradientBrush([int]$Size, [System.Drawing.Color[]]$Colors, [int]$Alpha) {
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        [System.Drawing.PointF]::new(0, $Size),
        [System.Drawing.PointF]::new($Size, 0),
        [System.Drawing.Color]::FromArgb($Alpha, $Colors[0].R, $Colors[0].G, $Colors[0].B),
        [System.Drawing.Color]::FromArgb($Alpha, $Colors[2].R, $Colors[2].G, $Colors[2].B)
    )
    $blend = New-Object System.Drawing.Drawing2D.ColorBlend 3
    $blend.Positions = [single[]]@(0.0, 0.45, 1.0)
    $blend.Colors = [System.Drawing.Color[]]@(
        [System.Drawing.Color]::FromArgb($Alpha, $Colors[0].R, $Colors[0].G, $Colors[0].B),
        [System.Drawing.Color]::FromArgb($Alpha, $Colors[1].R, $Colors[1].G, $Colors[1].B),
        [System.Drawing.Color]::FromArgb($Alpha, $Colors[2].R, $Colors[2].G, $Colors[2].B)
    )
    $brush.InterpolationColors = $blend
    $brush
}

function New-BitmapGraphics([int]$Size) {
    $bmp = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    @($bmp, $g)
}

function Draw-BaseIcon($g, [int]$Size, [System.Drawing.Color[]]$Colors) {
    $s = $Size / 512.0
    $tile = New-RoundedRectPath (32 * $s) (32 * $s) (448 * $s) (448 * $s) (88 * $s)

    $shadowPath = New-RoundedRectPath (34 * $s) (38 * $s) (444 * $s) (444 * $s) (86 * $s)
    $shadowBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(24, 15, 23, 42))
    $g.FillPath($shadowBrush, $shadowPath)
    $shadowBrush.Dispose()
    $shadowPath.Dispose()

    $tileBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 250, 250, 250))
    $g.FillPath($tileBrush, $tile)
    $tileBrush.Dispose()

    foreach ($layerSpec in @(@("front", 224), @("middle", 128), @("back", 64))) {
        $wing = New-WingPath $Size $layerSpec[0]
        $brush = New-WingGradientBrush $Size $Colors $layerSpec[1]
        $g.FillPath($brush, $wing)
        $brush.Dispose()
        $wing.Dispose()
    }

    $borderPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 229, 231, 235)), (2 * $s)
    $g.DrawPath($borderPen, $tile)
    $borderPen.Dispose()
    $tile.Dispose()
}

function Save-IcoFromPngs([string]$OutPath, [byte[][]]$Images, [int[]]$Sizes) {
    $fs = [System.IO.File]::Create($OutPath)
    try {
        $bw = New-Object System.IO.BinaryWriter $fs
        $bw.Write([UInt16]0)
        $bw.Write([UInt16]1)
        $bw.Write([UInt16]$Images.Length)
        $offset = 6 + (16 * $Images.Length)
        for ($i = 0; $i -lt $Images.Length; $i++) {
            $sizeByte = if ($Sizes[$i] -eq 256) { 0 } else { $Sizes[$i] }
            $bw.Write([byte]$sizeByte)
            $bw.Write([byte]$sizeByte)
            $bw.Write([byte]0)
            $bw.Write([byte]0)
            $bw.Write([UInt16]1)
            $bw.Write([UInt16]32)
            $bw.Write([UInt32]$Images[$i].Length)
            $bw.Write([UInt32]$offset)
            $offset += $Images[$i].Length
        }
        foreach ($img in $Images) {
            $bw.Write($img)
        }
    }
    finally {
        $fs.Dispose()
    }
}

function New-ComponentSvg([string]$Name, [string[]]$HexColors) {
@"
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="$($Name.Replace(' ', ''))Gradient" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="$($HexColors[0])"/>
      <stop offset="45%" stop-color="$($HexColors[1])"/>
      <stop offset="100%" stop-color="$($HexColors[2])"/>
    </linearGradient>
  </defs>
  <rect x="34" y="38" width="444" height="444" rx="86" fill="#0f172a" opacity="0.09"/>
  <rect x="32" y="32" width="448" height="448" rx="88" fill="#fafafa"/>
  <path d="M 85 420 L 85 200 Q 170 120 360 70 L 85 420 Z" fill="url(#$($Name.Replace(' ', ''))Gradient)" opacity="0.88"/>
  <path d="M 85 420 L 130 250 Q 200 180 400 120 L 85 420 Z" fill="url(#$($Name.Replace(' ', ''))Gradient)" opacity="0.5"/>
  <path d="M 85 420 L 180 300 Q 240 250 430 180 L 85 420 Z" fill="url(#$($Name.Replace(' ', ''))Gradient)" opacity="0.25"/>
  <rect x="32" y="32" width="448" height="448" rx="88" fill="none" stroke="#e5e7eb" stroke-width="2"/>
</svg>
"@
}

function Render-ComponentIcon([string]$Name, [string]$Slug, [System.Drawing.Color[]]$Colors, [string[]]$HexColors) {
    $pngPath = Join-Path $OutDir "$Name.png"
    $icoPath = Join-Path $OutDir "$Name.ico"
    $svgPath = Join-Path $OutDir "$Name.svg"
    $sizes = @(16, 24, 32, 48, 64, 128, 256)
    $pngImages = New-Object 'System.Collections.Generic.List[byte[]]'

    New-ComponentSvg $Name $HexColors | Set-Content -Path $svgPath -Encoding UTF8

    $preview = New-BitmapGraphics 1024
    $bmp = $preview[0]
    $g = $preview[1]
    Draw-BaseIcon $g 1024 $Colors
    $bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()

    foreach ($size in $sizes) {
        $pair = New-BitmapGraphics $size
        $bmp = $pair[0]
        $g = $pair[1]
        Draw-BaseIcon $g $size $Colors
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $pngImages.Add($ms.ToArray())
        $ms.Dispose()
        $g.Dispose()
        $bmp.Dispose()
    }

    Save-IcoFromPngs $icoPath $pngImages.ToArray() $sizes
    Write-Host "Generated $Slug icon: $icoPath"
}

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

$engineColors = [System.Drawing.Color[]]@(
    [System.Drawing.ColorTranslator]::FromHtml("#0284c7"),
    [System.Drawing.ColorTranslator]::FromHtml("#2563eb"),
    [System.Drawing.ColorTranslator]::FromHtml("#1e3a8a")
)
$orchestratorColors = [System.Drawing.Color[]]@(
    [System.Drawing.ColorTranslator]::FromHtml("#7c3aed"),
    [System.Drawing.ColorTranslator]::FromHtml("#4f46e5"),
    [System.Drawing.ColorTranslator]::FromHtml("#312e81")
)
$launcherColors = [System.Drawing.Color[]]@(
    [System.Drawing.ColorTranslator]::FromHtml("#059669"),
    [System.Drawing.ColorTranslator]::FromHtml("#14b8a6"),
    [System.Drawing.ColorTranslator]::FromHtml("#0f766e")
)

Render-ComponentIcon "ArcRho Engine" "engine" $engineColors @("#0284c7", "#2563eb", "#1e3a8a")
Render-ComponentIcon "ArcRho Orchestrator" "orchestrator" $orchestratorColors @("#7c3aed", "#4f46e5", "#312e81")
Render-ComponentIcon "ArcRho Launcher" "launcher" $launcherColors @("#059669", "#14b8a6", "#0f766e")
