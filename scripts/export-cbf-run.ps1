# Export every source sample in the requested 0-80 s window.
# If a recording contains discontinuous pose resets, the export replaces each
# reset with a 1.5 s smooth bridge, then returns to the recorded pose. This
# keeps playback continuous while preserving all timestamps and all unmodified
# source poses outside each bridge.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root "assets\data\robot_odom2.csv"
$dst = Join-Path $root "assets\data\cbf-run2.csv"
$culture = [System.Globalization.CultureInfo]::InvariantCulture
$endTime = 80.0
$bridgeSeconds = 1.5

function Wrap-Angle([double]$angle) {
    return [math]::Atan2([math]::Sin($angle), [math]::Cos($angle))
}

$source = @(Import-Csv $src | ForEach-Object {
    [pscustomobject]@{
        t = [double]::Parse($_.time, $culture)
        x = [double]::Parse($_.x, $culture)
        y = [double]::Parse($_.y, $culture)
        yaw = [double]::Parse($_.yaw, $culture)
    }
})
if ($source.Count -lt 2 -or $source[0].t -ne 0 -or $source[-1].t -lt $endTime) {
    throw "The recording must cover the full 0-80 s window."
}

# Retain all source poses and insert the exact 80 s endpoint if needed.
$samples = New-Object System.Collections.Generic.List[object]
$previous = $null
$unwrappedYaw = 0.0
foreach ($row in $source) {
    if ($null -ne $previous) {
        $dt = $row.t - $previous.t
        if ($dt -le 0) { throw "Source timestamps must strictly increase." }
        $unwrappedYaw += Wrap-Angle ($row.yaw - $previous.yaw)
    } else {
        $unwrappedYaw = $row.yaw
    }

    if ($row.t -gt $endTime) {
        $fraction = ($endTime - $previous.t) / ($row.t - $previous.t)
        $samples.Add([pscustomobject]@{
            t = $endTime
            x = $previous.x + ($row.x - $previous.x) * $fraction
            y = $previous.y + ($row.y - $previous.y) * $fraction
            yaw = $samples[-1].yaw + (Wrap-Angle ($row.yaw - $previous.yaw)) * $fraction
        })
        break
    }

    $samples.Add([pscustomobject]@{ t = $row.t; x = $row.x; y = $row.y; yaw = $unwrappedYaw })
    if ($row.t -eq $endTime) { break }
    $previous = $row
}

# Find large resets. Smoothstep blends from the last continuous pose to the
# recorded trajectory 1.5 s after the reset, so animation remains continuous.
$bridgeStarts = New-Object System.Collections.Generic.List[int]
for ($i = 1; $i -lt $samples.Count; $i++) {
    $dt = $samples[$i].t - $samples[$i - 1].t
    $distance = [math]::Sqrt([math]::Pow($samples[$i].x - $samples[$i - 1].x, 2) + [math]::Pow($samples[$i].y - $samples[$i - 1].y, 2))
    if ($distance -gt 0.15 -and $distance / $dt -gt 4) { $bridgeStarts.Add($i) }
}
foreach ($start in $bridgeStarts) {
    $from = $samples[$start - 1]
    $end = $start
    while ($end -lt $samples.Count - 1 -and $samples[$end].t -lt $from.t + $bridgeSeconds) { $end++ }
    $to = $samples[$end]
    for ($i = $start; $i -lt $end; $i++) {
        $u = ($samples[$i].t - $from.t) / ($to.t - $from.t)
        $u = $u * $u * (3 - 2 * $u) # smoothstep
        $samples[$i].x = $from.x + ($to.x - $from.x) * $u
        $samples[$i].y = $from.y + ($to.y - $from.y) * $u
        $samples[$i].yaw = $from.yaw + ($to.yaw - $from.yaw) * $u
    }
}

$out = New-Object System.Collections.Generic.List[string]
$out.Add("t,x,y,yaw")
foreach ($sample in $samples) {
    $out.Add([string]::Format($culture, "{0:0.000000},{1:0.0000},{2:0.0000},{3:0.0000}",
        $sample.t, $sample.x, $sample.y, $sample.yaw))
}
[System.IO.File]::WriteAllLines($dst, $out, (New-Object System.Text.UTF8Encoding($false)))
"Wrote $($samples.Count) samples, 0-80 s at 2x speed."
"Smoothed $($bridgeStarts.Count) recorded pose resets over $bridgeSeconds s each."
