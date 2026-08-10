# Team Scheduler

Tool for visualizing how people map onto an org structure.

## Run

Open `index.html` directly in a browser.

## Input format

### `== PEOPLE ==`

Not all opinions wight the same. In this section you can tune the strength of all the preferences of a person. By default, the multiplier is `×1`/

```txt
# Name    strength (1–10)
Alice   6
Carol   8
# Bob not listed. Defaults to strength 1
```

### `== STRUCTURE ==`

Where do you need people assigned? The structure allows sub-structures.

```txt
# Name  [size:MIN-MAX]   — indentation defines parent–child
Engineering
  Project Manager  size:1
  Product Lead     size:1
  Frontend   size:2-4
    Lead     size:1
  Backend    size:2-4
    Lead     size:1
```

Short names that appear more than once (e.g. `Lead` under both Frontend and Backend) are disambiguated in preferences using path syntax: `Frontend/Lead` vs `Backend/Lead`.

### `== PREFERENCES ==`

```txt
# @Author  From -> To : Force
# Force defaults to +6 if omitted.
# Force: positive = attraction, negative = avoidance.
# Author's strength scales the force.
# Target can be a person or an area.

@Alice   Alice  -> Frontend/Lead        # Alice wants the Frontend Lead role
@Alice   Alice  -> Morgan        : -4   # Alice avoids Morgan
@Carol   Alice  -> Bob                  # Carol thinks Alice and Bob should work together
```

## Assignment logic

Each person is assigned to the **structural node with the highest total spring score**. Score for person P going to node G:

```txt
score(G) = Σ  spring.force × author.strength
           for all springs where from=P, to=G, force > 0
```

Multiple people endorsing the same assignment stack up. A person with no structural spring falls back to the nearest leaf area by position.
