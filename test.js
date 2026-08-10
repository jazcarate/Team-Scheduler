#!/usr/bin/env node
'use strict';

const fs = require('fs');
const vm = require('vm');

vm.runInThisContext(fs.readFileSync(__dirname + '/js/parser.js', 'utf8'));
vm.runInThisContext(fs.readFileSync(__dirname + '/js/solver.js', 'utf8'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); failed++; }
}
function eq(a, b, msg) {
  const as = JSON.stringify(a), bs = JSON.stringify(b);
  if (as !== bs) throw new Error(msg || `got ${as}, want ${bs}`);
}
function ok(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

// ── Parser ────────────────────────────────────────────────────────
console.log('\nParser');

test('basic structure and people', () => {
  const r = parseInput(`
== PEOPLE ==
Alice  8

== STRUCTURE ==
Engineering
  Frontend  size:2-4

== PREFERENCES ==
@Alice  Alice -> Frontend
`);
  ok(r.errors.length === 0, r.errors.join());
  eq(r.nodes['Alice'].weight, 8);
  eq(r.nodes['Engineering/Frontend'].sizeMin, 2);
  eq(r.nodes['Engineering/Frontend'].sizeMax, 4);
  eq(r.springs.length, 1);
  eq(r.springs[0].force, 6);       // default force
  eq(r.springs[0].to, 'Engineering/Frontend');
});

test('default spring force is +6', () => {
  const r = parseInput(`
== STRUCTURE ==
Engineering

== PREFERENCES ==
@Alice  Alice -> Engineering
`);
  eq(r.springs[0].force, 6);
});

test('explicit force is used when provided', () => {
  const r = parseInput(`
== STRUCTURE ==
Engineering

== PREFERENCES ==
@Alice  Alice -> Engineering  :  +9
`);
  eq(r.springs[0].force, 9);
});

test('negative force spring', () => {
  const r = parseInput(`
== STRUCTURE ==
Engineering

== PREFERENCES ==
@Alice  Alice -> Engineering  :  -4
`);
  eq(r.springs[0].force, -4);
});

test('auto-create person with default strength 1', () => {
  const r = parseInput(`
== STRUCTURE ==
Engineering

== PREFERENCES ==
@Bob  Bob -> Engineering
`);
  ok(r.errors.length === 0, r.errors.join());
  ok('Bob' in r.nodes, 'Bob not found');
  eq(r.nodes['Bob'].weight, 1);
  ok(r.mobileNodes.includes('Bob'));
});

test('explicit person strength overrides auto-create default', () => {
  const r = parseInput(`
== PEOPLE ==
Alice  9

== STRUCTURE ==
Engineering

== PREFERENCES ==
@Alice  Alice -> Engineering
`);
  eq(r.nodes['Alice'].weight, 9);
});

test('path suffix resolution — unambiguous short name', () => {
  const r = parseInput(`
== STRUCTURE ==
Engineering
  Frontend
    Lead  size:1

== PREFERENCES ==
@Alice  Alice -> Lead  :  +8
`);
  ok(r.errors.length === 0, r.errors.join());
  eq(r.springs[0].to, 'Engineering/Frontend/Lead');
});

test('path suffix resolution — partial path Frontend/Lead', () => {
  const r = parseInput(`
== STRUCTURE ==
Engineering
  Frontend
    Lead  size:1
  Backend
    Lead  size:1

== PREFERENCES ==
@Alice  Alice -> Frontend/Lead  :  +8
@Alice  Alice -> Backend/Lead   :  +3
`);
  ok(r.errors.length === 0, r.errors.join());
  eq(r.springs[0].to, 'Engineering/Frontend/Lead');
  eq(r.springs[1].to, 'Engineering/Backend/Lead');
});

test('ambiguous bare name produces error', () => {
  const r = parseInput(`
== STRUCTURE ==
Engineering
  Frontend
    Lead  size:1
  Backend
    Lead  size:1

== PREFERENCES ==
@Alice  Alice -> Lead  :  +8
`);
  ok(r.errors.some(e => e.toLowerCase().includes('ambiguous')), 'expected ambiguity error');
  eq(r.springs.length, 0);
});

test('third-party endorsement — author different from from-node', () => {
  const r = parseInput(`
== PEOPLE ==
Carol  8

== STRUCTURE ==
Engineering
  Frontend

== PREFERENCES ==
@Carol  Alice -> Frontend  :  +7
`);
  ok(r.errors.length === 0, r.errors.join());
  eq(r.springs[0].author, 'Carol');
  eq(r.springs[0].from, 'Alice');
  eq(r.springs[0].to, 'Engineering/Frontend');
  eq(r.nodes['Alice'].weight, 1);   // auto-created
});

test('multi-level structure paths are correct', () => {
  const r = parseInput(`
== STRUCTURE ==
Org
  Engineering
    Frontend
      Lead  size:1
    Backend  size:2-5
  Design
    UX  size:1-2
`);
  ok(r.errors.length === 0, r.errors.join());
  ok('Org/Engineering/Frontend/Lead' in r.nodes);
  ok('Org/Engineering/Backend' in r.nodes);
  ok('Org/Design/UX' in r.nodes);
  eq(r.nodes['Org/Engineering/Backend'].sizeMin, 2);
  eq(r.nodes['Org/Engineering/Backend'].sizeMax, 5);
  eq(r.nodes['Org/Design/UX'].sizeMin, 1);
  eq(r.nodes['Org/Design/UX'].sizeMax, 2);
  eq(r.rootNodes, ['Org']);
  eq(r.nodes['Org'].children, ['Org/Engineering', 'Org/Design']);
});

test('PEOPLE order preserved in mobileNodes', () => {
  const r = parseInput(`
== PEOPLE ==
Charlie  6
Alice    8
Bob      4
`);
  eq(r.mobileNodes, ['Charlie', 'Alice', 'Bob']);
});

test('auto-created persons appended after PEOPLE persons', () => {
  const r = parseInput(`
== PEOPLE ==
Alice  6

== STRUCTURE ==
Engineering

== PREFERENCES ==
@Alice  Alice -> Engineering
@Bob    Bob   -> Engineering
`);
  eq(r.mobileNodes[0], 'Alice');
  eq(r.mobileNodes[1], 'Bob');
});

test('comments and blank lines are ignored', () => {
  const r = parseInput(`
# top comment

== PEOPLE ==
# this person has strength 6
Alice  6

== STRUCTURE ==
Engineering  # trailing comment
`);
  ok(r.errors.length === 0, r.errors.join());
  ok('Alice' in r.nodes);
  ok('Engineering' in r.nodes);
});

// ── Shorthand syntax ──────────────────────────────────────────────
console.log('\nShorthand syntax');

test('single + is +6', () => {
  const r = parseInput(`
== STRUCTURE ==
Engineering
== PREFERENCES ==
@Alice  Alice+Engineering
`);
  ok(r.errors.length === 0, r.errors.join());
  eq(r.springs[0].force, 6);
  eq(r.springs[0].from, 'Alice');
  eq(r.springs[0].to, 'Engineering');
});

test('double ++ is +8', () => {
  const r = parseInput(`
== STRUCTURE ==
Engineering
== PREFERENCES ==
@Alice  Alice++Engineering
`);
  eq(r.springs[0].force, 8);
});

test('triple +++ is +10', () => {
  const r = parseInput(`
== STRUCTURE ==
Engineering
== PREFERENCES ==
@Alice  Alice+++Engineering
`);
  eq(r.springs[0].force, 10);
});

test('single - is -6', () => {
  const r = parseInput(`
== PEOPLE ==
Carol  5
== STRUCTURE ==
Engineering
== PREFERENCES ==
@Alice  Alice-Carol
`);
  eq(r.springs[0].force, -6);
  eq(r.springs[0].from, 'Alice');
  eq(r.springs[0].to, 'Carol');
});

test('double -- is -8', () => {
  const r = parseInput(`
== PEOPLE ==
Dave  5
== PREFERENCES ==
@Alice  Alice--Dave
`);
  eq(r.springs[0].force, -8);
});

test('shorthand forces cap at 10', () => {
  const r = parseInput(`
== STRUCTURE ==
Engineering
== PREFERENCES ==
@Alice  Alice+++++++Engineering
`);
  eq(r.springs[0].force, 10);
});

// ── Solver ────────────────────────────────────────────────────────
console.log('\nSolver');

test('person assigned to highest-score area', () => {
  const r = parseInput(`
== PEOPLE ==
Alice  5

== STRUCTURE ==
Engineering
  Frontend  size:2-4
  Backend   size:2-4

== PREFERENCES ==
@Alice  Alice -> Frontend  :  +8
@Alice  Alice -> Backend   :  +3
`);
  const { assignment } = solveAssignments(r);
  eq(assignment['Alice'], 'Engineering/Frontend');
});

test('author weight multiplies spring force in scoring', () => {
  // Alice self-rates Frontend +4 (strength 5 → score 20)
  // Carol (strength 9) endorses Alice for Backend +3 (score 27)
  // Alice should go to Backend due to Carol's weight
  const r = parseInput(`
== PEOPLE ==
Alice  5
Carol  9

== STRUCTURE ==
Engineering
  Frontend
  Backend

== PREFERENCES ==
@Alice  Alice -> Frontend  :  +4
@Carol  Alice -> Backend   :  +3
`);
  const { assignment } = solveAssignments(r);
  eq(assignment['Alice'], 'Engineering/Backend');
});

test('auto-created author uses strength 1', () => {
  // Bob (strength 1) endorses Alice for Backend +10 → score 10
  // Alice self-rates Frontend +8 (strength 7) → score 56 — Frontend wins
  const r = parseInput(`
== PEOPLE ==
Alice  7

== STRUCTURE ==
Engineering
  Frontend
  Backend

== PREFERENCES ==
@Alice  Alice -> Frontend  :  +8
@Bob    Alice -> Backend   :  +10
`);
  const { assignment } = solveAssignments(r);
  eq(assignment['Alice'], 'Engineering/Frontend');
});

test('negative person-to-person spring satisfied when in different areas', () => {
  const r = parseInput(`
== PEOPLE ==
Carol  5
Dave   5

== STRUCTURE ==
Engineering
  Frontend  size:3
  Backend   size:3

== PREFERENCES ==
@Carol  Carol-Dave
`);
  const { assignment, happiness } = solveAssignments(r);
  ok(assignment['Carol'] !== assignment['Dave'], 'Carol and Dave should be in different areas');
  ok(happiness['Carol'] >= 1, 'Carol should be happy');
});

test('positive person-to-person spring satisfied when in same area', () => {
  const r = parseInput(`
== PEOPLE ==
Alice  5
Carol  5

== STRUCTURE ==
Engineering
  Frontend  size:3
  Backend   size:3

== PREFERENCES ==
@Alice  Alice+Carol
`);
  const { assignment } = solveAssignments(r);
  eq(assignment['Alice'], assignment['Carol']);
});

test('ancestor area spring — parent area satisfied by leaf assignment', () => {
  const r = parseInput(`
== PEOPLE ==
Alice  5

== STRUCTURE ==
Engineering
  Frontend

== PREFERENCES ==
@Alice  Alice -> Engineering  :  +8
`);
  const { assignment, happiness } = solveAssignments(r);
  ok(assignment['Alice'] === 'Engineering/Frontend', 'should assign to leaf under Engineering');
  eq(happiness['Alice'], 1);
});

test('happiness is 1 for person with no preferences', () => {
  const r = parseInput(`
== PEOPLE ==
Alice  5

== STRUCTURE ==
Engineering
  Frontend
`);
  const { happiness } = solveAssignments(r);
  eq(happiness['Alice'], 1);
});

test('capacity limit respected as hard max', () => {
  const r = parseInput(`
== PEOPLE ==
Alice  5
Bob    5
Carol  5

== STRUCTURE ==
Engineering
  Frontend  size:1
  Backend   size:3

== PREFERENCES ==
@Alice  Alice -> Frontend  :  +8
@Bob    Bob   -> Frontend  :  +8
@Carol  Carol -> Frontend  :  +8
`);
  const { assignment } = solveAssignments(r);
  const inFrontend = Object.values(assignment).filter(a => a === 'Engineering/Frontend').length;
  ok(inFrontend <= 1, `Frontend has capacity 1, got ${inFrontend}`);
});

test('happiness 0 when preference is unsatisfied', () => {
  const r = parseInput(`
== PEOPLE ==
Alice  5

== STRUCTURE ==
Engineering
  Frontend  size:0
  Backend

== PREFERENCES ==
@Alice  Alice -> Frontend  :  +8
`);
  const { assignment, happiness } = solveAssignments(r);
  // Frontend has max 0, so Alice goes to Backend — preference unsatisfied
  eq(assignment['Alice'], 'Engineering/Backend');
  eq(happiness['Alice'], 0);
});

test('complex scenario: multiple people, mixed preferences', () => {
  const r = parseInput(`
== PEOPLE ==
Alice  7
Bob    6
Carol  8
Dave   5

== STRUCTURE ==
Engineering
  Frontend  size:2-3
  Backend   size:2-3

== PREFERENCES ==
@Alice  Alice -> Frontend  :  +8
@Bob    Bob -> Backend    :  +7
@Carol  Carol -> Frontend  :  +9
@Dave   Dave-Carol
`);
  const { assignment, happiness } = solveAssignments(r);
  eq(assignment['Alice'], 'Engineering/Frontend');
  eq(assignment['Bob'],   'Engineering/Backend');
  eq(assignment['Carol'], 'Engineering/Frontend');
  ok(assignment['Dave'] === 'Engineering/Backend', 'Dave avoids Carol (Frontend)');
  ok(happiness['Dave'] >= 1, 'Dave happy with Carol in a different area');
});

test('swap step rescues greedy mistake — wrong person in capacity-1 area', () => {
  // Alice (weight 1) weakly prefers Frontend (+3).
  // Bob   (weight 1) strongly prefers Frontend (+8).
  // Frontend size:1 — only one can go.
  // Greedy (mobileNodes order: Alice first) puts Alice in Frontend.
  // Single-move hill-climbing can't move Bob to Frontend because it's full.
  // Swap step swaps Alice ↔ Bob → Bob in Frontend (score 8), Alice in Backend (score 0).
  const r = parseInput(`
== PEOPLE ==
Alice  1
Bob    1

== STRUCTURE ==
Engineering
  Frontend  size:1
  Backend   size:1

== PREFERENCES ==
@Alice  Alice -> Frontend  :  +3
@Bob    Bob -> Frontend    :  +8
`);
  const { assignment } = solveAssignments(r);
  eq(assignment['Bob'], 'Engineering/Frontend', 'Bob should win the capacity-1 Frontend slot');
  eq(assignment['Alice'], 'Engineering/Backend');
});

test('computeHappiness reflects manual override', () => {
  const r = parseInput(`
== PEOPLE ==
Alice  5

== STRUCTURE ==
Engineering
  Frontend
  Backend

== PREFERENCES ==
@Alice  Alice -> Frontend  :  +8
`);
  const { assignment } = solveAssignments(r);
  eq(assignment['Alice'], 'Engineering/Frontend');

  // Manually override to Backend — happiness should drop to 0
  assignment['Alice'] = 'Engineering/Backend';
  const hap = computeHappiness(r, assignment);
  eq(hap['Alice'], 0);
});

console.log('');
if (failed === 0) { console.log(`All ${passed} tests passed.\n`); process.exit(0); }
else { console.log(`${passed} passed, ${failed} failed.\n`); process.exit(1); }
