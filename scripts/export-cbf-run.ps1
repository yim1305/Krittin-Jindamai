# Derives assets/data/cbf-run.csv — the playback file js/cbf-scene.js loads —
# from Krittin's full Gazebo export, assets/data/robot_odom.csv. Re-run this if
# the recording is ever replaced; nothing here invents data, it only selects,
# thins and rewrites it.
#
# Why a derived file at all:
#
#  1. THE RECORDING CONTAINS TELEPORTS. robot_odom.csv is one 235 s capture in
#     which the robot is repositioned 7 times (position AND yaw jump between
#     consecutive 35 ms samples — up to 5 m, twice back to the origin). Played
#     straight, the animation would look broken. Splitting the run at every step
#     no 1 m/s robot could have made leaves 8 episodes; this exports ONE of them
#     whole, never stitching two together.
#
#  2. SIZE. The full file is 596 KB of 17-digit doubles. Thinned to every 2nd
#     sample (~14 Hz, still well above what a 0.44 m/s robot needs when the
#     scene interpolates between samples at 30 fps) and rounded to 0.1 mm, the
#     same run is ~25 KB.
#
#  3. YAW WRAPS. The source wraps at +/-pi. Linear interpolation across a wrap
#     spins the robot a full turn in one frame, so yaw is unwrapped here into a
#     continuous angle. The pose it describes is unchanged.
#
# Episode choice (SEG_START/SEG_END below): rows 4364-6071, t = 155.6-215.5 s.
# Of the 8 episodes it is the longest (59.9 s), the longest-travelled (26.1 m),
# and the least stalled (7% of samples under 5 cm/s, against 13% for the next
# longest) — and it contains both the outward spiral tracking and the wall
# interactions the barrier exists for.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root "assets\data\robot_odom.csv"
$dst = Join-Path $root "assets\data\cbf-run.csv"

$SEG_START = 4364   # 0-based index into the data rows (header excluded)
$SEG_END = 6071
$STRIDE = 2

$rows = Get-Content $src | Select-Object -Skip 1
$t = @(); $x = @(); $y = @(); $yaw = @()
for ($i = $SEG_START; $i -le $SEG_END; $i++) {
    $p = $rows[$i].Split(',')
    $t += [double]$p[0]; $x += [double]$p[1]; $y += [double]$p[2]; $yaw += [double]$p[3]
}

# Unwrap yaw into a continuous angle, then re-zero time to the episode start.
$twoPi = 2 * [math]::PI
for ($i = 1; $i -lt $yaw.Count; $i++) {
    $d = $yaw[$i] - $yaw[$i-1]
    while ($d -gt [math]::PI) { $yaw[$i] -= $twoPi; $d = $yaw[$i] - $yaw[$i-1] }
    while ($d -lt -[math]::PI) { $yaw[$i] += $twoPi; $d = $yaw[$i] - $yaw[$i-1] }
}
$t0 = $t[0]

# Thin, always keeping the final sample so the loop ends where the run does.
$keep = New-Object System.Collections.Generic.List[int]
for ($i = 0; $i -lt $t.Count; $i += $STRIDE) { $keep.Add($i) }
if ($keep[$keep.Count-1] -ne $t.Count - 1) { $keep.Add($t.Count - 1) }

$out = New-Object System.Collections.Generic.List[string]
$out.Add("t,x,y,yaw")
foreach ($i in $keep) {
    $out.Add(("{0},{1},{2},{3}" -f `
        [math]::Round($t[$i] - $t0, 3),
        [math]::Round($x[$i], 4),
        [math]::Round($y[$i], 4),
        [math]::Round($yaw[$i], 4)))
}
[System.IO.File]::WriteAllLines($dst, $out, (New-Object System.Text.UTF8Encoding($false)))

"wrote $dst"
"  samples : $($keep.Count) (from $($t.Count) source rows, stride $STRIDE)"
"  duration: $([math]::Round($t[$t.Count-1] - $t0, 2)) s"
"  x range : $([math]::Round(($x | Measure-Object -Minimum).Minimum,3)) .. $([math]::Round(($x | Measure-Object -Maximum).Maximum,3))"
"  y range : $([math]::Round(($y | Measure-Object -Minimum).Minimum,3)) .. $([math]::Round(($y | Measure-Object -Maximum).Maximum,3))"
"  yaw     : $([math]::Round(($yaw | Measure-Object -Minimum).Minimum,3)) .. $([math]::Round(($yaw | Measure-Object -Maximum).Maximum,3)) rad (unwrapped)"
"  size    : $([math]::Round((Get-Item $dst).Length / 1KB, 1)) KB"
