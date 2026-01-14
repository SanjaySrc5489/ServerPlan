Write-Host "Watching for changes... (Ctrl+C to stop)"

while ($true) {

    $changes = git status --porcelain

    if ($changes) {
        Write-Host "Changes detected → pushing..."

        git add .
        git commit -m "Auto update: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
        git push origin main --force

        Write-Host "Pushed at $(Get-Date)"
    }

    Start-Sleep -Seconds 5
}
