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
Alice

== STRUCTURE ==
Engineering
  Frontend  size:2-4

== PREFERENCES ==
Alice prefers Frontend
`);
  ok(r.errors.length === 0, r.errors.join());
  ok('Alice' in r.nodes);
  eq(r.nodes['Engineering/Frontend'].sizeMin, 2);
  eq(r.nodes['Engineering/Frontend'].sizeMax, 4);
  eq(r.prefs.length, 1);
  eq(r.prefs[0].force, 6);
  eq(r.prefs[0].verb, 'prefers');
  eq(r.prefs[0].to, ['Engineering/Frontend']);
});

test('prefers gives force +6', () => {
  const r = parseInput(`
== PEOPLE ==
Alice
== STRUCTURE ==
Engineering
== PREFERENCES ==
Alice prefers Engineering
`);
  eq(r.prefs[0].force, 6);
  eq(r.prefs[0].verb, 'prefers');
});

test('strongly prefers gives force +8', () => {
  const r = parseInput(`
== PEOPLE ==
Alice
== STRUCTURE ==
Engineering
== PREFERENCES ==
Alice strongly prefers Engineering
`);
  eq(r.prefs[0].force, 8);
  eq(r.prefs[0].verb, 'strongly prefers');
});

test('requires gives force 100', () => {
  const r = parseInput(`
== PEOPLE ==
Alice
== STRUCTURE ==
Engineering
== PREFERENCES ==
Alice requires Engineering
`);
  eq(r.prefs[0].force, 100);
  eq(r.prefs[0].verb, 'requires');
});

test('avoids gives force -6', () => {
  const r = parseInput(`
== PEOPLE ==
Alice
== STRUCTURE ==
Engineering
== PREFERENCES ==
Alice avoids Engineering
`);
  eq(r.prefs[0].force, -6);
  eq(r.prefs[0].verb, 'avoids');
});

test('strongly avoids gives force -8', () => {
  const r = parseInput(`
== PEOPLE ==
Alice
Dave
== PREFERENCES ==
Alice strongly avoids Dave
`);
  eq(r.prefs[0].force, -8);
  eq(r.prefs[0].verb, 'strongly avoids');
});

test('all verbs parse to correct forces', () => {
  const r = parseInput(`
== PEOPLE ==
Alice
Bob
== STRUCTURE ==
Engineering
  Frontend
== PREFERENCES ==
Alice prefers Frontend
Alice strongly prefers Frontend
Alice requires Frontend
Bob avoids Frontend
Bob strongly avoids Frontend
`);
  ok(r.errors.length === 0, r.errors.join());
  eq(r.prefs[0].force, 6);
  eq(r.prefs[1].force, 8);
  eq(r.prefs[2].force, 100);
  eq(r.prefs[3].force, -6);
  eq(r.prefs[4].force, -8);
});

test('inline comment is parsed and stored on spring', () => {
  const r = parseInput(`
== PEOPLE ==
Alice
== STRUCTURE ==
Engineering
  Frontend
== PREFERENCES ==
Alice strongly prefers Frontend  # requested by manager
`);
  ok(r.errors.length === 0, r.errors.join());
  eq(r.prefs[0].comment, 'requested by manager');
  eq(r.prefs[0].verb, 'strongly prefers');
  eq(r.prefs[0].from, 'Alice');
  eq(r.prefs[0].to, ['Engineering/Frontend']);
});

test('preference without comment stores empty comment', () => {
  const r = parseInput(`
== PEOPLE ==
Alice
== STRUCTURE ==
Engineering
== PREFERENCES ==
Alice prefers Engineering
`);
  eq(r.prefs[0].comment, '');
});

test('old @Author syntax produces an error', () => {
  const r = parseInput(`
== PEOPLE ==
Dave
Bob
== STRUCTURE ==
Engineering
  Frontend
== PREFERENCES ==
@Foo  Dave---Bob
`);
  ok(r.errors.length > 0, 'old @Author syntax should not parse');
  eq(r.prefs.length, 0);
  ok(!('Foo' in r.nodes), 'Foo should not become a node');
});

test('person not in PEOPLE cannot appear as preference from', () => {
  const r = parseInput(`
== STRUCTURE ==
Engineering
== PREFERENCES ==
Alice prefers Engineering
`);
  ok(r.errors.length > 0, 'expected error for unknown from-node');
  eq(r.prefs.length, 0);
});

test('path suffix resolution — unambiguous short name', () => {
  const r = parseInput(`
== PEOPLE ==
Alice
== STRUCTURE ==
Engineering
  Frontend
    Lead  size:1
== PREFERENCES ==
Alice strongly prefers Lead
`);
  ok(r.errors.length === 0, r.errors.join());
  eq(r.prefs[0].to, ['Engineering/Frontend/Lead']);
});

test('path suffix resolution — partial path', () => {
  const r = parseInput(`
== PEOPLE ==
Alice
== STRUCTURE ==
Engineering
  Frontend
    Lead  size:1
  Backend
    Lead  size:1
== PREFERENCES ==
Alice strongly prefers Frontend/Lead
Alice prefers Backend/Lead
`);
  ok(r.errors.length === 0, r.errors.join());
  eq(r.prefs[0].to, ['Engineering/Frontend/Lead']);
  eq(r.prefs[1].to, ['Engineering/Backend/Lead']);
});

test('multi-target: bare name matching several areas creates one spring satisfied by any', () => {
  const r = parseInput(`
== PEOPLE ==
Alice
== STRUCTURE ==
Engineering
  Frontend
    Lead  size:1
  Backend
    Lead  size:1
== PREFERENCES ==
Alice strongly prefers Lead
`);
  ok(r.errors.length === 0, r.errors.join());
  eq(r.prefs.length, 1);
  eq(r.prefs[0].to.length, 2);
  ok(r.prefs[0].to.includes('Engineering/Frontend/Lead'));
  ok(r.prefs[0].to.includes('Engineering/Backend/Lead'));
  eq(r.prefs[0].toRef, 'Lead');
  // Solver should satisfy the spring regardless of which Lead Alice lands in
  const { assignment, happiness } = solveAssignments(r);
  const inALead = assignment['Alice'] === 'Engineering/Frontend/Lead'
               || assignment['Alice'] === 'Engineering/Backend/Lead';
  ok(inALead, `Alice should be in a Lead slot, got ${assignment['Alice']}`);
  ok(Math.abs(happiness['Alice'] - 1) < 0.01, `expected full happiness, got ${happiness['Alice']}`);
});

test('names with spaces work in PEOPLE and PREFERENCES', () => {
  const r = parseInput(`
== PEOPLE ==
David Larrea
Laia Escriba
== STRUCTURE ==
Engineering
  Frontend
  Backend
== PREFERENCES ==
David Larrea prefers Frontend
Laia Escriba avoids David Larrea
`);
  ok(r.errors.length === 0, r.errors.join());
  ok('David Larrea' in r.nodes);
  ok('Laia Escriba' in r.nodes);
  eq(r.prefs[0].from, 'David Larrea');
  eq(r.prefs[0].to, ['Engineering/Frontend']);
  eq(r.prefs[1].from, 'Laia Escriba');
  eq(r.prefs[1].to, ['David Larrea']);
  const { assignment } = solveAssignments(r);
  eq(assignment['David Larrea'], 'Engineering/Frontend');
  ok(assignment['Laia Escriba'] !== assignment['David Larrea'], 'Laia avoids David');
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
Charlie
Alice
Bob
`);
  eq(r.mobileNodes, ['Charlie', 'Alice', 'Bob']);
});

test('people not in PEOPLE section are not auto-created', () => {
  const r = parseInput(`
== PEOPLE ==
Alice
== STRUCTURE ==
Engineering
== PREFERENCES ==
Alice prefers Engineering
`);
  eq(r.mobileNodes, ['Alice']);
  eq(r.errors.length, 0, r.errors.join());
});

test('comments and blank lines are ignored', () => {
  const r = parseInput(`
# top comment

== PEOPLE ==
# just a name
Alice

== STRUCTURE ==
Engineering  # trailing comment
`);
  ok(r.errors.length === 0, r.errors.join());
  ok('Alice' in r.nodes);
  ok('Engineering' in r.nodes);
});

test('bad preference line produces an error', () => {
  const r = parseInput(`
== STRUCTURE ==
Engineering
== PREFERENCES ==
@Alice  Alice -> Frontend : +8
`);
  ok(r.errors.length > 0, 'expected parse error for old/unknown syntax');
  eq(r.prefs.length, 0);
});

// ── Solver ────────────────────────────────────────────────────────
console.log('\nSolver');

test('person assigned to highest-score area', () => {
  // Alice strongly prefers Frontend (+8) vs Alice prefers Backend (+6) — Frontend wins
  const r = parseInput(`
== PEOPLE ==
Alice
== STRUCTURE ==
Engineering
  Frontend  size:2-4
  Backend   size:2-4
== PREFERENCES ==
Alice strongly prefers Frontend
Alice prefers Backend
`);
  const { assignment } = solveAssignments(r);
  eq(assignment['Alice'], 'Engineering/Frontend');
});

test('avoidance spring satisfied when people are in different areas', () => {
  const r = parseInput(`
== PEOPLE ==
Carol
Dave
== STRUCTURE ==
Engineering
  Frontend  size:3
  Backend   size:3
== PREFERENCES ==
Carol avoids Dave
`);
  const { assignment, happiness } = solveAssignments(r);
  ok(assignment['Carol'] !== assignment['Dave'], 'Carol and Dave should be in different areas');
  ok(happiness['Carol'] >= 1, 'Carol should be happy');
});

test('co-location preference satisfied when people are in the same area', () => {
  const r = parseInput(`
== PEOPLE ==
Alice
Carol
== STRUCTURE ==
Engineering
  Frontend
  Backend
== PREFERENCES ==
Alice prefers Carol
`);
  const { assignment } = solveAssignments(r);
  eq(assignment['Alice'], assignment['Carol']);
});

test('parent area preference satisfied by any leaf under it', () => {
  const r = parseInput(`
== PEOPLE ==
Alice
== STRUCTURE ==
Engineering
  Frontend
== PREFERENCES ==
Alice strongly prefers Engineering
`);
  const { assignment, happiness } = solveAssignments(r);
  ok(assignment['Alice'] === 'Engineering/Frontend', 'should assign to leaf under Engineering');
  eq(happiness['Alice'], 1);
});

test('happiness is 1 for person with no preferences', () => {
  const r = parseInput(`
== PEOPLE ==
Alice
== STRUCTURE ==
Engineering
  Frontend
`);
  const { happiness } = solveAssignments(r);
  eq(happiness['Alice'], 1);
});

test('capacity limit is a hard maximum', () => {
  const r = parseInput(`
== PEOPLE ==
Alice
Bob
Carol
== STRUCTURE ==
Engineering
  Frontend  size:1
  Backend   size:3
== PREFERENCES ==
Alice strongly prefers Frontend
Bob strongly prefers Frontend
Carol strongly prefers Frontend
`);
  const { assignment } = solveAssignments(r);
  const inFrontend = Object.values(assignment).filter(a => a === 'Engineering/Frontend').length;
  ok(inFrontend <= 1, `Frontend has capacity 1, got ${inFrontend}`);
});

test('happiness is 0 when only preference is blocked by capacity', () => {
  const r = parseInput(`
== PEOPLE ==
Alice
== STRUCTURE ==
Engineering
  Frontend  size:0
  Backend
== PREFERENCES ==
Alice strongly prefers Frontend
`);
  const { assignment, happiness } = solveAssignments(r);
  eq(assignment['Alice'], 'Engineering/Backend');
  eq(happiness['Alice'], 0);
});

test('complex scenario: multiple people, mixed preferences', () => {
  const r = parseInput(`
== PEOPLE ==
Alice
Bob
Carol
Dave
== STRUCTURE ==
Engineering
  Frontend  size:2-3
  Backend   size:2-3
== PREFERENCES ==
Alice strongly prefers Frontend
Bob strongly prefers Backend
Carol requires Frontend
Dave avoids Carol
`);
  const { assignment, happiness } = solveAssignments(r);
  eq(assignment['Alice'], 'Engineering/Frontend');
  eq(assignment['Bob'],   'Engineering/Backend');
  eq(assignment['Carol'], 'Engineering/Frontend');
  ok(assignment['Dave'] === 'Engineering/Backend', 'Dave avoids Carol (Frontend)');
  ok(happiness['Dave'] >= 1, 'Dave happy with Carol in a different area');
});

test('swap step rescues greedy mistake — wrong person in capacity-1 area', () => {
  // Alice weakly prefers Frontend (6); Bob strongly prefers Frontend (8).
  // Greedy (PEOPLE order: Alice first) puts Alice in Frontend.
  // Swap step swaps Alice↔Bob → Bob gets Frontend (score 8 > 6).
  const r = parseInput(`
== PEOPLE ==
Alice
Bob
== STRUCTURE ==
Engineering
  Frontend  size:1
  Backend   size:1
== PREFERENCES ==
Alice prefers Frontend
Bob strongly prefers Frontend
`);
  const { assignment } = solveAssignments(r);
  eq(assignment['Bob'], 'Engineering/Frontend', 'Bob should win the capacity-1 Frontend slot');
  eq(assignment['Alice'], 'Engineering/Backend');
});

test('avoidance area spring is satisfied when person is elsewhere', () => {
  const r = parseInput(`
== PEOPLE ==
Bob
== STRUCTURE ==
Engineering
  Frontend
  Backend
== PREFERENCES ==
Bob strongly avoids Backend
`);
  const { assignment, happiness } = solveAssignments(r);
  eq(assignment['Bob'], 'Engineering/Frontend', 'solver should place Bob away from Backend');
  eq(happiness['Bob'], 1);
});

test('avoidance area spring is unsatisfied when person is in that area', () => {
  const r = parseInput(`
== PEOPLE ==
Bob
== STRUCTURE ==
Engineering
  Frontend  size:0
  Backend
== PREFERENCES ==
Bob strongly avoids Backend
`);
  const { assignment, happiness } = solveAssignments(r);
  eq(assignment['Bob'], 'Engineering/Backend');
  eq(happiness['Bob'], 0);
});

test('computeHappiness reflects manual override', () => {
  const r = parseInput(`
== PEOPLE ==
Alice
== STRUCTURE ==
Engineering
  Frontend
  Backend
== PREFERENCES ==
Alice strongly prefers Frontend
`);
  const { assignment } = solveAssignments(r);
  eq(assignment['Alice'], 'Engineering/Frontend');

  assignment['Alice'] = 'Engineering/Backend';
  const hap = computeHappiness(r, assignment);
  eq(hap['Alice'], 0);
});

test('pinned person stays put; free people re-optimize around them', () => {
  const r = parseInput(`
== PEOPLE ==
Alice
Bob
== STRUCTURE ==
Engineering
  Frontend  size:1
  Backend   size:1
== PREFERENCES ==
Alice requires Frontend
Bob requires Frontend
`);
  const pins = { Bob: 'Engineering/Backend' };
  const { assignment } = solveAssignments(r, pins);
  eq(assignment['Bob'], 'Engineering/Backend', 'pinned person must not move');
  eq(assignment['Alice'], 'Engineering/Frontend', 'free person should take best remaining spot');
});

test('pinned occupancy counts toward capacity; free people cannot overflow', () => {
  // Frontend size:1 has Carol pinned there. Alice also prefers Frontend but cannot go.
  const r = parseInput(`
== PEOPLE ==
Alice
Carol
== STRUCTURE ==
Engineering
  Frontend  size:1
  Backend
== PREFERENCES ==
Alice requires Frontend
`);
  const pins = { Carol: 'Engineering/Frontend' };
  const { assignment } = solveAssignments(r, pins);
  eq(assignment['Carol'], 'Engineering/Frontend', 'pinned person stays');
  eq(assignment['Alice'], 'Engineering/Backend', 'free person blocked by pinned capacity');
});

test('requires beats strongly prefers for a capacity-1 slot', () => {
  const r = parseInput(`
== PEOPLE ==
Alice
Bob
== STRUCTURE ==
Engineering
  Lead    size:1
  General
== PREFERENCES ==
Alice requires Lead
Bob strongly prefers Lead
`);
  const { assignment } = solveAssignments(r);
  eq(assignment['Alice'], 'Engineering/Lead', 'requires (100) must beat strongly prefers (8)');
  eq(assignment['Bob'], 'Engineering/General');
});

test('no preferences — everyone gets a valid assignment', () => {
  // With no preferences all assignments are equally happy (score 0 each),
  // so the solver makes no promise about spread — just that everyone is placed.
  const r = parseInput(`
== PEOPLE ==
Alice
Bob
Carol
Dave
== STRUCTURE ==
Engineering
  Frontend
  Backend
`);
  const { assignment, happiness } = solveAssignments(r);
  const areas = new Set(['Engineering/Frontend', 'Engineering/Backend']);
  ok(r.mobileNodes.every(p => areas.has(assignment[p])), 'everyone has a valid area');
  ok(r.mobileNodes.every(p => happiness[p] === 1), 'everyone with no prefs is fully happy');
});

test('fill minimums before preferences', () => {
  // Alice and Bob both prefer Frontend, but Backend min:2 must be filled first.
  const r = parseInput(`
== PEOPLE ==
Alice
Bob
Carol
Dave
== STRUCTURE ==
Engineering
  Frontend  size:1-2
  Backend   size:2-3
== PREFERENCES ==
Alice strongly prefers Frontend
Bob strongly prefers Frontend
`);
  const { assignment } = solveAssignments(r);
  const inBackend = Object.values(assignment).filter(a => a === 'Engineering/Backend').length;
  ok(inBackend >= 2, `Backend minimum not met: ${inBackend} people`);
});

test('co-location closeness: partial when people are in adjacent areas', () => {
  const r = parseInput(`
== PEOPLE ==
Alice
Bob
== STRUCTURE ==
Engineering
  Frontend  size:2-4
    Lead    size:1
  Backend
== PREFERENCES ==
Alice prefers Bob
`);
  const pins = { Bob: 'Engineering/Frontend/Lead' };
  const { assignment, happiness } = solveAssignments(r, pins);
  eq(assignment['Bob'], 'Engineering/Frontend/Lead', 'Bob stays pinned');
  eq(assignment['Alice'], 'Engineering/Frontend', 'Alice prefers Frontend subtree to be close to Bob');
  ok(Math.abs(happiness['Alice'] - 0.5) < 0.01, `expected happiness ≈ 0.5, got ${happiness['Alice']}`);
});

test('co-location closeness: solver prefers adjacent area over distant area', () => {
  const r = parseInput(`
== PEOPLE ==
Alice
Bob
== STRUCTURE ==
Engineering
  Frontend  size:2-4
    Lead    size:1
  Backend
== PREFERENCES ==
Alice prefers Bob
`);
  const pins = { Bob: 'Engineering/Frontend/Lead' };
  const { assignment } = solveAssignments(r, pins);
  eq(assignment['Alice'], 'Engineering/Frontend', 'LCA pull prefers Frontend over Backend');
});

test('people can be assigned directly to non-leaf area with explicit capacity', () => {
  const r = parseInput(`
== PEOPLE ==
Alice
Bob
Carol
== STRUCTURE ==
Engineering
  Frontend  size:2-4
    Lead    size:1
== PREFERENCES ==
Alice strongly prefers Lead
`);
  ok(r.errors.length === 0, r.errors.join());
  const { assignment } = solveAssignments(r);
  eq(assignment['Alice'], 'Engineering/Frontend/Lead');
  const totalInFrontend = Object.values(assignment).filter(a =>
    a === 'Engineering/Frontend' || a === 'Engineering/Frontend/Lead'
  ).length;
  eq(totalInFrontend, 3, 'all 3 people should end up under Engineering/Frontend');
});

console.log('');
if (failed === 0) { console.log(`All ${passed} tests passed.\n`); process.exit(0); }
else { console.log(`${passed} passed, ${failed} failed.\n`); process.exit(1); }
