# Animation Data for TurtleBot3 CBF Simulation

## Current playback

The page loads `cbf-run.csv`, `spiral_geometry.csv`, and `walls.csv`.
The source `robot_odom.csv` has 3,232 samples spanning 0-116.438 s.

`scripts/export-cbf-run.ps1` exports **0-80 s**, retaining all 2,225 source
samples in that window and adding one interpolated sample at exactly 80 s.
The animation plays these 2,226 samples at **2× speed**, taking **40 seconds**,
then holds the final pose for 1.2 seconds before restarting.

Columns: `t,x,y,yaw`. Time retains the source origin, rounded to 1 us;
positions and unwrapped yaw are rounded to four decimal places. The opening
pose is (0.0189, 0.0223) m, close to the room center.

The raw capture contains three large pose resets. The export blends each reset
into the recorded trajectory over 1.5 seconds with a smoothstep curve, so the
robot and orange trail remain continuous. Source timestamps and all samples
outside the blend windows are preserved; positions and headings within those
short blend windows are visual smoothing rather than raw recorded poses.

## Original export reference

The notes below came with an earlier export. Capture durations and sample
counts below are historical; the current recording and playback are above.

This directory contains CSV files exported from a 130-second ROS 2 + Gazebo simulation run featuring:
- TurtleBot3 Burger robot with spiral trajectory tracking
- CBF (Control Barrier Function) safety filter preventing wall collisions
- Robot position, orientation, and wall geometry recorded for animation

## Files

### `robot_odom.csv`
Robot odometry data recorded at ~30 Hz for the entire 130-second run.

**Columns:**
- `time` (seconds): Elapsed time from simulation start (0.0 to ~130.0)
- `x` (meters): Robot x-position in world frame
- `y` (meters): Robot y-position in world frame  
- `yaw` (radians): Robot heading/orientation (-π to π)
- `vx` (m/s): X velocity (from odometry message)
- `vy` (m/s): Y velocity (from odometry message)
- `omega` (rad/s): Angular velocity

**Usage for animation:**
- Sample count: 3,650 frames at ~28 Hz nominal
- Use `x, y, yaw` to animate the robot's pose over time
- Step through rows sequentially to get smooth 30 Hz playback
- Can interpolate between rows for smoother animation if needed

### `spiral_geometry.csv`
Reference spiral trajectory that the robot was commanded to follow (independent of the CBF safety filter).

**Columns:**
- `x` (meters): X coordinate of reference path point
- `y` (meters): Y coordinate of reference path point

**Usage for animation:**
- 300 points defining the ideal spiral path
- Draw as a line or sequence of points to show the reference trajectory
- Gray/light color to distinguish from actual robot trajectory
- Shows what the robot was commanded to do before safety filtering

### `walls.csv`
Safety region boundaries enforced by the CBF barrier function.

**Columns:**
- `x_min`, `x_max`: X bounds (meters)
- `y_min`, `y_max`: Y bounds (meters)

**Interpretation:**
- The robot's look-ahead point (0.15 m ahead of center) cannot exit this rectangle
- These bounds were derived from the SDF world's wall geometry
- Safe region: [-2.75 to 2.75] m in X, [-6.75 to 6.75] m in Y
- Represents a 5.5 m wide × 13.5 m tall rectangular room

## Visualization Ideas

1. **Simple 2D Animation:**
   - Draw robot as a circle/arrow at (x, y) with rotation yaw
   - Draw spiral path as light gray line
   - Draw walls as dark rectangle outline
   - Play through robot_odom.csv rows at 30 Hz

2. **Comparison Mode:**
   - Show reference spiral in one color (what was commanded)
   - Show actual robot trajectory in another (what actually happened with CBF)
   - Overlay to see how much the safety filter modified the commands

3. **Time-indexed playback:**
   - Each row's `time` field indicates when to show that pose
   - For 30 Hz playback: sleep (row[i].time - row[i-1].time) between frames
   - Or resample to fixed timestep (e.g., 0.033 s for 30 Hz)

## Data Quality Notes

- **Position accuracy:** Ground truth from physics engine, not dead-reckoning odometry
- **Recording rate:** Actual ~28 Hz (slightly variable due to ROS 2 scheduling)
- **Coverage:** Full spiral cycle from center outward until wall touch + reset
- **Velocity fields:** May be zero in odometry message (DiffDrive quirk)
  - Compute from position deltas if needed: `v = Δpos / Δt`
  - Or use `sqrt(dx² + dy²) / dt` for speed at each timestep

## Example Python Animation Loop

```python
import csv
import time

# Load data
with open('robot_odom.csv') as f:
    odom = list(csv.DictReader(f))

start_time = time.time()
start_sim_time = float(odom[0]['time'])

for row in odom:
    sim_time = float(row['time'])
    elapsed = sim_time - start_sim_time
    
    # Sleep until we reach this frame's timestamp
    while time.time() - start_time < elapsed:
        time.sleep(0.001)
    
    x = float(row['x'])
    y = float(row['y'])
    yaw = float(row['yaw'])
    
    # Draw robot at (x, y) with heading yaw
    draw_robot(x, y, yaw)
```

## Specifications

- **Simulation:** ROS 2 Humble + Gazebo Harmonic (gz-sim)
- **Robot:** TurtleBot3 Burger (differential drive)
- **Max speed:** 1.0 m/s (nominal), 2.84 rad/s angular
- **Control rate:** 50 Hz (command updates)
- **Recording rate:** 30 Hz nominal (constraint: /ground_truth/odom updates at ~58 Hz)
- **World:** NCR Indoor Lab (rectangular room with walls as barrier)

## Companion Files

- `spiral_geometry.csv` - Reference trajectory (300 points)
- `walls.csv` - Room boundaries (1 row defining rectangle)

For questions about the simulation or data format, see the project's CLAUDE.md file.
