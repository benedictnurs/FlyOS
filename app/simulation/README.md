# FlyOS household learning lab

`engine.ts` contains separate Environment, Robot, Perception, WorkingMemory,
SpatialMemory, AssociativeMemory, SkillMemory, Policy, Planner, RewardSystem,
and TrainingLoop classes. `../world.tsx` renders the environment with Three.js;
`../console.tsx` renders observations, memories, charts and controls.

The policy starts with zero Q-values and 95% exploration. Each step updates
object-relative action values with temporal-difference learning. Distance-based
potential feedback, first-visit curiosity and interaction feedback reward progress;
there are no chore action scripts or coordinate trajectories. Perception uses a
four-cell proximity radius. Spatial memory only receives observed entities.
Successful experience fragments supply state-conditioned action suggestions,
used as tie-breakers by the learned policy. This is basic skill reuse, not a
hierarchical options planner or biological connectome implementation.

World changes persist until an explicit reset or episode boundary. Episodes reset
the same house, keep action values and skills, and stop on success or 400 actions.
Browser storage retains learned values, skills and metrics. Reset Brain clears them.
Reset Environment preserves them. Eight chore modes use independently evaluated
completion conditions. Delivery and whole-house cleanup may need substantially
more training and are not guaranteed to converge.

The rendered humanoid has two grippers; the simplified interaction model supports
one held item. The house is rendered in 3D, with discrete planar movement and wall
collisions, rather than rigid-body manipulation physics. Proximity sensing is
omnidirectional and does not implement occlusion. Furniture is primarily visual.

Validation:

    node --experimental-strip-types --test app/simulation/engine.test.mjs
    npm run build

The deterministic 1,000-episode test verifies learning improvement, not a fixed
animation or fabricated metric series. Other tests check persistent placement,
wall collision, local perception and preservation of learning across world resets.
