<#
.SYNOPSIS
    AutoForge nightly scheduler for Windows.
    Registers a Windows Task Scheduler job to run the experiment loop overnight.

.DESCRIPTION
    This script:
    1. Loads .env configuration
    2. Pulls latest main
    3. Starts the SpawnForge dev server
    4. Runs the AutoForge experiment loop via Claude Code
    5. Pushes results to a branch and creates a PR

.USAGE
    # Register the scheduled task (run once):
    powershell -ExecutionPolicy Bypass -File autoforge\scripts\schedule-nightly.ps1 -Register

    # Run manually (for testing):
    powershell -ExecutionPolicy Bypass -File autoforge\scripts\schedule-nightly.ps1

    # Unregister the scheduled task:
    powershell -ExecutionPolicy Bypass -File autoforge\scripts\schedule-nightly.ps1 -Unregister
#>

param(
    [switch]$Register,
    [switch]$Unregister
)

$ErrorActionPreference = "Stop"
$TaskName = "SpawnForge-AutoForge-Nightly"

# ---------------------------------------------------------------------------
# Resolve project root (works from any working directory)
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
    Write-Host "  Copy .env.example to .env and configure your API keys"
}

# ---------------------------------------------------------------------------
# Register / Unregister scheduled task
# ---------------------------------------------------------------------------
if ($Register) {
    $Action = New-ScheduledTaskAction `
        -Execute "powershell.exe" `
        -Argument "-ExecutionPolicy Bypass -File `"$ProjectRoot\autoforge\scripts\schedule-nightly.ps1`"" `
        -WorkingDirectory $ProjectRoot

    # Mon-Sat at 11 PM (skip Sunday — that's the weekly validation)
    $Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday,Saturday -At "11:00PM"

    $Settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -ExecutionTimeLimit (New-TimeSpan -Hours 10)

    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $Action `
        -Trigger $Trigger `
        -Settings $Settings `
        -Description "SpawnForge AutoForge nightly optimization loop (Mon-Sat)" `
        -RunLevel Highest

    Write-Host "Registered scheduled task: $TaskName (Mon-Sat at 11 PM)"
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
$LogFile = Join-Path $LogDir "nightly-$(Get-Date -Format 'yyyy-MM-dd').log"

function Log($msg) {
    $line = "$(Get-Date -Format 'HH:mm:ss') $msg"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line
}

Log "=== AutoForge Nightly Run ==="
Log "Project root: $ProjectRoot"

# Pull latest main
Log "Pulling latest main..."
Set-Location $ProjectRoot
git checkout main 2>&1 | Out-Null
git pull origin main 2>&1 | Out-Null

# Create experiment branch
$BranchName = "autoforge/nightly-$(Get-Date -Format 'yyyy-MM-dd')"
git checkout -b $BranchName 2>&1 | Out-Null
Log "Created branch: $BranchName"

# Install deps if needed
Log "Checking dependencies..."
Set-Location (Join-Path $ProjectRoot "web")
if (-not (Test-Path "node_modules")) {
    npm install 2>&1 | Out-Null
}
Set-Location (Join-Path $ProjectRoot "autoforge")
if (-not (Test-Path "node_modules")) {
    npm install 2>&1 | Out-Null
}

# Start dev server in background
Log "Starting dev server..."
Set-Location (Join-Path $ProjectRoot "web")
$DevServer = Start-Process -FilePath "cmd" `
    -ArgumentList "/c npm run dev" `
    -PassThru -NoNewWindow -RedirectStandardOutput "NUL"

$WaitSeconds = if ($env:DEV_SERVER_WAIT) { [int]$env:DEV_SERVER_WAIT } else { 30 }
Log "Waiting ${WaitSeconds}s for dev server..."
Start-Sleep -Seconds $WaitSeconds

# Configure AI Gateway routing for Claude Code
if ($env:AI_GATEWAY_API_KEY -and -not $env:ANTHROPIC_API_KEY) {
    $gatewayUrl = if ($env:AI_GATEWAY_URL) { $env:AI_GATEWAY_URL } else { "https://ai-gateway.vercel.sh" }
    [Environment]::SetEnvironmentVariable("ANTHROPIC_BASE_URL", $gatewayUrl, "Process")
    [Environment]::SetEnvironmentVariable("ANTHROPIC_AUTH_TOKEN", $env:AI_GATEWAY_API_KEY, "Process")
    Log "Routing Claude Code through AI Gateway"
} else {
    Log "Using Claude Code with default auth (Max subscription or ANTHROPIC_API_KEY)"
}

# Run the experiment loop via Claude Code (-p = non-interactive print mode)
Log "Starting AutoForge experiment loop..."
Set-Location $ProjectRoot

$MaxExp = if ($env:MAX_EXPERIMENTS) { $env:MAX_EXPERIMENTS } else { "20" }
$MaxHrs = if ($env:MAX_HOURS) { $env:MAX_HOURS } else { "6" }

try {
    $ClaudePrompt = @"
You are running the AutoForge nightly experiment loop for SpawnForge.

Read autoforge/program.md for your directives.
Read autoforge/results/loop-state.json for prior state (if exists).

Your task:
1. Run baseline evaluation: cd autoforge && npx tsx scripts/run-eval.ts --vision
2. Record the baseline score
3. For each experiment (up to $MaxExp):
   a. Form a hypothesis based on program.md directives
   b. Make ONE change to the editable surface files
   c. Verify: cd web && npx tsc --noEmit && npx eslint --max-warnings 0
   d. Run evaluation: cd autoforge && npx tsx scripts/run-eval.ts --vision
   e. If score improved: git add -A && git commit with "autoforge: <hypothesis>"
   f. If score did not improve: git checkout -- web/src/lib/chat/handlers/
   g. Update program.md "Successful Patterns" or "Anti-Patterns" sections
4. After all experiments, generate a summary and push to the branch.

Stop after $MaxExp experiments or $MaxHrs hours.
"@

    claude -p $ClaudePrompt 2>&1 | Tee-Object -FilePath $LogFile -Append
}
catch {
    Log "Claude Code exited with error: $_"
}

# Push results
Log "Pushing results..."
Set-Location $ProjectRoot
git add autoforge/results/ autoforge/program.md 2>&1 | Out-Null
git commit -m "autoforge: nightly results $(Get-Date -Format 'yyyy-MM-dd')" --allow-empty 2>&1 | Out-Null
git push -u origin $BranchName 2>&1 | Out-Null

# Create PR if there are kept experiments
$KeptCount = (git log main..$BranchName --oneline 2>$null | Where-Object { $_ -match "^.*autoforge:" }).Count
if ($KeptCount -gt 0) {
    Log "Creating PR with $KeptCount improvements..."
    gh pr create `
        --title "autoforge: nightly improvements $(Get-Date -Format 'yyyy-MM-dd')" `
        --body "## AutoForge Nightly Run`n`n$KeptCount experiments kept. See autoforge/results/ for details.`n`nGenerated by AutoForge nightly loop." `
        --base main `
        --head $BranchName 2>&1 | Out-Null
}

# Cleanup
Log "Stopping dev server..."
if ($DevServer -and -not $DevServer.HasExited) {
    Stop-Process -Id $DevServer.Id -Force -ErrorAction SilentlyContinue
}

Log "=== AutoForge Nightly Complete ==="
