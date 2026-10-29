param([switch]$ConfigureOnly)
$ErrorActionPreference = 'Stop'
$catalogRoot = Split-Path -Parent $PSScriptRoot
$catalogDataDir = Join-Path $env:LOCALAPPDATA 'BiosInformatica/Catalogo'
$catalogConfigPath = Join-Path $catalogDataDir 'config.json'
$catalogPython = (Get-Command python -ErrorAction Stop).Source
& $catalogPython -c 'import crawl4ai, bs4'
if ($LASTEXITCODE -ne 0) { throw 'Instale as dependências de requirements-crawler.txt antes de configurar.' }
New-Item -ItemType Directory -Path $catalogDataDir -Force | Out-Null
if (Test-Path -LiteralPath $catalogConfigPath) {
    $catalogConfig = Get-Content -LiteralPath $catalogConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $catalogSecureToken = ConvertTo-SecureString $catalogConfig.protectedToken
    $catalogPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($catalogSecureToken)
    try { $catalogToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($catalogPointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($catalogPointer); $catalogSecureToken.Dispose() }
} else {
    $catalogBytes = New-Object byte[] 32
    $catalogRng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $catalogRng.GetBytes($catalogBytes) } finally { $catalogRng.Dispose() }
    $catalogToken = [Convert]::ToBase64String($catalogBytes).TrimEnd('=').Replace('+','-').Replace('/','_')
}
$catalogHashAlgorithm = [Security.Cryptography.SHA256]::Create()
try { $catalogHash = -join ($catalogHashAlgorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($catalogToken)) | ForEach-Object { $_.ToString('x2') }) }
finally { $catalogHashAlgorithm.Dispose() }
$catalogProtected = ConvertFrom-SecureString (ConvertTo-SecureString $catalogToken -AsPlainText -Force)
@{ version=1; projectRoot=$catalogRoot; pythonPath=$catalogPython; protectedToken=$catalogProtected } |
    ConvertTo-Json | Set-Content -LiteralPath $catalogConfigPath -Encoding UTF8
@{ tokenHash=$catalogHash } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $catalogRoot '.catalog-sync.json') -Encoding UTF8
$catalogToken = $null
if ($ConfigureOnly) {
    Write-Output "Configuração criada em $catalogConfigPath. A chave está protegida pelo Windows."
    exit 0
}
$catalogIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$catalogAction = New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'powershell.exe') `
    -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -ConfigPath "{1}"' -f (Join-Path $PSScriptRoot 'run-catalog-pc.ps1'), $catalogConfigPath) `
    -WorkingDirectory $catalogRoot
$catalogMidnight = New-ScheduledTaskTrigger -Daily -At '00:00'
$catalogNoon = New-ScheduledTaskTrigger -Daily -At '12:00'
$catalogDay = [DateTime]::UtcNow.AddHours(-3).ToString('yyyy-MM-dd')
$catalogMidnight.StartBoundary = "${catalogDay}T00:00:00-03:00"
$catalogNoon.StartBoundary = "${catalogDay}T12:00:00-03:00"
$catalogLogon = New-ScheduledTaskTrigger -AtLogOn -User $catalogIdentity
$catalogLogon.Delay = 'PT2M'
$catalogSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 6) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 30)
$catalogPrincipal = New-ScheduledTaskPrincipal -UserId $catalogIdentity -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'Bios Informatica - Catalogo de Fornecedores' -Action $catalogAction `
    -Trigger @($catalogMidnight,$catalogNoon,$catalogLogon) -Settings $catalogSettings -Principal $catalogPrincipal `
    -Description 'Coleta local às 00h e 12h de Brasília, com recuperação após logon e fila de envio ao site.' -Force | Out-Null
Write-Output 'Tarefa configurada: 00h, 12h e ao entrar no Windows. Sem senha do banco no computador.'
