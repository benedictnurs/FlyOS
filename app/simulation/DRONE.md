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

Each drone has a `BrainInstance`; all drones share an 8→12→1 search-value
network, observation memory and explored cells. Every drone updates search
weights from accumulated rewards every half simulation second. Learned values
refine search-waypoint ranking. Fleet size, deployment failure history and pain
are inputs to the search model.

The same fly brain also owns a shared 12→16→3 actor/critic landing policy.
It chooses lateral and vertical velocity commands every 0.1 simulation seconds
from observed target offsets, estimated motion, aircraft velocity and pain.
Basic alignment weights initialize the policy. It explores small action changes
and updates both policy and value weights using progress, descent speed, guard
contacts, landing time and actual mission rewards. Physics converts those
commands into bounded thrust and attitude. Mission assignment, return-to-launch
and collision safety remain scripted. Learned search and landing weights survive
mission resets and map changes within the page session. The UI reports training
updates and landing outcomes. Exports include both models and up to 2,400 samples
per drone; reloading the page starts fresh.

Losing a confirmed observation incurs a -10 pain penalty once per loss episode.
Discovery bonuses are once per drone per mission. Confidence is a heuristic,
not a calibrated probability. Online training is implemented, but improved task
performance from training has not been established by evaluation.

The independent person controller is active in Run & hide mode. It chooses groves,
tree cover or trenches using local drone awareness and remembers exposed places.
Time spent hiding costs 0.5 points per second. A configurable 2–10 second hiding
limit forces relocation; the default is 5 seconds. The person has its own fly brain instance and model for learned cover selection.
Adaptive hiding can evade the search indefinitely; active drones do not stop
because of a search timeout.

Validation:

    node --import tsx --test app/simulation/drone.test.mjs
    node --import tsx --test app/visualization/person-pose.test.mjs
    npx tsc --noEmit
    npm run build

Drones have visible rotor guards and collision envelopes for trunks, field edges,
and other drones. Bushes and tree crowns follow the same rules. Lost sightings
near foliage, or 45 seconds of unsuccessful search near cover, can trigger an
investigation. Suspicion uses cover locations and observation memory, never the
hidden person's coordinates. Tree descent sites avoid the solid trunk.
Fresh sightings outside committed cover are shared across the fleet. They cancel
the old descent, release its landing assignment and briefly reassess without
consuming the drone. Shared vacancy memory suppresses another investigation of
that cover for 12 seconds; a newer sighting inside it allows re-entry. This applies
to bushes and tree crowns and requires an actual local or teammate observation.
A narrow rotor-wash column clears the descent path, affecting foliage rendering,
shadows and sensor rays. Touchdown removes the whole intersected bush patch or
tree crown. Trunks remain solid, and clearing persists until mission reset.

Only one drone descends at a time. A failed landing costs −250, sets pain to
100%, consumes that drone and releases the landing assignment to another active
aircraft. Search continues until a successful landing or zero active drones.
If the whole fleet is exhausted without a confirmed person, every deployed drone
receives another −250 once and an immediate terminal learning update. Failure
history is retained by fleet size across mission resets. This is feedback for
learning risk, not evidence that the model has mastered risk or optimal landing.

Successful touchdown starts a fall into a flat pose with arms and legs spread.
The 1.4-second animation uses presentation time so it continues after mission
physics stops; changing the camera preserves animation progress. The actual
skinned asset's ground clearance and limb directions are verified in code tests.
