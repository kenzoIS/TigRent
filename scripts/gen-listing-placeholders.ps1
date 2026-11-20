# Generates clearly-labelled SAMPLE placeholder photos for the seeded demo listings (plan §9:
# "use safe placeholder images"). Output: assets/listings/<listing-id>.png (800x600).
param([string]$OutDir = (Join-Path $PSScriptRoot '..\assets\listings'))
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force $OutDir | Out-Null

$items = @(
  @('11111111-0000-4000-8000-000000000001', 'Casio fx-991EX', 'Calculators'),
  @('11111111-0000-4000-8000-000000000002', 'Canon EOS 200D DSLR', 'Photo & video'),
  @('11111111-0000-4000-8000-000000000003', 'Portable projector', 'Presentation'),
  @('11111111-0000-4000-8000-000000000004', 'Aluminum laptop stand', 'Laptop accessories'),
  @('11111111-0000-4000-8000-000000000005', 'Drafting set', 'Drafting & art'),
  @('22222222-0000-4000-8000-000000000001', 'Travel tripod', 'Photo & video'),
  @('22222222-0000-4000-8000-000000000002', '18-inch ring light', 'Photo & video'),
  @('22222222-0000-4000-8000-000000000003', 'TI-84 Plus', 'Calculators'),
  @('22222222-0000-4000-8000-000000000004', 'USB-C hub', 'Laptop accessories'),
  @('33333333-0000-4000-8000-000000000001', 'Architect scale rulers', 'Drafting & art'),
  @('33333333-0000-4000-8000-000000000002', 'Presenter clicker', 'Presentation'),
  @('44444444-0000-4000-8000-000000000001', 'Extension cord', 'Power & cables')
)
$palette = @('#F5E9C6', '#F3ECDC', '#FBEFD9', '#EDE3CF')

$i = 0
foreach ($it in $items) {
  $bmp = New-Object System.Drawing.Bitmap 800, 600
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.Clear([System.Drawing.ColorTranslator]::FromHtml($palette[$i % $palette.Count]))
  # Soft gold arc, echoing the app's ambient background.
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(70, 212, 162, 30)), 46
  $g.DrawArc($pen, -200, 330, 1200, 520, 200, 140)
  $ink = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#17150F'))
  $muted = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#665F53'))
  $red = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#B8443A'))
  $center = New-Object System.Drawing.StringFormat
  $center.Alignment = 'Center'
  $center.LineAlignment = 'Center'
  $g.DrawString($it[2].ToUpper(), (New-Object System.Drawing.Font('Segoe UI', 18, [System.Drawing.FontStyle]::Bold)), $muted, (New-Object System.Drawing.RectangleF(0, 170, 800, 40)), $center)
  $g.DrawString($it[1], (New-Object System.Drawing.Font('Segoe UI', 44, [System.Drawing.FontStyle]::Bold)), $ink, (New-Object System.Drawing.RectangleF(40, 220, 720, 140)), $center)
  $g.DrawString('SAMPLE PHOTO - TigRent demo listing', (New-Object System.Drawing.Font('Segoe UI', 18, [System.Drawing.FontStyle]::Bold)), $red, (New-Object System.Drawing.RectangleF(0, 520, 800, 40)), $center)
  $bmp.Save((Join-Path $OutDir ($it[0] + '.png')), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose(); $i++
}
"Generated $($items.Count) placeholder photos in $OutDir"
