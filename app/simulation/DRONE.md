# Aerial simulation

The active browser simulation uses `drone.ts`, `flight.ts`, `terrain.ts`,
`person-brain.ts`, and `swarm-brain.ts`. The earlier household prototype is
retained separately and is not mounted.

Select Find or Find / Land in the task dropdown. The scene supports 1–8 drones,
a selected-drone POV/follow camera, and an observer close-up. Follow-camera
position and aim use frame-time-based damping. Actor transforms are interpolated
for display. There is no floating person label and no battery simulation.

World dimensions are meters. The person is 2 m tall; drone span is 0.30 m and
mass is 0.25 kg. Flight uses a fixed 120 Hz step, thrust lag, a 6.5 N thrust limit,
gravity, drag, wind and attitude control. Contact uses explicit game collider
volumes, not GLB triangle collisions. It is a reduced simulation, not a validated
real aircraft or aerodynamic model. Runtime GLBs have reduced textures; originals
remain untouched. Rebuild runtime assets on macOS with
`python3 scripts/optimize-models.py`.

Maps are seeded and chunked. Generate changes the seed; Expand extends the map
by 30 m up to 150 m while retaining existing chunks. Both start a new mission.
Trees, vegetation and trenches occlude the simulated sensor; perception is not
image recognition. Scene geometry and actor elevation use the same terrain
sampler. The search controller remembers last observations and can briefly camp
near remembered cover before resuming search.

All drones share a 6→12→1 neural value network, observation memory and explored
cells. Every drone updates the same weights from its accumulated rewards every
half simulation second. Learned values refine search-waypoint ranking; motor
control and task transitions remain scripted. Shared weights survive mission
resets and map changes within the page session. The UI reports updates, loss and
contributing drones. Export run downloads versioned scale metadata, shared weights
and up to 2,400 trajectory samples per drone; reloading the page starts fresh.

Losing a confirmed observation incurs a -10 pain penalty once per loss episode.
Discovery bonuses are once per drone per mission. Confidence is a heuristic,
not a calibrated probability. Online training is implemented, but improved task
performance from training has not been established by evaluation.

The independent person controller is active in Run & hide mode. It chooses groves,
tree cover or trenches using local drone awareness and remembers exposed places.
Time spent hiding costs 0.5 points per second. A configurable 2–10 second hiding
limit forces relocation; the default is 5 seconds. This person controller is an
adaptive heuristic, not a second trained neural model. Adaptive hiding can evade
the search indefinitely; a mission timeout is not reported as success.

Validation:

    node --import tsx --test app/simulation/drone.test.mjs
    npx tsc --noEmit
    npm run build

Drones have visible rotor guards and collision envelopes for trunks, field edges,
and other drones. After losing a sighting near foliage, or after 45 seconds of
unsuccessful search near cover, a drone suspects that cover and investigates by
descending. Suspicion uses cover locations and observation memory, never the
hidden person's position. A narrow rotor-wash column removes foliage as the drone
descends; the same clearing affects rendered foliage, shadows and sensor rays.
Trunks remain solid. A confirmed sighting resumes the selected task. Empty cover
ends in a grounded failure with motors off, no contact success and no explosion.
Other fleet members continue searching. Clearings persist until mission reset.
