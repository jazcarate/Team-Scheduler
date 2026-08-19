# Team Scheduler

Tool for assigning people to an org structure based on their preferences.

## Run

Open `index.html` directly in a browser.

## Input format

### `== PEOPLE ==`

The full roster of people to be assigned. One name per line.

```
Alice
Carol
Bob
Dave
```

### `== STRUCTURE ==`

Where people need to be placed. Indentation defines the hierarchy. Use `size:MIN-MAX` to set capacity constraints.

```
Engineering
  Project Manager  size:1
  Frontend         size:2-4
    Lead           size:1
  Backend          size:2-4
    Lead           size:1
```

### `== PREFERENCES ==`

Express where someone should (or shouldn't) go. Use an optional `# comment` to record the reasoning.

```
Alice strongly prefers Frontend      # part of her growth plan
Carol prefers Alice                  # Carol wants to work with Alice
Dave avoids Carol                    # conflict of interest
Bob requires Backend/Lead
Alice prefers Lead
```

Short structure names that appear more than once (e.g. `Lead` under both Frontend and Backend) can be disambiguated with partial path syntax: `Frontend/Lead` vs `Backend/Lead`. They can also be used without disambiguation — `Alice prefers Lead` makes Alice happy in *either* `Backend/Lead` or `Frontend/Lead`.

**Verbs and their strength:**

`requires` > `strongly prefers` > `prefers`  
`strongly avoids` > `avoids`

The target can be an **area** (placement preference) or a **person** (co-location preference).

## Solver

The solver maximises total happiness — the sum of each person's raw preference satisfaction score. Capacity (`sizeMax`) is a hard constraint: moves that exceed it are never applied.

### Happiness score

Each preference contributes its **force** to a person's score when satisfied:

| Verb | Force |
| --- | --- |
| `requires` | +100 |
| `strongly prefers` | +8 |
| `prefers` | +6 |
| `avoids` | −6 |
| `strongly avoids` | −8 |

For area preferences, the force is added if the person is in that area or any descendant. For avoidance, it subtracts if the person *is* in the avoided area. For person-to-person preferences (`Alice prefers Bob`), the force is weighted by **closeness** — a gradient from 0 to 1 based on how near they are in the org tree.

### Co-location closeness

```
closeness = 1 / (1 + hops through the Lowest Common Ancestor)
```

Same area → 1.0. Parent/child → 0.5. Unrelated subtrees → 0.

### Solver phases (same input always gives the same output)

**Phase 1 — Deterministic initial placement**  
Free people are placed in a pseudo-random order into assignable areas. The random seed is derived deterministically from the input (FNV-1a hash → LCG), so the same input always produces the same starting point. Capacity is respected at each placement.

**Phase 2 — Preference-guided improvement**  
Repeat until no improvement is found:

1. Rank free people by individual happiness score (least happy first).
2. For the least happy person, generate candidate moves **directly from their preferences** — only moves that their prefs motivate:
   - *Area pref (+)*: move person to each matching area; swap with anyone already there.
   - *Area pref (−)*: if currently in the avoided area, try moving anywhere else.
   - *Person pref (+)*: try every area for this person (closeness is a gradient, any move might help); also try bringing the other person here, or swapping.
   - *Person pref (−)*: if sharing an area with the avoided person, try moving either of them out.
3. Score every candidate by Δ(total happiness). Apply the best improving move — this may move someone *other* than the least-happy person (e.g. swapping them out of a preferred area).
4. Restart from step 1. Stop when no person has any improving candidate.

## Happiness display

Each person card shows a satisfaction percentage — the fraction of their preferences (weighted by force magnitude) that are currently met. Hover a card to see which preferences are satisfied (✓) and which are not (✗).

The header shows **Team happiness**: the average satisfaction across all people, updating live as you drag cards around.

## Drag-and-drop / pins

Cards can be dragged between areas to manually place people. When dragging, areas that match the person's preferences are highlighted (green = wants to be there, red = avoids, blue border = requires), and badge labels show the verb.

Dragging **does not trigger a re-solve** — people stay where they are so you can reason about the change in isolation. Click **Solve** to re-optimise free people around your pinned choices.

Pinned placements persist across re-solves and are saved to localStorage. Click `×` on a pinned card to release it.

**Undo / Redo**: `Ctrl+Z` / `Ctrl+Y` (or `Ctrl+Shift+Z`).

## Export

**Copy as Markdown** copies the current assignment as a Markdown outline.
