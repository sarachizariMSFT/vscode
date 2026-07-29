# Copilot Governance — one-command demo launcher
#
# Copies the sample policy file into '.github/copilot-policies.json' (backing up any
# existing one) and launches the dev build so you can try Guardrails immediately.
#
# Usage:
#   scripts\try-governance.ps1                 # activate sample policies + launch
#   scripts\try-governance.ps1 -Restore        # restore the previous policy file, don't launch
#   scripts\try-governance.ps1 -NoLaunch       # copy the sample but don't launch the build

[CmdletBinding()]
param(
	[switch]$Restore,
	[switch]$NoLaunch
)

$ErrorActionPreference = 'Stop'

$repoRoot   = Split-Path -Parent $PSScriptRoot
$githubDir  = Join-Path $repoRoot '.github'
$sample     = Join-Path $githubDir 'copilot-policies-sample.json'
$active     = Join-Path $githubDir 'copilot-policies.json'
$backup     = Join-Path $githubDir 'copilot-policies.json.bak'

if ($Restore) {
	if (Test-Path $backup) {
		Move-Item -Force $backup $active
		Write-Host "Restored previous policy file from backup." -ForegroundColor Green
	} else {
		Write-Host "No backup found — nothing to restore." -ForegroundColor Yellow
	}
	return
}

if (-not (Test-Path $sample)) {
	throw "Sample policy file not found at $sample"
}

if (Test-Path $active) {
	Copy-Item -Force $active $backup
	Write-Host "Backed up existing policy file to $backup" -ForegroundColor DarkGray
}

Copy-Item -Force $sample $active
Write-Host "Activated sample Guardrails policies at $active" -ForegroundColor Green
Write-Host "  - SEC-1 / SEC-4  : prompt-shaping (enforce)" -ForegroundColor DarkGray
Write-Host "  - DEP-1          : prompt-shaping (warn)" -ForegroundColor DarkGray
Write-Host "  - OPS-1          : structured rules (deny force-push / .env secrets)" -ForegroundColor DarkGray
Write-Host "  - SEC-CTX-1      : contextual rule (block fetch after reading secrets)" -ForegroundColor DarkGray

if ($NoLaunch) {
	Write-Host "`nSkipping launch (-NoLaunch). Run scripts\code.bat when ready." -ForegroundColor Yellow
	return
}

Write-Host "`nLaunching dev build..." -ForegroundColor Cyan
& (Join-Path $repoRoot 'scripts\code.bat')
