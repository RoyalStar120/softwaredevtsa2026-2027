/**
 * Electrical scenario templates. Each template defines a circuit (topology + drawing),
 * a pool of faults (each emphasizing different skills), initial conditions and a story.
 * The generator picks faults from the pool based on difficulty and the adaptive engine's
 * requested focus skills, so the same template yields many different scenarios.
 */

import type { CircuitComp, ElecTemplateDef, StoryContext } from './types.ts';

const COMMON_CONSTRAINTS = [
  'Treat the circuit as live until you have isolated it at the disconnect and verified 0 V.',
  'Every replacement part costs money. Replace only what your evidence supports.',
  'Record your diagnosis (failed part + failure mode) before completing the work order.',
];

function battery(a: string, b: string, pts: Array<[number, number]>): CircuitComp {
  return { id: 'B1', kind: 'battery', label: 'Battery B1', spec: '12 V', a, b, r: 0.05, v: 12, cost: 120, replaceable: true, pts };
}
function disconnect(a: string, b: string, pts: Array<[number, number]>, label = 'Main disconnect QS'): CircuitComp {
  return { id: 'QS', kind: 'disconnect', label, spec: 'Lockable isolation point', a, b, r: 0.005, cost: 0, replaceable: false, control: 'power', pts };
}
function wire(id: string, label: string, a: string, b: string, pts: Array<[number, number]>, groundEnd = false): CircuitComp {
  return { id, kind: 'wire', label, spec: groundEnd ? 'Return to chassis ground' : '16 AWG', a, b, r: 0.03, cost: 5, replaceable: true, pts, groundEnd };
}

function quote(symptom: string): string {
  return symptom.charAt(0).toUpperCase() + symptom.slice(1);
}

// ---------------------------------------------------------------------------
// E1 - Porch light (series circuit)
// ---------------------------------------------------------------------------

const porch: ElecTemplateDef = {
  template: {
    id: 'elec.porch-light',
    moduleId: 'electrical',
    title: 'Porch Light Out',
    summary: 'A single-lamp series circuit with one hidden fault. A classic starting point for voltage testing and safe repair.',
    difficultyRange: [1, 3],
    skillWeights: {
      'elec.safety': 0.6,
      'elec.schematic': 0.5,
      'elec.voltage': 0.8,
      'elec.resistance': 0.4,
      'elec.isolation': 0.6,
      'elec.repair': 0.6,
    },
    focusable: ['elec.voltage', 'elec.resistance', 'elec.isolation', 'elec.schematic', 'elec.repair'],
    prerequisites: [],
    estimatedMinutes: 6,
    tags: ['series circuit', 'open circuit', 'voltage drop'],
    variantCount: 9,
  },
  circuit: {
    width: 800,
    height: 420,
    ground: 'N0',
    nodes: [
      { id: 'N0', label: 'GND', x: 100, y: 340 },
      { id: 'N1', label: 'TP1', x: 100, y: 90 },
      { id: 'N2', label: 'TP2', x: 260, y: 90 },
      { id: 'N3', label: 'TP3', x: 420, y: 90 },
      { id: 'N4', label: 'TP4', x: 580, y: 90 },
      { id: 'N5', label: 'TP5', x: 700, y: 90 },
      { id: 'N6', label: 'TP6', x: 700, y: 205 },
      { id: 'N7', label: 'TP7', x: 700, y: 320 },
    ],
    comps: [
      battery('N0', 'N1', [[100, 340], [100, 90]]),
      disconnect('N1', 'N2', [[100, 90], [260, 90]]),
      { id: 'F1', kind: 'fuse', label: 'Fuse F1', spec: '5 A', a: 'N2', b: 'N3', r: 0.02, rating: 5, cost: 2, replaceable: true, pts: [[260, 90], [420, 90]] },
      { id: 'S1', kind: 'switch', label: 'Switch S1', spec: 'Wall switch', a: 'N3', b: 'N4', r: 0.01, cost: 12, replaceable: true, control: 'switch', pts: [[420, 90], [580, 90]], friendly: 'wall switch' },
      wire('W1', 'Feed wire W1', 'N4', 'N5', [[580, 90], [700, 90]]),
      { id: 'X1', kind: 'connector', label: 'Connector X1', spec: '2-pin lamp connector', a: 'N5', b: 'N6', r: 0.01, cost: 3, replaceable: true, pts: [[700, 90], [700, 205]] },
      { id: 'L1', kind: 'lamp', label: 'Lamp L1', spec: '12 V 10 W', a: 'N6', b: 'N7', r: 14.4, rating: 10, cost: 6, replaceable: true, pts: [[700, 205], [700, 320]], friendly: 'porch light' },
      wire('W2', 'Ground wire W2', 'N7', 'N0', [[700, 320], [700, 385]], true),
    ],
    hidden: [],
  },
  faults: [
    {
      id: 'e1-f1-blown', target: 'F1', comp: 'F1', type: 'open', title: 'Blown fuse F1',
      detail: 'Fuse F1 is open, so no current reaches the switch or lamp. With power on, the full 12 V appears across F1 (TP2 → TP3).',
      clue: 'The fuse glass is darkened and the thin element inside is broken.', clueMaxDifficulty: 2,
      emphasis: { 'elec.voltage': 0.8, 'elec.isolation': 0.6, 'elec.repair': 0.5 }, minDifficulty: 1, maxDifficulty: 3,
    },
    {
      id: 'e1-s1-open', target: 'S1', comp: 'S1', type: 'open', title: 'Switch S1 failed open',
      detail: 'The contacts inside S1 are burned and stay open even when the switch is ON. The full supply voltage appears across the switch (TP3 → TP4).',
      emphasis: { 'elec.voltage': 0.9, 'elec.isolation': 0.7 }, minDifficulty: 1, maxDifficulty: 3,
    },
    {
      id: 'e1-l1-open', target: 'L1', comp: 'L1', type: 'open', title: 'Burned-out lamp L1',
      detail: 'The filament in L1 is broken. Voltage reaches the lamp (about 12 V across TP6 → TP7) but no current flows.',
      clue: 'Through the glass, the lamp filament is visibly snapped.', clueMaxDifficulty: 2,
      emphasis: { 'elec.voltage': 0.6, 'elec.resistance': 0.8, 'elec.repair': 0.6 }, minDifficulty: 1, maxDifficulty: 3,
    },
    {
      id: 'e1-x1-loose', target: 'X1', comp: 'X1', type: 'open', title: 'Unseated connector X1',
      detail: 'Connector X1 is not latched, so the circuit is open at the connector.',
      clue: 'One half of connector X1 has backed out of its latch.', clueMaxDifficulty: 1,
      emphasis: { 'elec.voltage': 0.7, 'elec.schematic': 0.6 }, minDifficulty: 1, maxDifficulty: 2,
    },
    {
      id: 'e1-x1-corroded', target: 'X1', comp: 'X1', type: 'high_resistance', value: 18, title: 'Corroded connector X1',
      detail: 'Corrosion adds about 18 Ω at X1, so the lamp gets only part of the supply and glows dimly. The large voltage drop across X1 (TP5 → TP6) gives it away.',
      clue: 'Green-white corrosion is crusted on the connector pins.', clueMaxDifficulty: 2,
      emphasis: { 'elec.voltage': 1, 'elec.isolation': 0.6 }, minDifficulty: 1, maxDifficulty: 3,
    },
    {
      id: 'e1-w1-open', target: 'W1', comp: 'W1', type: 'open', title: 'Broken feed wire W1',
      detail: 'W1 has an internal break hidden by intact insulation. Only measurement can find it: the full supply appears across W1 (TP4 → TP5).',
      emphasis: { 'elec.voltage': 0.9, 'elec.isolation': 0.9 }, minDifficulty: 2, maxDifficulty: 3,
    },
    {
      id: 'e1-w2-open', target: 'W2', comp: 'W2', type: 'open', title: 'Broken ground wire W2',
      detail: 'The lamp\'s return path to chassis is open. Measured to GND, TP7 floats up to the full supply voltage because no current flows.',
      emphasis: { 'elec.voltage': 0.9, 'elec.isolation': 0.8, 'elec.schematic': 0.8 }, minDifficulty: 2, maxDifficulty: 3,
    },
    {
      id: 'e1-b1-weak', target: 'B1', comp: 'B1', type: 'weak', value: 9, internalR: 1.2, title: 'Weak battery B1',
      detail: 'B1 only supplies about 9 V and sags further under load, so the lamp is dim. Checking the source first catches this immediately.',
      emphasis: { 'elec.voltage': 0.8, 'elec.isolation': 0.5, 'elec.schematic': 0.4 }, minDifficulty: 2, maxDifficulty: 3,
    },
    {
      id: 'e1-s1-pitted', target: 'S1', comp: 'S1', type: 'high_resistance', value: 10, title: 'Pitted contacts in S1',
      detail: 'Burned, pitted contacts inside S1 add about 10 Ω, causing a large voltage drop across the switch and a dim lamp.',
      emphasis: { 'elec.voltage': 1, 'elec.isolation': 0.7 }, minDifficulty: 3, maxDifficulty: 3,
    },
  ],
  initial: { controls: { power: true, lockout: false, switches: { S1: true }, plugged: {} }, blown: [] },
  operating: { switches: { S1: true } },
  allowDouble: false,
  acceptableExtras: [],
  story: (ctx: StoryContext) => {
    const dim = /dim/.test(ctx.symptom);
    return {
      title: dim ? 'Dim Porch Light' : 'Porch Light Out',
      briefing: `Work order #${ctx.workOrder}. ${ctx.customer} reports: "${quote(ctx.symptom)}." The porch light circuit runs from a 12 V battery through the main disconnect QS, fuse F1 and wall switch S1 to lamp L1, which returns to chassis ground. Power is ON and S1 is ON.`,
      goal: 'Find the fault, repair it, record your diagnosis, and verify that the porch light works.',
      constraints: COMMON_CONSTRAINTS,
      objectives: [
        'Confirm the symptom and the supply voltage',
        'Use voltage readings to locate the open or high-resistance point',
        'Isolate, lock out and verify zero energy before contact work',
        'Repair only the faulty part and verify the repair',
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// E2 - Workshop lights (parallel branches)
// ---------------------------------------------------------------------------

const workshop: ElecTemplateDef = {
  template: {
    id: 'elec.workshop-lights',
    moduleId: 'electrical',
    title: 'Workshop Lights',
    summary: 'Two lamp branches share a feed. Use the symptom pattern to decide which section to test, then pin down the fault.',
    difficultyRange: [2, 5],
    skillWeights: {
      'elec.safety': 0.5,
      'elec.schematic': 0.8,
      'elec.voltage': 0.9,
      'elec.resistance': 0.5,
      'elec.isolation': 0.8,
      'elec.repair': 0.5,
    },
    focusable: ['elec.voltage', 'elec.schematic', 'elec.isolation', 'elec.resistance'],
    prerequisites: ['elec.voltage'],
    estimatedMinutes: 8,
    tags: ['parallel circuit', 'shared feed', 'voltage drop'],
    variantCount: 11,
  },
  circuit: {
    width: 800,
    height: 420,
    ground: 'N0',
    nodes: [
      { id: 'N0', label: 'GND', x: 100, y: 350 },
      { id: 'N1', label: 'TP1', x: 100, y: 80 },
      { id: 'N2', label: 'TP2', x: 240, y: 80 },
      { id: 'N3', label: 'TP3', x: 380, y: 80 },
      { id: 'N4', label: 'TP4', x: 520, y: 80 },
      { id: 'N5', label: 'TP5', x: 520, y: 200 },
      { id: 'N8', label: 'TP6', x: 520, y: 310 },
      { id: 'N6', label: 'TP7', x: 700, y: 80 },
      { id: 'N7', label: 'TP8', x: 700, y: 200 },
      { id: 'N9', label: 'TP9', x: 700, y: 310 },
    ],
    comps: [
      battery('N0', 'N1', [[100, 350], [100, 80]]),
      disconnect('N1', 'N2', [[100, 80], [240, 80]]),
      { id: 'F1', kind: 'fuse', label: 'Fuse F1', spec: '10 A', a: 'N2', b: 'N3', r: 0.02, rating: 10, cost: 2, replaceable: true, pts: [[240, 80], [380, 80]] },
      { id: 'S1', kind: 'switch', label: 'Switch S1', spec: 'Wall switch', a: 'N3', b: 'N4', r: 0.01, cost: 12, replaceable: true, control: 'switch', pts: [[380, 80], [520, 80]] },
      { id: 'X1', kind: 'connector', label: 'Connector X1', spec: 'Left light connector', a: 'N4', b: 'N5', r: 0.01, cost: 3, replaceable: true, pts: [[520, 80], [520, 200]] },
      { id: 'L1', kind: 'lamp', label: 'Lamp L1', spec: '12 V 10 W (left)', a: 'N5', b: 'N8', r: 14.4, rating: 10, cost: 6, replaceable: true, pts: [[520, 200], [520, 310]], friendly: 'left bench light' },
      wire('W2', 'Ground wire W2', 'N8', 'N0', [[520, 310], [520, 375]], true),
      wire('W1', 'Branch feed W1', 'N4', 'N6', [[520, 80], [700, 80]]),
      { id: 'X2', kind: 'connector', label: 'Connector X2', spec: 'Right light connector', a: 'N6', b: 'N7', r: 0.01, cost: 3, replaceable: true, pts: [[700, 80], [700, 200]] },
      { id: 'L2', kind: 'lamp', label: 'Lamp L2', spec: '12 V 10 W (right)', a: 'N7', b: 'N9', r: 14.4, rating: 10, cost: 6, replaceable: true, pts: [[700, 200], [700, 310]], friendly: 'right bench light' },
      wire('W3', 'Ground wire W3', 'N9', 'N0', [[700, 310], [700, 375]], true),
    ],
    hidden: [],
  },
  faults: [
    {
      id: 'e2-f1-blown', target: 'F1', comp: 'F1', type: 'open', title: 'Blown fuse F1',
      detail: 'F1 is open, so neither branch gets power. Both lamps are out, which points to the shared feed.',
      clue: 'The fuse glass is darkened and the element is broken.', clueMaxDifficulty: 2,
      emphasis: { 'elec.voltage': 0.7, 'elec.isolation': 0.7, 'elec.schematic': 0.7 }, minDifficulty: 2, maxDifficulty: 5,
    },
    {
      id: 'e2-s1-open', target: 'S1', comp: 'S1', type: 'open', title: 'Switch S1 failed open',
      detail: 'S1 never closes, so both branches are dead. Voltage is present on TP3 but not on TP4.',
      emphasis: { 'elec.voltage': 0.8, 'elec.isolation': 0.7 }, minDifficulty: 2, maxDifficulty: 5,
    },
    {
      id: 'e2-x1-open', target: 'X1', comp: 'X1', type: 'open', title: 'Unseated connector X1',
      detail: 'Connector X1 has come apart, so only the left branch is dead.',
      clue: 'The latch on X1 is broken and the connector halves are hanging apart.', clueMaxDifficulty: 2,
      emphasis: { 'elec.schematic': 0.8, 'elec.voltage': 0.7 }, minDifficulty: 2, maxDifficulty: 4,
    },
    {
      id: 'e2-l1-open', target: 'L1', comp: 'L1', type: 'open', title: 'Burned-out lamp L1',
      detail: 'L1\'s filament is broken. TP5 still shows full voltage to GND, but no current flows through the left branch.',
      clue: 'Through the glass, the filament of L1 is visibly snapped.', clueMaxDifficulty: 2,
      emphasis: { 'elec.resistance': 0.7, 'elec.voltage': 0.6, 'elec.schematic': 0.6 }, minDifficulty: 2, maxDifficulty: 5,
    },
    {
      id: 'e2-w2-open', target: 'W2', comp: 'W2', type: 'open', title: 'Broken ground wire W2',
      detail: 'The left branch has lost its return to chassis. TP6 floats up to supply voltage when measured to GND.',
      emphasis: { 'elec.voltage': 0.9, 'elec.isolation': 0.8, 'elec.schematic': 0.8 }, minDifficulty: 3, maxDifficulty: 5,
    },
    {
      id: 'e2-w1-open', target: 'W1', comp: 'W1', type: 'open', title: 'Broken branch feed W1',
      detail: 'W1, the feed to the right branch, has an internal break. TP4 has voltage but TP7 does not.',
      emphasis: { 'elec.voltage': 0.9, 'elec.isolation': 0.9 }, minDifficulty: 3, maxDifficulty: 5,
    },
    {
      id: 'e2-x2-corroded', target: 'X2', comp: 'X2', type: 'high_resistance', value: 15, title: 'Corroded connector X2',
      detail: 'Corrosion adds about 15 Ω at X2, so L2 is dim. With the lights on, X2 drops several volts (TP7 → TP8).',
      clue: 'X2\'s pins are crusted with green corrosion.', clueMaxDifficulty: 2,
      emphasis: { 'elec.voltage': 1, 'elec.isolation': 0.7 }, minDifficulty: 2, maxDifficulty: 5,
    },
    {
      id: 'e2-l2-open', target: 'L2', comp: 'L2', type: 'open', title: 'Burned-out lamp L2',
      detail: 'L2\'s filament is broken. The right branch has voltage up to the lamp but no current.',
      clue: 'The filament of L2 is visibly broken.', clueMaxDifficulty: 2,
      emphasis: { 'elec.resistance': 0.7, 'elec.voltage': 0.6 }, minDifficulty: 2, maxDifficulty: 5,
    },
    {
      id: 'e2-w3-corroded', target: 'W3', comp: 'W3', type: 'high_resistance', value: 12, title: 'Corroded ground terminal on W3',
      detail: 'W3\'s ring terminal is corroded where it bolts to the chassis, adding about 12 Ω on the ground side. L2 is dim, and TP9 reads several volts to GND when it should be near 0 V.',
      clue: 'The ring terminal on W3 is rusty where it bolts to the chassis.', clueMaxDifficulty: 3,
      emphasis: { 'elec.voltage': 1, 'elec.isolation': 0.8, 'elec.schematic': 0.7 }, minDifficulty: 3, maxDifficulty: 5,
    },
    {
      id: 'e2-b1-weak', target: 'B1', comp: 'B1', type: 'weak', value: 9, internalR: 1.2, title: 'Weak battery B1',
      detail: 'B1 sags to about 7 V with both lights on, so both are dim. The problem is the source, not the wiring.',
      emphasis: { 'elec.voltage': 0.8, 'elec.schematic': 0.5 }, minDifficulty: 3, maxDifficulty: 5,
    },
    {
      id: 'e2-s1-pitted', target: 'S1', comp: 'S1', type: 'high_resistance', value: 6, title: 'Pitted contacts in S1',
      detail: 'Pitted contacts add about 6 Ω in the shared feed. Both lamps are dim, and S1 drops several volts (TP3 → TP4).',
      emphasis: { 'elec.voltage': 1, 'elec.isolation': 0.7 }, minDifficulty: 4, maxDifficulty: 5,
    },
  ],
  initial: { controls: { power: true, lockout: false, switches: { S1: true }, plugged: {} }, blown: [] },
  operating: { switches: { S1: true } },
  allowDouble: true,
  acceptableExtras: [],
  story: (ctx: StoryContext) => ({
    title: 'Workshop Lights',
    briefing: `Work order #${ctx.workOrder}. The shop foreman, ${ctx.customer}, reports: "${quote(ctx.symptom)}." Two bench lights (L1 left, L2 right) share battery B1, the main disconnect QS, fuse F1 and switch S1. Each light has its own connector and ground wire. Power is ON and S1 is ON.${
      ctx.difficulty >= 5 ? ' A previous technician worked on this circuit, so there may be more than one problem.' : ''
    }`,
    goal: 'Restore both lights to full brightness, record your diagnosis, and verify the repair.',
    constraints: COMMON_CONSTRAINTS,
    objectives: [
      'Use the symptom pattern (which lights are affected) to narrow the search',
      'Locate opens and voltage drops with live voltage readings',
      'Remember that parallel paths affect in-circuit resistance readings',
      'Repair only what the evidence supports and verify both lights',
    ],
  }),
};

// ---------------------------------------------------------------------------
// E3 - Fuse keeps blowing (short circuit hunt)
// ---------------------------------------------------------------------------

const shortHunt: ElecTemplateDef = {
  template: {
    id: 'elec.tripping-fuse',
    moduleId: 'electrical',
    title: 'Fuse Keeps Blowing',
    summary: 'Someone keeps replacing a fuse that blows instantly. Find the short circuit with safe resistance testing before you install anything.',
    difficultyRange: [2, 5],
    skillWeights: {
      'elec.safety': 0.9,
      'elec.schematic': 0.6,
      'elec.voltage': 0.2,
      'elec.resistance': 0.9,
      'elec.isolation': 0.7,
      'elec.repair': 0.6,
    },
    focusable: ['elec.resistance', 'elec.safety', 'elec.isolation', 'elec.repair'],
    prerequisites: [],
    estimatedMinutes: 8,
    tags: ['short circuit', 'resistance testing', 'lockout'],
    variantCount: 3,
  },
  circuit: {
    width: 800,
    height: 420,
    ground: 'N0',
    nodes: [
      { id: 'N0', label: 'GND', x: 100, y: 350 },
      { id: 'N1', label: 'TP1', x: 100, y: 80 },
      { id: 'N2', label: 'TP2', x: 240, y: 80 },
      { id: 'N3', label: 'TP3', x: 380, y: 80 },
      { id: 'N4', label: 'TP4', x: 520, y: 80 },
      { id: 'N5', label: 'TP5', x: 520, y: 200 },
      { id: 'N8', label: 'TP6', x: 520, y: 310 },
      { id: 'N6', label: 'TP7', x: 700, y: 80 },
      { id: 'N7', label: 'TP8', x: 700, y: 200 },
      { id: 'N9', label: 'TP9', x: 700, y: 310 },
    ],
    comps: [
      battery('N0', 'N1', [[100, 350], [100, 80]]),
      disconnect('N1', 'N2', [[100, 80], [240, 80]]),
      { id: 'F1', kind: 'fuse', label: 'Fuse F1', spec: '5 A', a: 'N2', b: 'N3', r: 0.02, rating: 5, cost: 2, replaceable: true, pts: [[240, 80], [380, 80]] },
      { id: 'S1', kind: 'switch', label: 'Switch S1', spec: 'Circuit switch', a: 'N3', b: 'N4', r: 0.01, cost: 12, replaceable: true, control: 'switch', pts: [[380, 80], [520, 80]] },
      { id: 'X1', kind: 'connector', label: 'Lamp connector X1', spec: 'Unpluggable', a: 'N4', b: 'N5', r: 0.01, cost: 3, replaceable: true, control: 'plug', pts: [[520, 80], [520, 200]] },
      { id: 'L1', kind: 'lamp', label: 'Lamp L1', spec: '12 V 10 W', a: 'N5', b: 'N8', r: 14.4, rating: 10, cost: 6, replaceable: true, pts: [[520, 200], [520, 310]], friendly: 'work light' },
      wire('W2', 'Ground wire W2', 'N8', 'N0', [[520, 310], [520, 375]], true),
      wire('W1', 'Fan feed W1', 'N4', 'N6', [[520, 80], [700, 80]]),
      { id: 'X2', kind: 'connector', label: 'Fan connector X2', spec: 'Unpluggable', a: 'N6', b: 'N7', r: 0.01, cost: 3, replaceable: true, control: 'plug', pts: [[700, 80], [700, 200]] },
      { id: 'M1', kind: 'motor', label: 'Fan motor M1', spec: '12 V 18 W', a: 'N7', b: 'N9', r: 8, rating: 18, cost: 65, replaceable: true, pts: [[700, 200], [700, 310]], friendly: 'shop fan' },
      wire('W3', 'Ground wire W3', 'N9', 'N0', [[700, 310], [700, 375]], true),
    ],
    hidden: [
      { id: 'SH_W1', a: 'N6', b: 'N0' },
      { id: 'SH_L1', a: 'N5', b: 'N8' },
    ],
  },
  faults: [
    {
      id: 'e3-m1-shorted', target: 'M1', comp: 'M1', type: 'short', value: 0.3, title: 'Shorted fan motor M1',
      detail: 'M1\'s winding insulation has failed. It measures about 0.3 Ω instead of 8 Ω, draws about 40 A, and blows F1 whenever S1 is switched on.',
      clue: 'There is a burnt-varnish smell coming from the fan motor.', clueMaxDifficulty: 2,
      emphasis: { 'elec.resistance': 1, 'elec.isolation': 0.8, 'elec.safety': 0.7 }, minDifficulty: 2, maxDifficulty: 5,
    },
    {
      id: 'e3-w1-chafed', target: 'SH_W1', comp: 'W1', type: 'short', value: 0.05, title: 'Fan feed W1 chafed to chassis',
      detail: 'W1\'s insulation rubbed through on a metal bracket, shorting the fan feed directly to ground (TP7 → GND reads near 0 Ω even with X2 unplugged).',
      clue: 'W1\'s insulation is worn through where it passes a sharp bracket, and bare copper is showing.', clueMaxDifficulty: 3,
      emphasis: { 'elec.resistance': 0.9, 'elec.isolation': 0.9, 'elec.schematic': 0.7 }, minDifficulty: 2, maxDifficulty: 5,
    },
    {
      id: 'e3-l1-socket', target: 'SH_L1', comp: 'L1', type: 'short', value: 0.05, title: 'Shorted lamp socket L1',
      detail: 'The center contact of L1\'s socket is bent against the shell, shorting the lamp branch to ground. The short disappears when X1 is unplugged.',
      clue: 'L1\'s socket has a scorched, bent center contact.', clueMaxDifficulty: 2,
      emphasis: { 'elec.resistance': 0.9, 'elec.isolation': 0.8 }, minDifficulty: 2, maxDifficulty: 5,
    },
  ],
  initial: { controls: { power: true, lockout: false, switches: { S1: true }, plugged: { X1: true, X2: true } }, blown: ['F1'] },
  operating: { switches: { S1: true } },
  allowDouble: false,
  acceptableExtras: ['F1:open'],
  story: (ctx: StoryContext) => ({
    title: 'Fuse Keeps Blowing',
    briefing: `Work order #${ctx.workOrder}. ${ctx.customer} says: "The shop circuit's fuse keeps blowing. I've replaced F1 twice and it pops the moment I flip S1 on." F1 is blown right now, so nothing works. The circuit feeds work light L1 and fan M1. Connectors X1 (lamp) and X2 (fan) can be unplugged to isolate each branch. Power is ON.`,
    goal: 'Find what is blowing the fuse, repair it, replace the fuse, and verify both loads work.',
    constraints: [...COMMON_CONSTRAINTS, 'Do not install a new fuse until you have found the cause. Fuses cost money and repeated shorts damage wiring.'],
    objectives: [
      'Recognize that a fuse blowing instantly means a short circuit',
      'Isolate, lock out and verify zero energy before resistance testing',
      'Use resistance-to-ground readings and unplug branches to locate the short',
      'Repair the cause, then replace the fuse and verify operation',
    ],
  }),
};

// ---------------------------------------------------------------------------
// E4 - Cooling fan relay (control vs load circuits)
// ---------------------------------------------------------------------------

const fanRelay: ElecTemplateDef = {
  template: {
    id: 'elec.fan-relay',
    moduleId: 'electrical',
    title: "Cooling Fan Won't Start",
    summary: 'A relay-controlled radiator fan with separate control and load circuits. Reproduce the condition, then work out which circuit has the problem.',
    difficultyRange: [3, 5],
    skillWeights: {
      'elec.safety': 0.5,
      'elec.schematic': 0.9,
      'elec.voltage': 0.8,
      'elec.resistance': 0.5,
      'elec.isolation': 0.9,
      'elec.repair': 0.6,
    },
    focusable: ['elec.voltage', 'elec.isolation', 'elec.schematic', 'elec.resistance'],
    prerequisites: ['elec.voltage', 'elec.isolation'],
    estimatedMinutes: 10,
    tags: ['relay', 'control circuit', 'integration'],
    variantCount: 12,
  },
  circuit: {
    width: 800,
    height: 420,
    ground: 'N0',
    nodes: [
      { id: 'N0', label: 'GND', x: 90, y: 360 },
      { id: 'N1', label: 'TP1', x: 90, y: 70 },
      { id: 'N2', label: 'TP2', x: 220, y: 70 },
      { id: 'N3', label: 'TP3', x: 360, y: 70 },
      { id: 'N4', label: 'TP4', x: 500, y: 70 },
      { id: 'N5', label: 'TP5', x: 640, y: 70 },
      { id: 'N6', label: 'TP6', x: 640, y: 175 },
      { id: 'N7', label: 'TP7', x: 220, y: 280 },
      { id: 'N8', label: 'TP8', x: 420, y: 280 },
      { id: 'N9', label: 'TP9', x: 560, y: 280 },
      { id: 'N10', label: 'TP10', x: 700, y: 280 },
    ],
    comps: [
      battery('N0', 'N1', [[90, 360], [90, 70]]),
      disconnect('N1', 'N2', [[90, 70], [220, 70]], 'Battery disconnect QS'),
      { id: 'F1', kind: 'fuse', label: 'Control fuse F1', spec: '2 A', a: 'N2', b: 'N3', r: 0.05, rating: 2, cost: 2, replaceable: true, pts: [[220, 70], [360, 70]] },
      { id: 'TS', kind: 'thermostat', label: 'Thermostat switch TS', spec: 'Closes when engine is hot', a: 'N3', b: 'N4', r: 0.02, cost: 25, replaceable: true, control: 'thermostat', pts: [[360, 70], [500, 70]] },
      wire('W1', 'Relay feed W1', 'N4', 'N5', [[500, 70], [640, 70]]),
      { id: 'K1', kind: 'relay_coil', label: 'Relay K1 coil', spec: '80 Ω coil', a: 'N5', b: 'N6', r: 80, pullIn: 7.5, dropOut: 3, unit: 'K1', cost: 18, replaceable: true, pts: [[640, 70], [640, 175]] },
      wire('W2', 'Coil ground W2', 'N6', 'N0', [[640, 175], [640, 225]], true),
      { id: 'F2', kind: 'fuse', label: 'Fan fuse F2', spec: '15 A', a: 'N2', b: 'N7', r: 0.01, rating: 15, cost: 3, replaceable: true, pts: [[220, 70], [220, 280]] },
      { id: 'K1C', kind: 'relay_contact', label: 'Relay K1 contacts', spec: 'Normally open', a: 'N7', b: 'N8', r: 0.02, coil: 'K1', unit: 'K1', cost: 18, replaceable: true, pts: [[220, 280], [420, 280]] },
      { id: 'X1', kind: 'connector', label: 'Fan connector X1', spec: '2-pin', a: 'N8', b: 'N9', r: 0.01, cost: 3, replaceable: true, pts: [[420, 280], [560, 280]] },
      { id: 'M1', kind: 'motor', label: 'Radiator fan M1', spec: '12 V 24 W', a: 'N9', b: 'N10', r: 6, rating: 24, cost: 65, replaceable: true, pts: [[560, 280], [700, 280]], friendly: 'radiator fan' },
      wire('W3', 'Fan ground W3', 'N10', 'N0', [[700, 280], [700, 345]], true),
    ],
    hidden: [],
  },
  faults: [
    {
      id: 'e4-f1-blown', target: 'F1', comp: 'F1', type: 'open', title: 'Blown control fuse F1',
      detail: 'F1 is open, so the relay coil never gets power. No click, and no fan.',
      clue: 'The control fuse element is broken.', clueMaxDifficulty: 3,
      emphasis: { 'elec.isolation': 0.8, 'elec.schematic': 0.8, 'elec.voltage': 0.6 }, minDifficulty: 3, maxDifficulty: 5,
    },
    {
      id: 'e4-ts-open', target: 'TS', comp: 'TS', type: 'open', title: 'Thermostat switch TS stuck open',
      detail: 'TS never closes, even when hot, so the relay coil is never energized. Voltage reaches TP3 but not TP4.',
      emphasis: { 'elec.voltage': 0.8, 'elec.schematic': 0.7, 'elec.isolation': 0.7 }, minDifficulty: 3, maxDifficulty: 5,
    },
    {
      id: 'e4-w1-open', target: 'W1', comp: 'W1', type: 'open', title: 'Broken relay feed W1',
      detail: 'W1 is broken between the thermostat and the relay coil, so the coil never gets power.',
      emphasis: { 'elec.voltage': 0.9, 'elec.isolation': 0.8 }, minDifficulty: 3, maxDifficulty: 5,
    },
    {
      id: 'e4-coil-open', target: 'K1', comp: 'K1', type: 'open', title: 'Open relay coil K1',
      detail: 'The relay coil winding is broken. Voltage arrives at the coil, but no current flows, so the contacts never close.',
      emphasis: { 'elec.resistance': 0.8, 'elec.isolation': 0.7, 'elec.voltage': 0.6 }, minDifficulty: 3, maxDifficulty: 5,
    },
    {
      id: 'e4-w2-open', target: 'W2', comp: 'W2', type: 'open', title: 'Broken coil ground W2',
      detail: 'The relay coil has lost its ground. TP6 floats up to supply voltage, and the relay never clicks.',
      emphasis: { 'elec.voltage': 0.9, 'elec.schematic': 0.8 }, minDifficulty: 4, maxDifficulty: 5,
    },
    {
      id: 'e4-f2-blown', target: 'F2', comp: 'F2', type: 'open', title: 'Blown fan fuse F2',
      detail: 'F2 is open. The relay clicks (control side OK), but no power reaches the fan.',
      clue: 'The fan fuse element is melted through.', clueMaxDifficulty: 3,
      emphasis: { 'elec.schematic': 0.9, 'elec.voltage': 0.7, 'elec.isolation': 0.8 }, minDifficulty: 3, maxDifficulty: 5,
    },
    {
      id: 'e4-k1c-burned', target: 'K1C', comp: 'K1C', type: 'open', title: 'Burned relay contacts K1',
      detail: 'The relay clicks, but its burned contacts do not conduct. Full supply voltage appears across the contacts (TP7 → TP8).',
      emphasis: { 'elec.voltage': 0.9, 'elec.isolation': 0.8 }, minDifficulty: 3, maxDifficulty: 5,
    },
    {
      id: 'e4-x1-corroded', target: 'X1', comp: 'X1', type: 'high_resistance', value: 6, title: 'Corroded fan connector X1',
      detail: 'X1 adds about 6 Ω, so the fan only crawls. With the fan commanded on, X1 drops about half the supply (TP8 → TP9).',
      emphasis: { 'elec.voltage': 1, 'elec.isolation': 0.7 }, minDifficulty: 4, maxDifficulty: 5,
    },
    {
      id: 'e4-m1-open', target: 'M1', comp: 'M1', type: 'open', title: 'Open fan motor M1',
      detail: 'The motor winding is open. Voltage reaches the motor terminals, but it cannot run.',
      emphasis: { 'elec.voltage': 0.7, 'elec.resistance': 0.7 }, minDifficulty: 3, maxDifficulty: 5,
    },
    {
      id: 'e4-w3-open', target: 'W3', comp: 'W3', type: 'open', title: 'Broken fan ground W3',
      detail: 'The fan has lost its ground. TP10 floats up to supply voltage when the relay is on.',
      emphasis: { 'elec.voltage': 0.9, 'elec.schematic': 0.8 }, minDifficulty: 4, maxDifficulty: 5,
    },
    {
      id: 'e4-b1-weak', target: 'B1', comp: 'B1', type: 'weak', value: 7, internalR: 1, title: 'Weak battery B1',
      detail: 'B1 only supplies about 7 V. That is not enough for the relay coil to pull in (it needs about 7.5 V), so the relay never clicks.',
      emphasis: { 'elec.voltage': 0.8, 'elec.isolation': 0.6 }, minDifficulty: 4, maxDifficulty: 5,
    },
    {
      id: 'e4-k1c-pitted', target: 'K1C', comp: 'K1C', type: 'high_resistance', value: 5, title: 'Pitted relay contacts K1',
      detail: 'The relay clicks, but pitted contacts add about 5 Ω, so the fan runs slowly. The contacts drop several volts under load.',
      emphasis: { 'elec.voltage': 1, 'elec.isolation': 0.8 }, minDifficulty: 5, maxDifficulty: 5,
    },
  ],
  initial: { controls: { power: true, lockout: false, switches: { TS: false }, plugged: {} }, blown: [] },
  operating: { switches: { TS: true } },
  reproduce: { comp: 'TS', on: true, label: 'Set the thermostat test switch TS to HOT' },
  allowDouble: false,
  acceptableExtras: [],
  story: (ctx: StoryContext) => ({
    title: "Cooling Fan Won't Start",
    briefing: `Work order #${ctx.workOrder}. ${ctx.customer}: "The engine runs hot in traffic, and I never hear the radiator fan come on." Fan M1 is switched by relay K1. The relay coil is powered through control fuse F1 and thermostat switch TS, which closes when the engine is hot. The fan itself is fed through fuse F2 and the relay contacts. Use TS's test position to simulate a hot engine. Power is ON and the engine is currently cold.`,
    goal: 'Make the fan run when the engine is hot, record your diagnosis, and verify the repair.',
    constraints: COMMON_CONSTRAINTS,
    objectives: [
      'Reproduce the complaint by simulating a hot engine',
      'Use the relay click to decide between the control and load circuits',
      'Locate the fault with voltage readings in the right circuit',
      'Repair, then verify that the fan runs when TS is HOT',
    ],
  }),
};

export const TEMPLATE_DEFS: Record<string, ElecTemplateDef> = {
  [porch.template.id]: porch,
  [workshop.template.id]: workshop,
  [shortHunt.template.id]: shortHunt,
  [fanRelay.template.id]: fanRelay,
};

export function getDef(templateId: string): ElecTemplateDef {
  const def = TEMPLATE_DEFS[templateId];
  if (!def) throw new Error(`Unknown electrical template ${templateId}`);
  return def;
}

export const CUSTOMERS = [
  'Ms. Alvarez',
  'Mr. Okafor',
  'Priya Shah',
  'Coach Daniels',
  'Mrs. Nguyen',
  'Sam Whitfield',
  'Dr. Kowalski',
  'Jordan Lee',
];
