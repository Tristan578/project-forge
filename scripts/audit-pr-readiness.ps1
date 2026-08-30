[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [int]$PullRequest,
    [string]$Repository = "Tristan578/project-forge",
    [int]$PlanningParent = 9516,
    [int[]]$CompetitorParents = @(9517),
    [string]$FixtureDirectory,
    [switch]$Json
)

$ErrorActionPreference = "Stop"

function Invoke-GhJson {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $output = & gh @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "gh $($Arguments -join ' ') failed: $output"
    }
    return ($output | Out-String | ConvertFrom-Json)
}

function Get-PaginatedRestItems {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Endpoint,
        [Parameter(Mandatory = $true)]
        [string]$Property
    )

    $pages = Invoke-GhJson @("api", "--paginate", "--slurp", $Endpoint)
    return @($pages | ForEach-Object { $_.$Property } | ForEach-Object { $_ })
}

function Expand-PaginatedPages {
    param($Pages)
    if ($null -eq $Pages) { return @() }
    return @($Pages | ForEach-Object { $_ } | ForEach-Object { $_ })
}

function Get-ClosingIssueNumber {
    param([string]$Body)
    if ($Body -match "(?im)\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b") {
        return [int]$Matches[1]
    }
    return $null
}

function Get-LiveSnapshot {
    $pr = Invoke-GhJson @("api", "repos/$Repository/pulls/$PullRequest")
    $headSha = [string]$pr.head.sha
    $main = Invoke-GhJson @("api", "repos/$Repository/commits/$($pr.base.ref)")
    $checkRuns = Get-PaginatedRestItems "repos/$Repository/commits/$headSha/check-runs?per_page=100" "check_runs"
    $checkSuites = Get-PaginatedRestItems "repos/$Repository/commits/$headSha/check-suites?per_page=100" "check_suites"
    $combinedStatus = Invoke-GhJson @("api", "repos/$Repository/commits/$headSha/status")
    $files = Invoke-GhJson @("api", "--paginate", "--slurp", "repos/$Repository/pulls/$PullRequest/files?per_page=100")
    $files = Expand-PaginatedPages $files
    $reviews = Invoke-GhJson @("api", "--paginate", "--slurp", "repos/$Repository/pulls/$PullRequest/reviews?per_page=100")
    $reviews = Expand-PaginatedPages $reviews

    $threadQuery = @"
query {
  repository(owner: "$($Repository.Split('/')[0])", name: "$($Repository.Split('/')[1])") {
    pullRequest(number: $PullRequest) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          isOutdated
          comments(first: 100) {
            nodes {
              createdAt
              commit { oid }
              author { login }
            }
          }
        }
      }
    }
  }
}
"@
    $threadResult = Invoke-GhJson @("api", "graphql", "-f", "query=$threadQuery")
    $threads = @($threadResult.data.repository.pullRequest.reviewThreads.nodes)

    $closingIssue = Get-ClosingIssueNumber ([string]$pr.body)
    $issue = $null
    if ($null -ne $closingIssue) {
        $issue = Invoke-GhJson @("api", "repos/$Repository/issues/$closingIssue")
    }

    $parentIssues = @()
    if ($PlanningParent -gt 0) {
        $parentPages = Invoke-GhJson @("api", "--paginate", "--slurp", "repos/$Repository/issues/$PlanningParent/sub_issues?per_page=100")
        $parentIssues = @(Expand-PaginatedPages $parentPages | ForEach-Object { [int]$_.number })
    }

    $competitorReservations = @{}
    foreach ($parent in $CompetitorParents) {
        $reservedPages = Invoke-GhJson @("api", "--paginate", "--slurp", "repos/$Repository/issues/$parent/sub_issues?per_page=100")
        $competitorReservations["$parent"] = @(
            Expand-PaginatedPages $reservedPages | ForEach-Object { [int]$_.number }
        )
    }

    $openPullPages = Invoke-GhJson @("api", "--paginate", "--slurp", "repos/$Repository/pulls?state=open&per_page=100")
    $openPulls = Expand-PaginatedPages $openPullPages

    return [pscustomobject]@{
        pr = [pscustomobject]@{
            number = [int]$pr.number
            state = [string]$pr.state
            draft = [bool]$pr.draft
            mergeable = $pr.mergeable
            mergeable_state = [string]$pr.mergeable_state
            head_sha = $headSha
            base_sha = [string]$pr.base.sha
            body = [string]$pr.body
            milestone = $pr.milestone
            labels = @($pr.labels | ForEach-Object { [string]$_.name })
        }
        main_sha = [string]$main.sha
        check_runs = @($checkRuns)
        check_suites = @($checkSuites)
        statuses = @($combinedStatus.statuses)
        review_threads = @($threads)
        reviews = @($reviews)
        files = @($files)
        linked_issue = $issue
        planning_parent_issues = @($parentIssues)
        competitor_reservations = [pscustomobject]$competitorReservations
        open_pull_requests = @($openPulls)
    }
}

function Add-Blocker {
    param(
        [System.Collections.Generic.List[string]]$Blockers,
        [string]$Message
    )
    if (-not $Blockers.Contains($Message)) {
        $Blockers.Add($Message)
    }
}

function Test-Readiness {
    param([Parameter(Mandatory = $true)]$Snapshot)

    $blockers = [System.Collections.Generic.List[string]]::new()
    $warnings = [System.Collections.Generic.List[string]]::new()
    $pr = $Snapshot.pr
    $closingIssue = Get-ClosingIssueNumber ([string]$pr.body)

    if ($pr.state -ne "open") { Add-Blocker $blockers "PR is not open." }
    if ($pr.draft) { Add-Blocker $blockers "PR is a draft." }
    if ($pr.mergeable -ne $true) { Add-Blocker $blockers "PR is not currently mergeable." }
    if ($pr.mergeable_state -in @("dirty", "unknown", "behind")) {
        Add-Blocker $blockers "Merge state is '$($pr.mergeable_state)'."
    }
    if ($pr.base_sha -ne $Snapshot.main_sha) {
        Add-Blocker $blockers "Branch is stale: PR base $($pr.base_sha) != current main $($Snapshot.main_sha)."
    }

    foreach ($run in @($Snapshot.check_runs)) {
        if ($run.status -ne "completed") {
            Add-Blocker $blockers "Check run pending: $($run.name) [$($run.status)]."
        } elseif ($run.conclusion -notin @("success", "skipped", "neutral")) {
            Add-Blocker $blockers "Check run failed: $($run.name) [$($run.conclusion)]."
        }
    }
    foreach ($suite in @($Snapshot.check_suites)) {
        $hasRuns = ([int]$suite.latest_check_runs_count -gt 0)
        if ($suite.conclusion -in @("failure", "cancelled", "timed_out", "action_required")) {
            Add-Blocker $blockers "Check suite failed: $($suite.app.name) [$($suite.conclusion)] (suite $($suite.id))."
        } elseif ($hasRuns -and $suite.status -ne "completed") {
            Add-Blocker $blockers "Check suite pending: $($suite.app.name) [$($suite.status)] (suite $($suite.id))."
        }
    }
    foreach ($status in @($Snapshot.statuses)) {
        if ($status.state -ne "success") {
            Add-Blocker $blockers "Commit status not successful: $($status.context) [$($status.state)]."
        }
    }

    if ($null -eq $pr.milestone) { Add-Blocker $blockers "PR has no milestone." }
    if ($null -eq $closingIssue) {
        Add-Blocker $blockers "PR body has no closing keyword (Closes/Fixes/Resolves #NNNN)."
    }

    $hasChangeset = @($Snapshot.files | Where-Object {
        $_.status -eq "added" -and $_.filename -match "^\.changeset/[^/]+\.md$" -and $_.filename -ne ".changeset/README.md"
    }).Count -gt 0
    $skipsChangeset = @($pr.labels) -contains "skip changeset"
    if (-not $hasChangeset -and -not $skipsChangeset) {
        Add-Blocker $blockers "No added changeset and no 'skip changeset' label."
    }

    foreach ($thread in @($Snapshot.review_threads)) {
        if (-not $thread.isResolved) {
            Add-Blocker $blockers "Unresolved review thread: $($thread.id)."
        }
    }
    foreach ($review in @($Snapshot.reviews)) {
        if ($review.state -eq "CHANGES_REQUESTED" -and $review.commit_id -eq $pr.head_sha) {
            Add-Blocker $blockers "Changes requested on current head by $($review.user.login)."
        }
    }

    if ($null -ne $closingIssue) {
        if ($null -eq $Snapshot.linked_issue) {
            Add-Blocker $blockers "Linked issue #$closingIssue could not be loaded."
        } else {
            if ($Snapshot.linked_issue.state -ne "open") {
                Add-Blocker $blockers "Linked issue #$closingIssue is not open."
            }
            $targetLabels = @("bug", "security", "stability", "pipeline")
            $issueLabels = @($Snapshot.linked_issue.labels | ForEach-Object {
                if ($_ -is [string]) { $_ } else { $_.name }
            })
            if (@($issueLabels | Where-Object { $_ -in $targetLabels }).Count -eq 0) {
                Add-Blocker $blockers "Linked issue #$closingIssue lacks a target competition label."
            }
        }
        if (@($Snapshot.planning_parent_issues) -notcontains $closingIssue) {
            Add-Blocker $blockers "Linked issue #$closingIssue is not reserved by planning parent #$PlanningParent."
        }
        foreach ($entry in $Snapshot.competitor_reservations.psobject.Properties) {
            if (@($entry.Value) -contains $closingIssue) {
                Add-Blocker $blockers "Linked issue #$closingIssue is reserved by competitor parent #$($entry.Name)."
            }
        }
        foreach ($other in @($Snapshot.open_pull_requests)) {
            if ([int]$other.number -eq [int]$pr.number) { continue }
            if ((Get-ClosingIssueNumber ([string]$other.body)) -eq $closingIssue) {
                Add-Blocker $blockers "Open PR #$($other.number) also closes issue #$closingIssue."
            }
        }
    }

    if (@($Snapshot.check_runs).Count -eq 0) {
        Add-Blocker $blockers "No check runs found for current head."
    }

    return [pscustomobject]@{
        ready = ($blockers.Count -eq 0)
        pull_request = [int]$pr.number
        head_sha = [string]$pr.head_sha
        main_sha = [string]$Snapshot.main_sha
        linked_issue = $closingIssue
        blockers = @($blockers)
        warnings = @($warnings)
        audited_at = (Get-Date).ToUniversalTime().ToString("o")
    }
}

try {
    if ($FixtureDirectory) {
        $fixturePath = Join-Path $FixtureDirectory "readiness-input.json"
        if (-not (Test-Path -LiteralPath $fixturePath)) {
            throw "Fixture not found: $fixturePath"
        }
        $snapshot = Get-Content -LiteralPath $fixturePath -Raw | ConvertFrom-Json
    } else {
        $snapshot = Get-LiveSnapshot
    }

    $result = Test-Readiness $snapshot
    if ($Json) {
        $result | ConvertTo-Json -Depth 10
    } else {
        $label = if ($result.ready) { "READY" } else { "NOT READY" }
        Write-Host "PR #$($result.pull_request): $label"
        Write-Host "  head: $($result.head_sha)"
        Write-Host "  main: $($result.main_sha)"
        foreach ($blocker in $result.blockers) {
            Write-Host "  BLOCK: $blocker"
        }
        foreach ($warning in $result.warnings) {
            Write-Host "  WARN:  $warning"
        }
    }
    if ($result.ready) { exit 0 } else { exit 1 }
} catch {
    $failure = [pscustomobject]@{
        ready = $false
        pull_request = $PullRequest
        blockers = @("Auditor error: $($_.Exception.Message)")
        audited_at = (Get-Date).ToUniversalTime().ToString("o")
    }
    if ($Json) {
        $failure | ConvertTo-Json -Depth 5
    } else {
        Write-Error $failure.blockers[0]
    }
    exit 2
}
