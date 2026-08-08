Add-Type -AssemblyName System.Drawing

$outputDirectory = Join-Path $PSScriptRoot '..\src\main\__fixtures__\ocr'
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null

$fixtures = @(
  @{ Code = 'zh-Hans'; Text = ([string][char]0x622A + [char]0x56FE + [char]0x7FFB + [char]0x8BD1); Font = 'Microsoft YaHei UI' },
  @{ Code = 'zh-Hant'; Text = ([string][char]0x87A2 + [char]0x5E55 + [char]0x7FFB + [char]0x8B6F); Font = 'Microsoft JhengHei UI' },
  @{ Code = 'en'; Text = 'Screenshot translation'; Font = 'Segoe UI' },
  @{ Code = 'ja'; Text = ([string][char]0x753B + [char]0x9762 + [char]0x7FFB + [char]0x8A33); Font = 'Yu Gothic UI' },
  @{ Code = 'ko'; Text = ([string][char]0xD654 + [char]0xBA74 + ' ' + [char]0xBC88 + [char]0xC5ED); Font = 'Malgun Gothic' },
  @{ Code = 'fr'; Text = ('Traduction fran' + [char]0x00E7 + 'aise'); Font = 'Segoe UI' },
  @{ Code = 'de'; Text = ('Deutsche ' + [char]0x00DC + 'bersetzung'); Font = 'Segoe UI' },
  @{ Code = 'es'; Text = ('Traducci' + [char]0x00F3 + 'n espa' + [char]0x00F1 + 'ola'); Font = 'Segoe UI' },
  @{ Code = 'pt'; Text = ('Tradu' + [char]0x00E7 + [char]0x00E3 + 'o portuguesa'); Font = 'Segoe UI' },
  @{ Code = 'ru'; Text = ([string][char]0x041F + [char]0x0435 + [char]0x0440 + [char]0x0435 + [char]0x0432 + [char]0x043E + [char]0x0434 + ' ' + [char]0x044D + [char]0x043A + [char]0x0440 + [char]0x0430 + [char]0x043D + [char]0x0430); Font = 'Segoe UI' }
)

foreach ($fixture in $fixtures) {
  $bitmap = [System.Drawing.Bitmap]::new(900, 150)
  $bitmap.SetResolution(96, 96)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear([System.Drawing.Color]::White)
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $font = [System.Drawing.Font]::new($fixture.Font, 40, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Point)
    try {
      $graphics.DrawString($fixture.Text, $font, [System.Drawing.Brushes]::Black, 28, 28)
    } finally {
      $font.Dispose()
    }
    $target = Join-Path $outputDirectory "$($fixture.Code).png"
    $bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

Write-Output "Generated $($fixtures.Count) OCR fixtures in $outputDirectory"
