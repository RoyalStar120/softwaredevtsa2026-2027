/**
 * Electrical module content: skill definitions, feedback guidelines for known mistakes
 * and strengths, and the knowledge base used by the offline coach.
 */

import type { KnowledgeTopic, MistakeDef, SkillDef, StrengthDef } from '../../types.ts';

const M = 'electrical';

export const ELEC_SKILLS: SkillDef[] = [
  {
    id: 'elec.safety',
    moduleId: M,
    name: 'Electrical Safety',
    shortName: 'Safety',
    description: 'De-energize at the disconnect, lock out, and verify zero energy before any contact work.',
    prerequisites: [],
    tier: 0,
    column: 0,
    kind: 'safety',
  },
  {
    id: 'elec.schematic',
    moduleId: M,
    name: 'Schematic Reading',
    shortName: 'Schematics',
    description: 'Trace current paths, understand series and parallel branches, and pick meaningful test points.',
    prerequisites: [],
    tier: 0,
    column: 2,
    kind: 'concept',
  },
  {
    id: 'elec.resistance',
    moduleId: M,
    name: 'Resistance & Continuity Testing',
    shortName: 'Resistance',
    description: 'Test de-energized parts and paths to find opens and shorts, and isolate components from parallel paths.',
    prerequisites: ['elec.safety', 'elec.schematic'],
    tier: 1,
    column: 0,
    kind: 'process',
  },
  {
    id: 'elec.voltage',
    moduleId: M,
    name: 'Voltage Testing',
    shortName: 'Voltage',
    description: 'Use live voltage readings and voltage drops to locate opens and high-resistance connections.',
    prerequisites: ['elec.schematic'],
    tier: 1,
    column: 2,
    kind: 'process',
  },
  {
    id: 'elec.isolation',
    moduleId: M,
    name: 'Systematic Fault Isolation',
    shortName: 'Isolation',
    description: 'Choose tests that split the remaining possibilities (half-splitting) instead of guessing or random probing.',
    prerequisites: ['elec.voltage', 'elec.resistance'],
    tier: 2,
    column: 1,
    kind: 'process',
  },
  {
    id: 'elec.repair',
    moduleId: M,
    name: 'Repair & Verification',
    shortName: 'Repair',
    description: 'Repair only what the evidence supports, then prove the fix by operating the circuit.',
    prerequisites: ['elec.isolation'],
    tier: 3,
    column: 1,
    kind: 'process',
  },
];

const mk = (d: MistakeDef): [string, MistakeDef] => [d.code, d];

export const ELEC_MISTAKES: Record<string, MistakeDef> = Object.fromEntries([
  mk({
    code: 'elec.live_resistance_test',
    title: 'Measured resistance on a live circuit',
    severity: 'critical',
    skillIds: ['elec.safety', 'elec.resistance'],
    why: 'An ohmmeter works by pushing its own small current through the part. If the circuit is energized, the reading is meaningless and the meter (or you) can be damaged.',
    instead: 'Switch the disconnect OFF, apply your lockout tag, verify 0 V with the meter in voltage mode, and only then switch to Ω or continuity.',
    realWorld: 'On higher-energy systems this mistake can blow the meter fuse or cause an arc flash.',
  }),
  mk({
    code: 'elec.live_part_replacement',
    title: 'Replaced or removed a part while energized',
    severity: 'critical',
    skillIds: ['elec.safety'],
    why: 'Removing or installing parts on an energized circuit exposes you to shock and arcing, and can damage the new part.',
    instead: 'Isolate at the main disconnect, lock it out, and verify zero energy before you touch any component.',
    realWorld: 'Lockout/tagout procedures exist because live work causes serious injuries every year.',
  }),
  mk({
    code: 'elec.not_isolated',
    title: 'Relied on a switch instead of isolating at the disconnect',
    severity: 'major',
    skillIds: ['elec.safety'],
    why: 'A functional switch can fail, be bypassed, or be turned on by someone else. It is not an isolation point.',
    instead: 'Always isolate at the main disconnect and lock it out before contact work, even if the section you are touching reads 0 V.',
  }),
  mk({
    code: 'elec.no_zero_energy_verification',
    title: 'Skipped verifying zero energy',
    severity: 'major',
    skillIds: ['elec.safety'],
    why: 'Switching something off is not proof that it is dead. Feeds can be mislabeled, disconnects can fail, and there can be a second source.',
    instead: 'After switching off, measure voltage on the load side (for example, from a test point after the disconnect to GND) and confirm 0 V before contact work.',
  }),
  mk({
    code: 'elec.no_lockout',
    title: 'Worked without a lockout tag',
    severity: 'minor',
    skillIds: ['elec.safety'],
    why: 'Without a lockout, someone else can restore power while you are working on the circuit.',
    instead: 'Apply your lockout tag to the disconnect as soon as you switch it off for contact work.',
  }),
  mk({
    code: 'elec.replaced_good_part',
    title: 'Replaced parts that were not faulty',
    severity: 'major',
    skillIds: ['elec.isolation', 'elec.repair'],
    why: 'Swapping parts without evidence wastes money and time, and can hide the real fault. This is called using the "parts cannon".',
    instead: 'Keep testing until your readings narrow the fault to one part, then replace only that part.',
    realWorld: 'Unnecessary parts are a top source of customer complaints and comebacks in repair shops.',
  }),
  mk({
    code: 'elec.unconfirmed_repair',
    title: 'Repaired the right part by guessing',
    severity: 'minor',
    skillIds: ['elec.isolation'],
    why: 'You replaced the faulty part, but your readings still allowed other explanations. Next time the same guess could be wrong.',
    instead: 'Before replacing, ask: "Which readings prove this part is bad?" If you cannot answer, take one more targeted reading.',
  }),
  mk({
    code: 'elec.redundant_measurements',
    title: 'Readings that added no new information',
    severity: 'minor',
    skillIds: ['elec.isolation', 'elec.voltage'],
    why: 'Repeating readings, or taking readings that every remaining explanation predicts, costs time without narrowing the problem.',
    instead: 'Before each reading, predict what each remaining possibility would show. Choose a test where those predictions differ.',
  }),
  mk({
    code: 'elec.random_probing',
    title: 'Probed without a systematic strategy',
    severity: 'major',
    skillIds: ['elec.isolation', 'elec.schematic'],
    why: 'Most of your readings did not narrow down the possibilities, which suggests probing at random rather than following the circuit.',
    instead: 'Use half-splitting: measure near the middle of the suspect section, then keep the half that the reading points to.',
  }),
  mk({
    code: 'elec.skipped_source_check',
    title: 'Did not confirm the power source',
    severity: 'minor',
    skillIds: ['elec.voltage', 'elec.isolation'],
    why: 'If the source is weak or missing, every downstream reading is misleading and replaced parts will not help.',
    instead: 'Early on, confirm the supply voltage (for example, across the battery, or at the first test point to GND with power on).',
  }),
  mk({
    code: 'elec.unverified_repair',
    title: 'Did not verify the repair',
    severity: 'major',
    skillIds: ['elec.repair'],
    why: 'A repair is not finished until the circuit is proven to work. There could be a second fault, or the new part could be defective.',
    instead: 'Remove your lockout, restore power, operate the circuit normally, and confirm every load works before closing the work order.',
  }),
  mk({
    code: 'elec.fuse_reblown',
    title: 'Installed a new fuse before finding the short',
    severity: 'major',
    skillIds: ['elec.resistance', 'elec.isolation', 'elec.safety'],
    why: 'A fuse blows because something drew too much current. A new fuse does not remove the short. It just blows again, and repeated faults can damage wiring.',
    instead: 'Leave the fuse out. Use resistance readings to ground (power off) and unplug branches to find the short. Install the new fuse last.',
  }),
  mk({
    code: 'elec.wrong_diagnosis',
    title: 'Recorded an incorrect diagnosis',
    severity: 'major',
    skillIds: ['elec.schematic', 'elec.isolation'],
    why: 'The work order is the record of what failed. An incorrect diagnosis misleads the next technician and hides patterns of failure.',
    instead: 'Base the diagnosis on your readings: name the part and the failure mode your evidence supports (open, high resistance, short, or weak source).',
  }),
  mk({
    code: 'elec.no_diagnosis',
    title: 'Closed the work order without a diagnosis',
    severity: 'minor',
    skillIds: ['elec.schematic'],
    why: 'Without a recorded diagnosis, no one can learn from the failure or check the repair.',
    instead: 'Record the failed part and the failure mode before completing the work order.',
  }),
  mk({
    code: 'elec.left_unrepaired',
    title: 'Closed the work order with the circuit still faulty',
    severity: 'critical',
    skillIds: ['elec.repair', 'elec.isolation'],
    why: 'The customer\'s problem is not solved, and the fault may be worse than before.',
    instead: 'Operate the circuit after every repair. If it still does not work, keep isolating. There may be more than one fault.',
  }),
  mk({
    code: 'elec.didnt_reproduce',
    title: 'Did not reproduce the complaint first',
    severity: 'minor',
    skillIds: ['elec.schematic', 'elec.isolation'],
    why: 'Some faults only show under specific operating conditions. Testing before reproducing the complaint can make everything look normal.',
    instead: 'First recreate the condition the customer described (for example, the thermostat calling for the fan), then observe what does and does not happen.',
  }),
]);

const sk = (d: StrengthDef): [string, StrengthDef] => [d.code, d];

export const ELEC_STRENGTHS: Record<string, StrengthDef> = Object.fromEntries([
  sk({
    code: 'elec.safe_procedure',
    title: 'Safe isolation procedure',
    skillIds: ['elec.safety'],
    why: 'You switched off at the disconnect, locked out, and verified zero energy before contact work, exactly as a professional would.',
  }),
  sk({
    code: 'elec.evidence_based',
    title: 'Evidence-based repair',
    skillIds: ['elec.isolation', 'elec.repair'],
    why: 'You only replaced parts after your readings had ruled out every other explanation.',
  }),
  sk({
    code: 'elec.systematic_isolation',
    title: 'Systematic fault isolation',
    skillIds: ['elec.isolation', 'elec.voltage'],
    why: 'Almost every reading narrowed the possibilities, close to an expert\'s number of tests.',
  }),
  sk({
    code: 'elec.source_first',
    title: 'Confirmed the source early',
    skillIds: ['elec.voltage'],
    why: 'Checking the supply first rules out the most basic cause and makes later readings trustworthy.',
  }),
  sk({
    code: 'elec.verified_repair',
    title: 'Verified the repair',
    skillIds: ['elec.repair'],
    why: 'You restored power and proved the circuit works before closing the job.',
  }),
  sk({
    code: 'elec.correct_diagnosis',
    title: 'Accurate diagnosis',
    skillIds: ['elec.schematic'],
    why: 'You named the exact failed part and failure mode.',
  }),
  sk({
    code: 'elec.reproduced_symptom',
    title: 'Reproduced the complaint',
    skillIds: ['elec.isolation'],
    why: 'You recreated the operating condition before testing, so your readings reflected the real failure.',
  }),
  sk({
    code: 'elec.useful_inspection',
    title: 'Useful visual inspection',
    skillIds: ['elec.schematic'],
    why: 'A quick look found a real clue. Visual checks are a fast first step.',
  }),
]);

export const ELEC_KNOWLEDGE: KnowledgeTopic[] = [
  {
    id: 'voltage-basics',
    title: 'Reading voltage in a series circuit',
    keywords: ['voltage', 'volts', 'reading', 'measure voltage', 'multimeter', 'dc'],
    answer:
      'With the circuit ON, voltage measures the difference in electrical "pressure" between your two probes. Across a good wire, fuse or closed switch you should see almost 0 V. Across the load (lamp, motor) you should see nearly the full supply. If you measure from any test point to GND, you see how much of the supply reaches that point.',
  },
  {
    id: 'open-full-voltage',
    title: 'Why an open part shows the full supply voltage',
    keywords: ['open', '12 v across', 'full voltage', 'broken', 'blown', 'across the switch', 'across the fuse'],
    answer:
      'When a series circuit is open, no current flows, so no voltage is dropped across the good parts. The entire supply voltage appears across the gap. That is why measuring across a blown fuse or a failed-open switch (with power ON) reads about 12 V, while every good conductor reads about 0 V.',
  },
  {
    id: 'voltage-drop',
    title: 'Voltage drop and high resistance',
    keywords: ['dim', 'voltage drop', 'corrosion', 'corroded', 'high resistance', 'slow', 'weak'],
    answer:
      'A dim lamp or slow motor often means extra resistance somewhere in the path. Corrosion, pitted contacts and loose terminals all add resistance. With the load running, measure across each connection: a good one drops only a few hundredths of a volt, while a bad one drops volts. The biggest voltage drop outside the load points to the fault.',
  },
  {
    id: 'resistance-dead',
    title: 'Resistance and continuity tests need a dead circuit',
    keywords: ['resistance', 'ohm', 'ohms', 'continuity', 'beep', 'volt!', 'ol'],
    answer:
      'An ohmmeter supplies its own small test current, so the circuit must be de-energized. Switch off at the disconnect, lock out, verify 0 V, then measure. "OL" means open (no path), and a beep in continuity mode means a low-resistance path. If the meter shows a voltage warning, stop: the circuit is still live.',
  },
  {
    id: 'parallel-paths',
    title: 'In-circuit readings and parallel paths',
    keywords: ['parallel', 'in-circuit', 'bench', 'bench test', 'isolate component', 'remove'],
    answer:
      'When you measure a part that is still installed, the meter also sees every other path between the probes. A lamp that reads 7 Ω in-circuit might really be 14 Ω with another lamp in parallel. To test the part alone, remove it and bench-test it, or unplug its connector.',
  },
  {
    id: 'lockout',
    title: 'Lockout/tagout and verifying zero energy',
    keywords: ['lockout', 'tagout', 'loto', 'lock', 'tag', 'safe', 'safety', 'zero energy', 'verify', 'disconnect'],
    answer:
      'Before touching parts or taking resistance readings: (1) switch the main disconnect OFF, (2) apply your personal lockout tag so no one can restore power, and (3) verify zero energy with your meter on the load side. In real work you also test the meter on a known live source before and after (live-dead-live). A switch on the load is not an isolation point.',
  },
  {
    id: 'half-split',
    title: 'Half-splitting: the expert strategy',
    keywords: ['half', 'split', 'strategy', 'systematic', 'efficient', 'fewer', 'expert', 'where to start'],
    answer:
      'Pick a test point near the middle of the section that could contain the fault. The reading tells you which half the fault is in, so each test cuts the possibilities roughly in half. Eight possible faults need only about three well-chosen tests. Random probing can take many more.',
  },
  {
    id: 'shorts-fuses',
    title: 'Fuses and short circuits',
    keywords: ['fuse', 'short', 'shorted', 'blows', 'blowing', 'chafed', 'ground', 'overcurrent'],
    answer:
      'A fuse blows when current exceeds its rating, usually because of a short (a low-resistance path to ground). Replacing the fuse does not fix the short. With power off, measure resistance from the circuit to GND: near 0 Ω means a short. Unplug branches one at a time. When the reading jumps up, the short was in the branch you just disconnected.',
  },
  {
    id: 'relays',
    title: 'Relay circuits: control side vs load side',
    keywords: ['relay', 'coil', 'contacts', 'click', 'control', 'thermostat', 'fan'],
    answer:
      'A relay uses a small control current through its coil to close heavy-duty contacts for the load. First reproduce the condition (for example, thermostat HOT). If the relay clicks but the load does not run, the fault is on the load side (fuse F2, contacts, connector, motor or ground). If there is no click, check the control side (fuse F1, thermostat, coil feed, coil and its ground).',
  },
  {
    id: 'source',
    title: 'Checking the source first',
    keywords: ['battery', 'source', 'supply', 'weak battery', 'load test'],
    answer:
      'Always confirm the supply. A weak battery may read close to normal with no load, then sag badly when the circuit is on. Measure across the battery with the circuit operating, or use a bench load test. A healthy 12 V battery stays near 12 V.',
  },
];

export const SAFETY_NOTICE =
  'Simulated training only. SkillBridge does not replace certified electrical instruction, professional supervision, or local codes. Never work on real energized equipment without proper qualification.';
