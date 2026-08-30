$ErrorActionPreference = "Stop"

$auditor = Join-Path $PSScriptRoot "..\audit-pr-readiness.ps1"
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "project-forge-readiness-$([guid]::NewGuid())"
$script:failures = 0

function New-ReadySnapshot {
    return @{
        pr = @{ number = 9553; state = "open"; draft = $false; mergeable = $true; mergeable_state = "clean"; head_sha = "head"; base_sha = "main"; body = "Closes #9553"; milestone = @{ title = "S1" }; labels = @("skip changeset") }
        main_sha = "main"
        check_runs = @(@{ name = "tests"; status = "completed"; conclusion = "success" })
        check_suites = @(@{ id = 1; status = "completed"; conclusion = "success"; latest_check_runs_count = 1; app = @{ name = "Actions" } })
        statuses = @()
        review_threads = @()
        reviews = @()
        files = @()
        linked_issue = @{ state = "open"; labels = @(@{ name = "pipeline" }) }
        planning_parent_issues = @(9553)
        competitor_reservations = @{ "9517" = @() }
        open_pull_requests = @(@{ number = 9553; body = "Closes #9553" })
    }
}

function Invoke-Case {
    param([string]$Name, [hashtable]$Snapshot, [int]$ExpectedExit, [string[]]$ExpectedBlockers = @())
    $caseDir = Join-Path $tempRoot $Name
    New-Item -ItemType Directory -Force -Path $caseDir | Out-Null
    $Snapshot | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $caseDir "readiness-input.json")
    $raw = & pwsh -NoProfile -File $auditor -PullRequest 9553 -FixtureDirectory $caseDir -Json
    $actualExit = $LASTEXITCODE
    $result = $raw | ConvertFrom-Json
    $errors = @()
    if ($actualExit -ne $ExpectedExit) { $errors += "exit $actualExit, expected $ExpectedExit" }
    foreach ($pattern in $ExpectedBlockers) {
        if (-not (@($result.blockers) -match $pattern)) { $errors += "missing blocker /$pattern/" }
    }
    if ($errors.Count -eq 0) { Write-Host "PASS $Name" } else { Write-Host "FAIL $Name`: $($errors -join '; ')"; $script:failures++ }
}

try {
    $ready = New-ReadySnapshot
    Invoke-Case "ready" $ready 0

    $hiddenFailure = New-ReadySnapshot
    $hiddenFailure.check_suites = @(1..100 | ForEach-Object { @{ id = $_; status = "completed"; conclusion = "success"; latest_check_runs_count = 1; app = @{ name = "suite-$_" } } })
    $hiddenFailure.check_suites += @{ id = 101; status = "completed"; conclusion = "failure"; latest_check_runs_count = 1; app = @{ name = "hidden-failure" } }
    Invoke-Case "hidden-failed-suite" $hiddenFailure 1 @("hidden-failure.*failure")

    $stale = New-ReadySnapshot
    $stale.pr.base_sha = "old-main"
    $stale.pr.milestone = $null
    $stale.pr.body = "Implements the auditor"
    $stale.pr.labels = @()
    $stale.check_runs[0].status = "queued"
    $stale.check_runs[0].conclusion = $null
    Invoke-Case "stale-metadata" $stale 1 @("Branch is stale", "Check run pending", "no milestone", "no closing keyword", "No added changeset")

    $reserved = New-ReadySnapshot
    $reserved.competitor_reservations = @{ "9517" = @(9553) }
    Invoke-Case "competitor-overlap" $reserved 1 @("reserved by competitor parent #9517")

    $external = New-ReadySnapshot
    $external.check_suites += @{ id = 2; status = "queued"; conclusion = $null; latest_check_runs_count = 0; app = @{ name = "external-app" } }
    Invoke-Case "zero-run-external-suite" $external 0
} finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

if ($script:failures -gt 0) { exit 1 }
