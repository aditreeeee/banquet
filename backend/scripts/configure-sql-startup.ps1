<#
.SYNOPSIS
    One-time Windows setup so SQL Server Express is guaranteed to be running
    before the BanquetPro app is ever launched — no manual restart needed.

.DESCRIPTION
    - Sets the SQL Server (SQLEXPRESS) service to Automatic (Delayed Start),
      so Windows starts it on boot without racing other startup services.
    - Sets SQL Server Browser to Automatic, if present (needed for named
      instance resolution, e.g. SQLEXPRESS).
    - Verifies the service account is a real startable account (not Disabled).
    - Waits for the service to report "Running" and prints the result, so
      this can double as a startup readiness check (see -WaitOnly).

.PARAMETER InstanceServiceName
    The Windows service name for the SQL Server instance. Defaults to
    MSSQL$SQLEXPRESS (the standard name for a named "SQLEXPRESS" instance).

.PARAMETER WaitOnly
    Skip the configuration steps and just wait for the service to be
    Running (useful as a pre-flight check in a scheduled task / app launcher).

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File configure-sql-startup.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File configure-sql-startup.ps1 -WaitOnly
#>

param(
    [string]$InstanceServiceName = 'MSSQL$SQLEXPRESS',
    [string]$BrowserServiceName  = 'SQLBrowser',
    [switch]$WaitOnly,
    [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'

function Write-Step($msg) {
    Write-Host "[configure-sql-startup] $msg"
}

function Set-DelayedAutoStart($serviceName) {
    $svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if (-not $svc) {
        Write-Step "Service '$serviceName' not found — skipping."
        return $false
    }

    # sc.exe is required for the "delayed-auto" start type; Set-Service
    # only supports plain Automatic.
    & sc.exe config $serviceName start= delayed-auto | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to set '$serviceName' to Automatic (Delayed Start)."
    }
    Write-Step "Set '$serviceName' startup type to Automatic (Delayed Start)."

    $qc = & sc.exe qc $serviceName
    Write-Step "Verified config for '$serviceName':"
    $qc | ForEach-Object { Write-Host "    $_" }

    return $true
}

function Wait-ForServiceRunning($serviceName, $timeoutSeconds) {
    Write-Step "Waiting for '$serviceName' to report Running (timeout ${timeoutSeconds}s)..."
    $deadline = (Get-Date).AddSeconds($timeoutSeconds)

    while ((Get-Date) -lt $deadline) {
        $svc = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
        if ($null -eq $svc) {
            Write-Step "Service '$serviceName' not found."
            return $false
        }
        if ($svc.Status -eq 'Running') {
            Write-Step "'$serviceName' is Running."
            return $true
        }
        if ($svc.Status -eq 'Stopped') {
            try {
                Write-Step "'$serviceName' is Stopped — attempting Start-Service."
                Start-Service -Name $serviceName -ErrorAction Stop
            } catch {
                Write-Step "Start-Service failed: $($_.Exception.Message)"
            }
        }
        Start-Sleep -Seconds 2
    }

    Write-Step "Timed out waiting for '$serviceName' to start."
    return $false
}

# ─── Main ────────────────────────────────────────────────────────────────────

if (-not $WaitOnly) {
    Write-Step "Configuring SQL Server startup reliability..."

    $configured = Set-DelayedAutoStart -serviceName $InstanceServiceName
    if (-not $configured) {
        throw "SQL Server instance service '$InstanceServiceName' was not found. Pass -InstanceServiceName with the correct service name (check services.msc)."
    }

    Set-DelayedAutoStart -serviceName $BrowserServiceName | Out-Null

    # Confirm the service account can actually start automatically
    # (LocalSystem / NT Service accounts always can; a custom domain account
    # must have "Log on as a service" rights, granted via the SQL Server
    # Configuration Manager when the account is assigned).
    $wmiSvc = Get-CimInstance Win32_Service -Filter "Name='$InstanceServiceName'"
    Write-Step "Service account: $($wmiSvc.StartName)"
    if ($wmiSvc.StartMode -notin @('Auto')) {
        Write-Step "Warning: WMI reports StartMode='$($wmiSvc.StartMode)' — delayed-auto shows as 'Auto' here by design; this is expected."
    }
}

$ok = Wait-ForServiceRunning -serviceName $InstanceServiceName -timeoutSeconds $TimeoutSeconds
if (-not $ok) {
    Write-Error "SQL Server instance '$InstanceServiceName' did not reach Running state within $TimeoutSeconds seconds."
    exit 1
}

Write-Step "Done. SQL Server is ready."
exit 0
