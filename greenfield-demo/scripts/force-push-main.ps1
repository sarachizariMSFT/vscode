# Force push to main with safety checks
# This script requires explicit confirmation before proceeding

Write-Host "⚠️  WARNING: You are about to force-push to main" -ForegroundColor Red
Write-Host ""
Write-Host "This will:"
Write-Host "  • Overwrite remote history on the main branch"
Write-Host "  • Potentially cause data loss for other contributors"
Write-Host "  • Require other developers to reset their local branches"
Write-Host ""

# Get current branch
$currentBranch = git rev-parse --abbrev-ref HEAD
Write-Host "Current branch: $currentBranch" -ForegroundColor Cyan
Write-Host ""

if ($currentBranch -ne "main") {
    Write-Host "❌ Error: You must be on the main branch to run this script" -ForegroundColor Red
    exit 1
}

# Show commits that will be force-pushed
Write-Host "Commits to push:" -ForegroundColor Cyan
git log origin/main..HEAD --oneline
Write-Host ""

# Require explicit confirmation
$confirmation = Read-Host "Type 'force-push' to proceed"

if ($confirmation -ne "force-push") {
    Write-Host "❌ Operation cancelled" -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "🚀 Force-pushing to main..." -ForegroundColor Green

git push --force-with-lease origin main

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Force-push completed successfully" -ForegroundColor Green
} else {
    Write-Host "❌ Force-push failed" -ForegroundColor Red
    exit 1
}
