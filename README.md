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

Short names that appear more than once (e.g. `Lead` under both Frontend and Backend) are disambiguated in preferences using partial path syntax: `Frontend/Lead` vs `Backend/Lead`.

### `== PREFERENCES ==`

Express where someone should (or shouldn't) go. Use an optional `# comment` to record the reasoning.

```txt
Alice strongly prefers Frontend     # part of her growth plan
Carol prefers Alice                  # Carol wants to work with Alice
Dave avoids Carol                    # conflict of interest
Bob requires Backend/Lead            # confirmed with leadership
```

**Verbs and their strength:**

| Verb | Force | Meaning |
| --- | --- | --- |
| `prefers` | +6 | mild preference for |
| `strongly prefers` | +8 | strong preference for |
| `requires` | +100 | effectively mandatory (beats all other considerations) |
| `avoids` | −6 | mild avoidance of |
| `strongly avoids` | −8 | strong avoidance of |

The target can be an **area** (placement preference) or a **person** (co-location / separation preference).

Avoidance springs are binary — any separation from the target is fully satisfying.

## Assignment logic

People are assigned to areas to maximize total preference satisfaction. The solver runs:

1. **Greedy** — place each person (PEOPLE order) in the best available spot
2. **Hill-climbing** — single-move passes until stable
3. **Swap passes** — exchange pairs of people to escape greedy local optima

### Co-location closeness

Person-to-person co-location springs (`Alice+Bob`) use a continuous **closeness** score instead of a binary same-area check:

```txt
closeness = 1 / (1 + tree_hops_through_LCA)
```

`tree_hops_through_LCA` is the total number of edges between both areas and their Lowest Common Ancestor. The spring's contribution to score and happiness is `force × closeness`.

| Arrangement | Example | Closeness | Happiness |
| --- | --- | --- | --- |
| Same area | both in Frontend | 1.0 | 100% |
| Parent / child | Frontend & Frontend/Lead | 0.5 | 50% |
| Two levels apart | Frontend & Frontend/Lead/Senior | 0.33 | 33% |
| Different subtrees | Frontend & Backend | 0 | 0% |

The tooltip shows `~` for partial satisfaction with the LCA node name so you can see exactly where the paths meet.

**Avoidance springs** (`Alice-Bob`) stay binary — any separation is fully satisfying.

## Happiness

Each person card shows a satisfaction percentage — the fraction of their preferences (by force magnitude) that are currently satisfied. Hover a card to see which preferences are met (✓) and which are not (✗), and who expressed each preference.

## Drag-and-drop / pins

Cards can be dragged between areas to manually place people. When you start dragging a card, areas that match that person's preferences are highlighted (green = wants to be there, red = avoids, accent border = requires), and badge labels show the verb. Areas where others want to be near that person are also highlighted.

Dragging **does not trigger a re-solve** — people stay where they are so you can reason about the change in isolation. When you're happy with manual placements, click **Solve** to re-optimize free people around your pinned choices.

Pinned placements persist across re-solves and are saved to localStorage. Click `×` on a pinned card to release it (the person stays put until the next Solve).

**Undo / Redo**: `Ctrl+Z` / `Ctrl+Y` (or `Ctrl+Shift+Z`) steps through drag, unpin, solve, and clear-pins actions.

## Export

**Copy MD** copies the current assignment as a Markdown outline.
