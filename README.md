# Team Scheduler

Physics-based tool for visualizing how people map onto an org structure. Springs encode preferences; the simulation settles into an equilibrium that reflects everyone's stated intent simultaneously.

## Run

Open `index.html` directly in a browser, or serve with Python:

```bash
python3 serve.py   # http://localhost:9922
```

---

## Input format

### `== PEOPLE ==`

Optional per-person. Anyone not listed is **auto-created with strength 1**.

```
# Name    strength (1–10)
# Strength = how much this person's expressed preferences influence the simulation.
# Think seniority, decision-making weight, or how important their happiness is.
Alice   6
Carol   8
# Bob not listed → defaults to strength 1, auto-created when referenced in springs
```

### `== STRUCTURE ==`

Roles **are** areas — the same abstraction all the way down. Use `size:1` for a single-slot role.

```
# Name  [size:MIN-MAX]   — indentation defines parent–child
Engineering
  AM         size:1       # exactly 1 person in AM
  PM         size:1
  Frontend   size:2-4
    Lead     size:1       # lead role inside Frontend
  Backend    size:2-4
    Lead     size:1       # same short name — use path syntax in springs to disambiguate
```

Short names that appear more than once (e.g. `Lead` under both Frontend and Backend) are disambiguated in springs using path syntax: `Frontend/Lead` vs `Backend/Lead`.

### `== SPRINGS ==`

```
# @Author  From -> To : Force
# Force defaults to +6 if omitted.
# Force: positive = attraction, negative = avoidance.
# Author's strength scales the force (not From's strength).
# Target can be a person or an area.

@Alice   Alice  -> Frontend        : +8   # Alice wants Frontend
@Alice   Alice  -> Frontend/Lead   : +6   # Alice wants the lead role (unambiguous path)
@Alice   Alice  -> Bob             : +5   # Alice wants to work near Bob
@Alice   Alice  -> Morgan          : -4   # Alice avoids Morgan
@Morgan  Morgan -> Engineering              # no force → defaults to +6

@Carol   Alice  -> Frontend/Lead   : +7   # Carol endorses Alice for lead (Carol's strength used)
@Carol   Alice  -> Bob             : +6   # Carol thinks Alice and Bob should work together
```

The `@Author` is **always required**. All springs are physically bidirectional (Newton's 3rd law).

### `== PINS ==` *(written automatically)*

When you drag a node in the canvas, the app writes its pinned position here. You don't edit this section by hand — it's serialized so positions survive a re-run.

---

## Google Form — one submission per person

Use these questions to collect input. Responses map directly to the `== SPRINGS ==` section.

---

### Section 1 — About you

> **Q1.** Your name *(short answer)*

> **Q2.** Your influence level — how much weight should your preferences carry? *(single choice)*
>
> - New joiner — 3
> - Team member — 5
> - Senior IC — 7
> - Staff / Principal — 9
> - Let me pick a number 1–10

Add to `== PEOPLE ==` only if they pick something other than the default. Everyone not listed defaults to strength 1.

---

### Section 2 — Where do you want to work?

> **Q3.** Which areas or roles interest you? Rate each.
> Grid: rows = all areas and roles; columns = Not interested · Mild +3 · Yes +6 · Strong +9.
> Example rows: Engineering, Engineering/AM, Engineering/PM, Frontend, Frontend/Lead, Backend, Backend/Lead

→ Each non-zero answer becomes `@[Name] [Name] -> [Area] : +[score]`

---

### Section 3 — Who do you want to work with?

> **Q4.** People you'd like to work near *(names + strength 1–10)*

→ `@[Name] [Name] -> [Person] : +[score]`

> **Q5.** People you'd prefer to avoid *(names + avoid-strength 1–5)*

→ `@[Name] [Name] -> [Person] : -[score]`

---

### Section 4 — Recommendations (optional)

> **Q6.** Is there a collaboration you'd recommend?
> Format: `Person A, Person B, strength`
> *e.g. Alice, Bob, 7 — they've worked well together before*

→ `@[You] [Person A] -> [Person B] : +[strength]`

> **Q7.** Any role assignment you'd recommend?
> Format: `Person, Area/Role, strength`
> *e.g. Alice, Frontend/Lead, 8 — she'd be a great lead*

→ `@[You] [Person] -> [Area/Role] : +[strength]`

---

## Canvas interactions

| Action | Effect |
| --- | --- |
| **Drag** a person bubble | Moves it and **pins** it (stays fixed while sim continues) |
| **Tap** a pinned bubble | Unpins it (releases back into physics) |
| **Unpin All** button | Releases all pins and resumes simulation |
| **Pause / Resume** | Freezes or continues the physics |
| **Parse & Run** | Re-parses input; pinned positions (from `== PINS ==`) are preserved |

---

## Assignment logic

Each person is assigned to the **structural node with the highest total spring score**. Score for person P going to node G:

```
score(G) = Σ  spring.force × author.strength
           for all springs where from=P, to=G, force > 0
```

Multiple people endorsing the same assignment stack up. A person with no structural spring falls back to the nearest leaf area by position.

## File layout

```
index.html          shell
css/style.css       dark theme
js/parser.js        parseInput() — text → ParseResult
js/physics.js       Simulation, buildSim(), layoutGroups()
js/renderer.js      Renderer (canvas 2D)
js/assignments.js   computeAssignments(), formatAssignments()
js/app.js           controller, drag/pin, EXAMPLE
serve.py            python3 serve.py → localhost:9922
```
