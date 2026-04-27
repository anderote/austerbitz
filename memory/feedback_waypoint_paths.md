---
name: Transparent waypoint paths for unselected units are intentional
description: Selection-pass waypoint chains render at low alpha for unselected player units (and full alpha for selected). User confirmed this is desired UX.
type: feedback
---

The selection pass renders waypoint chains for ALL player units that have a queued order — selected ones at full opacity, unselected ones at low opacity — plus arrow markers and centroid collapsing for group selections.

I flagged this as scope creep when it landed (it wasn't in the formation-drag spec). User: "i like the transparent paths its intentional".

**Why:** the player wants to see where every squad is heading, not only the squad currently selected. Keeps situational awareness across the battlefield.

**How to apply:** Don't try to remove or simplify the unselected-unit waypoint rendering in `src/render/passes/selection-pass.ts`. If a future task touches that file, preserve the low-opacity unselected chains and the arrow markers. Same applies to the centroid-of-targets collapsing for multi-unit selections.
