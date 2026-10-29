param(
    [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'BiosInformatica/Catalogo/config.json'),
    [string]$Category = '',
    [int]$Pages = 0,
    [switch]$Force
)
$ErrorActionPreference = 'Stop'
$catalogConfig = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$catalogDataDir = Split-Path -Parent $ConfigPath
$catalogLogs = Join-Path $catalogDataDir 'logs'
New-Item -ItemType Directory -Path $catalogLogs -Force | Out-Null
$catalogLog = Join-Path $catalogLogs ('coleta-{0}.log' -f (Get-Date -Format 'yyyy-MM-dd'))
$catalogSecureToken = ConvertTo-SecureString $catalogConfig.protectedToken
$catalogTokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($catalogSecureToken)
try {
    $env:CATALOG_SYNC_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($catalogTokenPointer)
    $env:PYTHONUTF8 = '1'
    $catalogArguments = @((Join-Path $catalogConfig.projectRoot 'scripts/catalog_pc.py'), '--data-dir', $catalogDataDir, '--pages', [string]$Pages)
    if ($Category) { $catalogArguments += @('--category', $Category) }
    if ($Force) { $catalogArguments += '--force' }
    $ErrorActionPreference = 'Continue'
    & $catalogConfig.pythonPath @catalogArguments 2>&1 | Out-File -LiteralPath $catalogLog -Append -Encoding utf8
    $catalogExitCode = $LASTEXITCODE
} finally {
    $ErrorActionPreference = 'Stop'
    Remove-Item Env:CATALOG_SYNC_TOKEN -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($catalogTokenPointer)
    $catalogSecureToken.Dispose()
}
exit $catalogExitCode
