# Team Scheduler

Tool for assigning people to an org structure based on their preferences.

## Run

Open `index.html` directly in a browser.

## Input format

### `== PEOPLE ==`

The full roster of people to be assigned. One name per line.

```txt
Alice
Carol
Bob
Dave
```

### `== STRUCTURE ==`

Where people need to be placed. Indentation defines the hierarchy. Use `size:MIN-MAX` to set capacity constraints.

```txt
Engineering
  Project Manager  size:1
  Frontend         size:2-4
    Lead           size:1
  Backend          size:2-4
    Lead           size:1
```

### `== PREFERENCES ==`

Express where someone should (or shouldn't) go. Use an optional `# comment` to record the reasoning.

```txt
Alice strongly prefers Frontend      # part of her growth plan
Carol prefers Alice                  # Carol wants to work with Alice
Dave avoids Carol                    # conflict of interest
Bob requires Backend/Lead
Alice prefers Lead
```

Short structure names that appear more than once (e.g. `Lead` under both Frontend and Backend) can be disambiguated in preferences using partial path syntax: `Frontend/Lead` vs `Backend/Lead`. But can also be used as a target of multiple places. For Example `Alice prefers Lead` will make Alice happy in either `Backend/Lead` or `Frontend/Lead` assignment.

**Verbs and their strength:**

`requires` is stronger than | `strongly prefers`, which is stronger than `prefers`.
`strongly avoids` is stronger than `avoids`.

The target can be an **area** (placement preference) or a **person**.

## Assignment logic

People are assigned to areas to maximise total happiness — the sum of each person's raw preference satisfaction score.

Each preference contributes its force when met (positive), or subtracts when violated (negative for avoidance in the same area). Capacity is enforced as a hard constraint — moves that exceed `sizeMax` are never applied.

### Solver phases (deterministic — same input always gives the same output)

**Phase 1 — Pseudo-random seed**  
Free people are placed in a random order into assignable areas using a deterministic seed derived from the input. Same input always produces the same initial placement.

**Phase 2 — Preference-guided improvement loop**  
Each round the solver finds the least happy free person and builds candidate moves *directly from their preferences*:

- **Area preference (+)**: try moving the person to each matching area; try swapping with anyone already there.
- **Area preference (−)**: if the person is currently in the avoided area, try moving them anywhere else.
- **Person preference (+)**: try every area for this person (closeness is a gradient); also try bringing the other person closer or swapping.
- **Person preference (−)**: if sharing an area with someone they avoid, try moving either of them out.

Every candidate is scored by Δ total happiness. The best improving move is applied (even if it moves someone other than the least-happy person — e.g. swapping them out). The loop restarts until no person has any improving move.

### Co-location closeness

Person-to-person preferences (`Alice prefers Bob`) use a **closeness** score:

```txt
closeness = 1 / (1 + tree_hops_through_LCA)
```

The tooltip shows `~` for partial satisfaction with the LCA node.

## Happiness

Each person card shows a satisfaction percentage — the fraction of their preferences (by force magnitude) that are currently satisfied. Hover a card to see which preferences are met (✓) and which are not (✗), and who expressed each preference.

## Drag-and-drop / pins

Cards can be dragged between areas to manually place people. When you start dragging a card, areas that match that person's preferences are highlighted (green = wants to be there, red = avoids, accent border = requires), and badge labels show the verb. Areas where others want to be near that person are also highlighted.

Dragging **does not trigger a re-solve** — people stay where they are so you can reason about the change in isolation. When you're happy with manual placements, click **Solve** to re-optimize free people around your pinned choices.

Pinned placements persist across re-solves and are saved to localStorage. Click `×` on a pinned card to release it (the person stays put until the next Solve).

**Undo / Redo**: `Ctrl+Z` / `Ctrl+Y` (or `Ctrl+Shift+Z`) steps through drag, unpin, solve, and clear-pins actions.

## Export

**Copy MD** copies the current assignment as a Markdown outline.
