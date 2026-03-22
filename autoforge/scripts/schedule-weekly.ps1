<#
.SYNOPSIS
    AutoForge weekly validation for Windows.
    Runs every Sunday — tests with real provider APIs to catch overfitting.

.DESCRIPTION
    The nightly loop optimizes scene composition using heuristics + vision
    scoring against cached/mock assets. This weekly run validates that
    improvements generalize to real provider outputs (Meshy 3D, ElevenLabs
    audio, Suno music). If the weekly score drops significantly vs nightly,
    it signals overfitting to the mock data.

    This script:
    1. Pulls latest main (with accumulated nightly improvements)
    2. Starts the SpawnForge dev server
    3. Runs evaluation with real provider APIs enabled
    4. Compares scores against the latest nightly baseline
    5. Pushes a validation report

.USAGE
    # Register (runs every Sunday at 2 AM):
    powershell -ExecutionPolicy Bypass -File autoforge\scripts\schedule-weekly.ps1 -Register

    # Run manually:
    powershell -ExecutionPolicy Bypass -File autoforge\scripts\schedule-weekly.ps1

    # Unregister:
    powershell -ExecutionPolicy Bypass -File autoforge\scripts\schedule-weekly.ps1 -Unregister
#>

param(
    [switch]$Register,
    [switch]$Unregister
)

$ErrorActionPreference = "Stop"
$TaskName = "SpawnForge-AutoForge-Weekly"

# ---------------------------------------------------------------------------
# Resolve project root
# ---------------------------------------------------------------------------
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = (git -C $ScriptDir rev-parse --show-toplevel 2>$null)
if (-not $ProjectRoot) {
    $ProjectRoot = Resolve-Path (Join-Path $ScriptDir "../..")
}

# ---------------------------------------------------------------------------
# Load .env
# ---------------------------------------------------------------------------
$EnvFile = Join-Path $ProjectRoot "autoforge\.env"
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#")) {
            $eqIdx = $line.IndexOf("=")
            if ($eqIdx -gt 0) {
                $key = $line.Substring(0, $eqIdx).Trim()
                $val = $line.Substring($eqIdx + 1).Trim()
                if (-not [Environment]::GetEnvironmentVariable($key)) {
                    [Environment]::SetEnvironmentVariable($key, $val, "Process")
                }
            }
        }
    }
    Write-Host "Loaded .env from $EnvFile"
} else {
    Write-Host "WARNING: No .env file found at $EnvFile"
}

# ---------------------------------------------------------------------------
# Register / Unregister
# ---------------------------------------------------------------------------
if ($Register) {
    $Action = New-ScheduledTaskAction `
        -Execute "powershell.exe" `
        -Argument "-ExecutionPolicy Bypass -File `"$ProjectRoot\autoforge\scripts\schedule-weekly.ps1`"" `
        -WorkingDirectory $ProjectRoot

    $Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At "2:00AM"

    $Settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -ExecutionTimeLimit (New-TimeSpan -Hours 4)

    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $Action `
        -Trigger $Trigger `
        -Settings $Settings `
        -Description "SpawnForge AutoForge weekly validation with real provider APIs" `
        -RunLevel Highest

    Write-Host "Registered scheduled task: $TaskName (Sundays at 2 AM)"
    Write-Host "Project root: $ProjectRoot"
    exit 0
}

if ($Unregister) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Unregistered scheduled task: $TaskName"
    exit 0
}

# ---------------------------------------------------------------------------
# Main execution
# ---------------------------------------------------------------------------
$LogDir = Join-Path $ProjectRoot "autoforge\results"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force }
$LogFile = Join-Path $LogDir "weekly-$(Get-Date -Format 'yyyy-MM-dd').log"

function Log($msg) {
    $line = "$(Get-Date -Format 'HH:mm:ss') $msg"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line
}

Log "=== AutoForge Weekly Validation ==="
Log "Project root: $ProjectRoot"

# Check provider API keys
$HasMeshy = [bool]$env:MESHY_API_KEY
$HasElevenLabs = [bool]$env:ELEVENLABS_API_KEY
$HasSuno = [bool]$env:SUNO_API_KEY
Log "Providers: Meshy=$HasMeshy, ElevenLabs=$HasElevenLabs, Suno=$HasSuno"

if (-not $HasMeshy -and -not $HasElevenLabs -and -not $HasSuno) {
    Log "WARNING: No provider API keys set. Weekly validation will run"
    Log "  vision scoring only (same as nightly). Set MESHY_API_KEY,"
    Log "  ELEVENLABS_API_KEY, and/or SUNO_API_KEY in .env for full validation."
}

# Pull latest main
Set-Location $ProjectRoot
Log "Pulling latest main..."
git checkout main 2>&1 | Out-Null
git pull origin main 2>&1 | Out-Null

# Create validation branch
$BranchName = "autoforge/weekly-$(Get-Date -Format 'yyyy-MM-dd')"
git checkout -b $BranchName 2>&1 | Out-Null
Log "Created branch: $BranchName"

# Install deps
Log "Checking dependencies..."
Set-Location (Join-Path $ProjectRoot "web")
if (-not (Test-Path "node_modules")) { npm install 2>&1 | Out-Null }
Set-Location (Join-Path $ProjectRoot "autoforge")
if (-not (Test-Path "node_modules")) { npm install 2>&1 | Out-Null }

# Start dev server
Log "Starting dev server..."
Set-Location (Join-Path $ProjectRoot "web")
$DevServer = Start-Process -FilePath "cmd" `
    -ArgumentList "/c npm run dev" `
    -PassThru -NoNewWindow -RedirectStandardOutput "NUL"

$WaitSeconds = if ($env:DEV_SERVER_WAIT) { [int]$env:DEV_SERVER_WAIT } else { 30 }
Log "Waiting ${WaitSeconds}s for dev server..."
Start-Sleep -Seconds $WaitSeconds

# Configure AI Gateway routing
if ($env:AI_GATEWAY_API_KEY -and -not $env:ANTHROPIC_API_KEY) {
    $gatewayUrl = if ($env:AI_GATEWAY_URL) { $env:AI_GATEWAY_URL } else { "https://ai-gateway.vercel.sh" }
    [Environment]::SetEnvironmentVariable("ANTHROPIC_BASE_URL", $gatewayUrl, "Process")
    [Environment]::SetEnvironmentVariable("ANTHROPIC_AUTH_TOKEN", $env:AI_GATEWAY_API_KEY, "Process")
    Log "Routing Claude Code through AI Gateway"
}

# Run validation via Claude Code (-p = non-interactive print mode)
Log "Starting weekly validation..."
Set-Location $ProjectRoot

$DateStr = Get-Date -Format 'yyyy-MM-dd'

try {
    $ClaudePrompt = @"
You are running the AutoForge WEEKLY VALIDATION for SpawnForge.
This is different from the nightly experiment loop — you are NOT making changes.
You are TESTING the current state of the compound handlers against real providers.

Your task:
1. Run the full evaluation suite with vision scoring:
   cd autoforge && npx tsx scripts/run-eval.ts --vision

2. Record the scores in autoforge/results/weekly-validation.json with this format:
   {
     "date": "$DateStr",
     "scores": { <per-prompt scores from the eval> },
     "totalScore": <number>,
     "providers": { "meshy": $HasMeshy, "elevenlabs": $HasElevenLabs, "suno": $HasSuno },
     "comparison": {
       "vs_nightly_baseline": <difference from last nightly loop-state.json best score>,
       "drift_detected": <true if weekly score is >10% lower than nightly>
     }
   }

3. Read autoforge/results/loop-state.json (if exists) to get the latest nightly
   baseline score for comparison.

4. If drift_detected is true, add a note to autoforge/program.md under
   "## Weekly Validation Flags" explaining which prompts scored lower and why.

5. Generate a summary of the validation results.
"@

    claude -p $ClaudePrompt 2>&1 | Tee-Object -FilePath $LogFile -Append
}
catch {
    Log "Claude Code exited with error: $_"
}

# Push results
Log "Pushing validation results..."
Set-Location $ProjectRoot
git add autoforge/results/ autoforge/program.md 2>&1 | Out-Null
git commit -m "autoforge: weekly validation $(Get-Date -Format 'yyyy-MM-dd')" --allow-empty 2>&1 | Out-Null
git push -u origin $BranchName 2>&1 | Out-Null

# Create PR with validation report
Log "Creating validation PR..."
gh pr create `
    --title "autoforge: weekly validation $(Get-Date -Format 'yyyy-MM-dd')" `
    --body "## AutoForge Weekly Validation`n`nValidation run against current main with real provider APIs.`nSee autoforge/results/weekly-validation.json for detailed scores.`n`nGenerated by AutoForge weekly scheduler." `
    --base main `
    --head $BranchName 2>&1 | Out-Null

# Cleanup
Log "Stopping dev server..."
if ($DevServer -and -not $DevServer.HasExited) {
    Stop-Process -Id $DevServer.Id -Force -ErrorAction SilentlyContinue
}

Log "=== AutoForge Weekly Validation Complete ==="
