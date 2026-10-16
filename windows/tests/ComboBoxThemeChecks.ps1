# Verify the WPF dropdown color regression reported from Windows settings:
# the stock ComboBox popup rendered a white background with almost-white text.
# This check runs before packaging and deliberately avoids requiring a desktop.
$ErrorActionPreference = 'Stop'
[xml]$xaml = Get-Content -Raw windows/src/BlofyPlayer.Windows/App.xaml
$styles = $xaml.SelectNodes("//*[local-name()='Style']")
$combo = @($styles | Where-Object { $_.GetAttribute('TargetType') -eq '{x:Type ComboBox}' })
$item = @($styles | Where-Object { $_.GetAttribute('TargetType') -eq '{x:Type ComboBoxItem}' })
if ($combo.Count -ne 1 -or $item.Count -ne 1) {
    throw 'Dark dropdown styles must cover both ComboBox and ComboBoxItem.'
}
$popup = $combo[0].SelectSingleNode(".//*[local-name()='Popup']")
if ($null -eq $popup -or $popup.GetAttribute('Name', 'http://schemas.microsoft.com/winfx/2006/xaml') -ne 'PART_Popup') {
    throw 'A custom ComboBox popup is required to replace the native white list.'
}
$border = $popup.SelectSingleNode(".//*[local-name()='Border']")
if ($null -eq $border -or $border.GetAttribute('Background') -ne '#241536') {
    throw 'The expanded dropdown must have an opaque dark background.'
}
$option = $item[0].SelectSingleNode(".//*[local-name()='Border']")
if ($null -eq $option) {
    throw 'Each dropdown option requires its own themed surface.'
}
$selection = @($item[0].SelectNodes(".//*[local-name()='Trigger']") |
    Where-Object { $_.GetAttribute('Property') -eq 'IsSelected' })
$hover = @($item[0].SelectNodes(".//*[local-name()='Trigger']") |
    Where-Object { $_.GetAttribute('Property') -eq 'IsHighlighted' })
if ($selection.Count -eq 0 -or $hover.Count -eq 0) {
    throw 'The item template must style selected and hovered/focused choices.'
}
$text = @($item[0].SelectNodes(".//*[local-name()='Setter']") |
    Where-Object { $_.GetAttribute('Property') -eq 'Foreground' })
if ($text.Count -eq 0) { throw 'The dropdown options must specify readable foreground text.' }
Write-Host 'Windows settings dropdown dark background/text/hover/selection checks passed.'
