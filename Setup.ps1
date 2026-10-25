$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
$OutputEncoding = [Console]::OutputEncoding
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$editorNode = Join-Path $PSScriptRoot 'runtime\node.exe'
if (-not (Test-Path -LiteralPath $editorNode)) { $editorNode = (Get-Command node -ErrorAction Stop).Source }
$setupScript = Join-Path $PSScriptRoot 'scripts\configure.mjs'
if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'settings.json')) { return }
$steamExtra = @()
foreach ($registryPath in @('HKCU:\Software\Valve\Steam','HKLM:\SOFTWARE\WOW6432Node\Valve\Steam')) {
    try { $registryValue = Get-ItemProperty -LiteralPath $registryPath; if ($registryValue.SteamPath) { $steamExtra += $registryValue.SteamPath }; if ($registryValue.InstallPath) { $steamExtra += $registryValue.InstallPath } } catch {}
}
try { $detected = & $editorNode $setupScript discover @steamExtra | ConvertFrom-Json } catch { $detected = @{} }
$form = New-Object System.Windows.Forms.Form
$form.Text = '电竞经理 2026 数据库编辑器 - 首次启动配置'
$form.ClientSize = New-Object System.Drawing.Size(810,510)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.Font = New-Object System.Drawing.Font('Microsoft YaHei UI',10)
$intro = New-Object System.Windows.Forms.Label
$intro.Text = "选择你自己的游戏和素材。程序会建立独立工作副本。`r`n图片可选择整个 emskin 或 ImagesPack 根目录；模组目录可选。"
$intro.SetBounds(20,15,770,58)
$form.Controls.Add($intro)
$fields = @{}
$rows = @(@('gamePath','游戏安装文件夹（必选）','folder'),@('source','.emdb 数据库（必选）','file'),@('imageRoot','配套图片根目录（可选）','folder'),@('modRoot','原模组目录（可选，用于整包导出）','folder'),@('skinRoot','皮肤目录（可选，叠加到模组）','folder'))
$rowIndex = 0
foreach ($row in $rows) {
    $top = 80 + $rowIndex * 70
    $label = New-Object System.Windows.Forms.Label
    $label.Text = $row[1]; $label.SetBounds(20,$top,750,24); $form.Controls.Add($label)
    $box = New-Object System.Windows.Forms.TextBox
    $box.SetBounds(20,($top+26),660,28); $box.Text = [string]$detected.($row[0]); $fields[$row[0]] = $box; $form.Controls.Add($box)
    $button = New-Object System.Windows.Forms.Button
    $button.Text = '选择…'; $button.SetBounds(690,($top+24),95,31)
    $button.Tag = @{ Key=$row[0]; Kind=$row[2] }
    $button.Add_Click({
        if ($this.Tag.Kind -eq 'file') { $picker = New-Object System.Windows.Forms.OpenFileDialog; $picker.Filter = 'EMDB 数据库 (*.emdb)|*.emdb' }
        else { $picker = New-Object System.Windows.Forms.FolderBrowserDialog; $picker.Description = '选择文件夹'; $picker.ShowNewFolderButton = $false }
        if ($picker.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) {
            if ($this.Tag.Kind -eq 'file') { $fields[$this.Tag.Key].Text = $picker.FileName } else { $fields[$this.Tag.Key].Text = $picker.SelectedPath }
        }
        $picker.Dispose()
    })
    $form.Controls.Add($button); $rowIndex++
}
$saveButton = New-Object System.Windows.Forms.Button
$saveButton.Text = '保存配置并启动'; $saveButton.SetBounds(575,447,210,40)
$saveButton.Add_Click({
    try {
        $saveButton.Enabled = $false
        $payload = @{}; foreach ($fieldName in $fields.Keys) { $payload[$fieldName] = $fields[$fieldName].Text }
        $outputText = ($payload | ConvertTo-Json -Compress) | & $editorNode $setupScript save 2>&1
        if ($LASTEXITCODE -ne 0) { throw ($outputText -join "`r`n") }
        $form.DialogResult = [System.Windows.Forms.DialogResult]::OK; $form.Close()
    } catch { [System.Windows.Forms.MessageBox]::Show([string]$_.Exception.Message,'请检查配置') | Out-Null }
    finally { $saveButton.Enabled = $true }
})
$form.Controls.Add($saveButton)
$form.AcceptButton = $saveButton
$result = $form.ShowDialog()
$form.Dispose()
if ($result -ne [System.Windows.Forms.DialogResult]::OK) { return }
