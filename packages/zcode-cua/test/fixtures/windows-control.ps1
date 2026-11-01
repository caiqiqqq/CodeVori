Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.Text = 'CodeVori Native Test Fixture'
$form.Width = 460
$form.Height = 260
$field = New-Object System.Windows.Forms.TextBox
$field.AccessibleName = 'Fixture Input'
$field.Text = 'seed'
$field.SetBounds(30, 30, 350, 30)
$label = New-Object System.Windows.Forms.Label
$label.Text = 'Counter: 0'
$label.SetBounds(30, 120, 180, 30)
$button = New-Object System.Windows.Forms.Button
$button.Text = 'Increment'
$button.SetBounds(240, 120, 130, 32)
$script:count = 0
$button.Add_Click({ $script:count++; $label.Text = "Counter: $script:count" })
$form.Controls.AddRange(@($field, $label, $button))
[System.Windows.Forms.Application]::Run($form)
