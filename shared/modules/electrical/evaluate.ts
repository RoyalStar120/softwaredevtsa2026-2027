/**
 * Electrical evaluator: deterministic rules over the annotated action log.
 * Separates "did the circuit get fixed?" (accuracy) from "how was it fixed?"
 * (process, efficiency, safety), so a lucky or unsafe repair never scores like a
 * systematic, safe one.
 */

import type {
  LoggedAction,
  MistakeInstance,
  ModuleEvaluation,
  ScenarioInstance,
  SkillEvidence,
  StrengthInstance,
  TimelineEntry,
  Verdict,
} from '../../types.ts';
import { clamp, listJoin, pct, plural, round } from '../../util.ts';
import type { ElecConfig, FaultType } from './types.ts';
import { getDef } from './circuits.ts';
import { faultById } from './sim.ts';
import type { ElecState } from './engine.ts';
import { faultTypeLabel } from './engine.ts';

type Inst = ScenarioInstance<ElecConfig>;

export function evaluateElectrical(instance: Inst, state: ElecState, log: LoggedAction[]): ModuleEvaluation {
  const def = getDef(instance.templateId);
  const label = (id: string) => def.circuit.comps.find((c) => c.id === id)?.label ?? id;
  const kindOf = (id: string) => def.circuit.comps.find((c) => c.id === id)?.kind ?? 'wire';
  const realFaults = instance.config.faultIds.map((id) => faultById(def, id));
  const w = (s: string) => instance.skillWeights[s] ?? 0;

  const timeline: TimelineEntry[] = [];
  const mistakes = new Map<string, MistakeInstance>();
  const strengths = new Map<string, StrengthInstance>();
  const addMistake = (code: string, seq: number | null, detail: string) => {
    const m = mistakes.get(code) ?? { code, count: 0, steps: [], detail };
    m.count += 1;
    if (seq !== null) m.steps.push(seq);
    mistakes.set(code, m);
  };
  const addStrength = (code: string, steps: number[], detail: string) => {
    strengths.set(code, { code, steps, detail });
  };
  const mark = (seq: number, verdict: Verdict, note: string) => timeline.push({ seq, verdict, note });

  // Counters
  let diagMeasurements = 0;
  let informative = 0;
  let redundantCount = 0;
  let sameNode = 0;
  let totalReadings = 0;
  let voltageDiag = 0;
  let voltageInformative = 0;
  let resistTests = 0;
  let resistInformative = 0;
  let resistProper = 0;
  let confirmationsUsed = 0;
  let firstReplaceSeq: number | null = null;
  let firstMeasureSeq: number | null = null;
  let sourceEvidenceSeq: number | null = null;
  let measurementIndexAtSource = 0;
  let measurementIndex = 0;
  let reproducedSeq: number | null = null;
  let lastRepairSeq: number | null = null;
  let verifiedAfterRepair = false;
  let verifySeq: number | null = null;
  let contactCount = 0;
  let lockoutUsed = false;
  const liveContact: number[] = [];
  const liveReplace: number[] = [];
  const notIsolated: number[] = [];
  const noVerify: number[] = [];
  const noLockout: number[] = [];
  const replacedGood: Array<{ seq: number; comp: string; cost: number; proven: boolean }> = [];
  const unconfirmed: Array<{ seq: number; comp: string; others: number }> = [];
  const evidenceRepairs: number[] = [];
  let faultyRepairs = 0;
  const reblown: number[] = [];
  const replacedFuses = new Set<string>();
  const clueSteps: number[] = [];
  let working = false;
  let completed = false;
  const lastT = log.length ? log[log.length - 1].t : 0;

  const contactChecks = (e: LoggedAction, what: string): boolean => {
    const a = e.annotations;
    contactCount++;
    if (a.live) {
      (e.type === 'replace' || e.type === 'bench_test' ? liveReplace : liveContact).push(e.seq);
      mark(e.seq, 'unsafe', `${what} while the part was energized. Isolate at the disconnect first.`);
      return false;
    }
    if (a.powerOn) {
      notIsolated.push(e.seq);
      mark(e.seq, 'mistake', `${what} with main power still ON (only a switch isolated this section). Use the disconnect and lockout.`);
      return false;
    }
    if (!a.verifiedDead) {
      noVerify.push(e.seq);
      mark(e.seq, 'mistake', `${what} without first verifying 0 V after switching off.`);
      return false;
    }
    if (!a.lockout) noLockout.push(e.seq);
    else lockoutUsed = true;
    return true;
  };

  for (const e of log) {
    const a = e.annotations ?? {};
    switch (e.type) {
      case 'set_power': {
        if (a.fuseBlew?.length) {
          const re = a.fuseBlew.some((f: string) => replacedFuses.has(f));
          if (re) {
            reblown.push(e.seq);
            mark(e.seq, 'mistake', `${listJoin(a.fuseBlew.map(label))} blew again when power was restored, because the short was still there.`);
          } else mark(e.seq, 'info', `${listJoin(a.fuseBlew.map(label))} blew when power was restored.`);
        } else if (a.powerOn) {
          if (lastRepairSeq !== null && a.operatingOk) {
            verifiedAfterRepair = true;
            verifySeq = e.seq;
            mark(e.seq, 'good', 'Restored power and confirmed the circuit operates normally.');
          } else if (a.eliminated > 0) mark(e.seq, 'good', `Restoring power revealed new information (ruled out ${a.eliminated}).`);
          else mark(e.seq, 'neutral', 'Restored main power.');
        } else {
          mark(e.seq, 'good', 'Isolated the circuit at the main disconnect.');
        }
        break;
      }
      case 'set_lockout':
        mark(e.seq, a.lockout ? 'good' : 'neutral', a.lockout ? 'Applied a personal lockout tag.' : 'Removed the lockout tag.');
        break;
      case 'toggle':
      case 'set_plug': {
        if (a.reproduce && reproducedSeq === null) {
          reproducedSeq = e.seq;
          mark(e.seq, 'good', 'Reproduced the complaint under operating conditions.');
        } else if (lastRepairSeq !== null && a.operatingOk && !verifiedAfterRepair) {
          verifiedAfterRepair = true;
          verifySeq = e.seq;
          mark(e.seq, 'good', 'Operated the circuit after the repair and confirmed it works.');
        } else if (a.fuseBlew?.length) {
          const re = a.fuseBlew.some((f: string) => replacedFuses.has(f));
          if (re) {
            reblown.push(e.seq);
            mark(e.seq, 'mistake', `${listJoin(a.fuseBlew.map(label))} blew again because the short was still there.`);
          } else mark(e.seq, 'info', `${listJoin(a.fuseBlew.map(label))} blew.`);
        } else if (a.eliminated > 0) {
          mark(e.seq, 'good', `Operating the circuit this way ruled out ${plural(a.eliminated, 'possibility', 'possibilities')}.`);
        } else mark(e.seq, 'neutral', 'Changed the circuit configuration.');
        break;
      }
      case 'measure': {
        totalReadings++;
        measurementIndex++;
        if (firstMeasureSeq === null) firstMeasureSeq = e.seq;
        if (a.sameNode) {
          sameNode++;
          diagMeasurements++;
          mark(e.seq, 'wasted', 'Both probes were on the same test point, so the reading is always zero.');
          break;
        }
        const isContact = a.mode !== 'V';
        if (isContact) {
          resistTests++;
          if (a.voltagePresent) {
            liveContact.push(e.seq);
            contactCount++;
            mark(e.seq, 'unsafe', 'Resistance/continuity test on an energized circuit. The meter showed a voltage warning instead of a reading.');
            diagMeasurements++;
            break;
          }
          const ok = contactChecks(e, `${a.mode === 'R' ? 'Resistance' : 'Continuity'} test`);
          if (ok) resistProper++;
          if (!ok) {
            diagMeasurements++;
            if (a.eliminated > 0) {
              informative++;
              resistInformative++;
            }
            break;
          }
        }
        if (a.verification) {
          mark(e.seq, 'good', 'Verified zero energy (0 V) on the load side before contact work.');
          break;
        }
        if (a.sourceEvidence && sourceEvidenceSeq === null) {
          sourceEvidenceSeq = e.seq;
          measurementIndexAtSource = measurementIndex;
        }
        if (a.redundant) {
          redundantCount++;
          diagMeasurements++;
          mark(e.seq, 'wasted', 'Repeated an earlier reading with nothing changed in between.');
          break;
        }
        if (a.eliminated > 0) {
          informative++;
          diagMeasurements++;
          if (isContact) resistInformative++;
          else voltageInformative++;
          if (!isContact) voltageDiag++;
          mark(
            e.seq,
            'good',
            `${a.display}: ruled out ${plural(a.eliminated, 'possibility', 'possibilities')}${a.aliveAfter === 1 ? ', leaving only one explanation' : ` (${a.aliveAfter} left)`}.`,
          );
          break;
        }
        if (!isContact) voltageDiag++;
        if (a.aliveBefore <= 1) {
          if (confirmationsUsed === 0) {
            confirmationsUsed++;
            mark(e.seq, 'neutral', 'Confirmation reading. Your evidence had already pinned down the fault.');
          } else {
            diagMeasurements++;
            redundantCount++;
            mark(e.seq, 'wasted', 'Another confirmation reading after the fault was already pinned down.');
          }
          break;
        }
        diagMeasurements++;
        if (a.mode === 'V' && !a.powerOn) {
          redundantCount++;
          mark(e.seq, 'wasted', 'With power OFF, voltage readings on the load side show 0 V everywhere, so this told you nothing new.');
        } else {
          redundantCount++;
          mark(e.seq, 'wasted', `${a.display}: every remaining possibility predicts this reading, so it narrowed nothing down.`);
        }
        break;
      }
      case 'inspect': {
        diagMeasurements += 0.5;
        if (a.clueFound) {
          clueSteps.push(e.seq);
          if (a.eliminated > 0) informative += 0.5;
          mark(e.seq, 'good', `Visual inspection found a clue: ${e.observation?.text ?? ''}`);
        } else mark(e.seq, 'neutral', 'Quick visual check: nothing visible, so measurement is needed.');
        break;
      }
      case 'bench_test': {
        resistTests++;
        totalReadings++;
        const ok = contactChecks(e, 'Removed and bench-tested a part');
        if (ok) resistProper++;
        diagMeasurements++;
        if (a.eliminated > 0) {
          informative++;
          resistInformative++;
          if (ok) mark(e.seq, 'good', `Bench test (${a.display}) ruled out ${plural(a.eliminated, 'possibility', 'possibilities')}.`);
        } else if (ok) {
          if (a.aliveBefore <= 1 && confirmationsUsed === 0) {
            confirmationsUsed++;
            diagMeasurements--;
            mark(e.seq, 'neutral', `Bench test confirmed the part (${a.display}).`);
          } else {
            redundantCount++;
            mark(e.seq, 'wasted', `Bench test (${a.display}) did not narrow anything down.`);
          }
        }
        break;
      }
      case 'replace': {
        if (firstReplaceSeq === null) firstReplaceSeq = e.seq;
        const comp = String(a.comp);
        const safe = contactChecks(e, `Replaced ${label(comp)}`);
        if (kindOf(comp) === 'fuse') replacedFuses.add(comp);
        lastRepairSeq = e.seq;
        verifiedAfterRepair = false;
        let verdict: Verdict = 'good';
        let note = '';
        if (a.wasFaulty || a.wasBlownFuse) {
          faultyRepairs++;
          if (a.wasBlownFuse && a.shortPresent) {
            verdict = 'neutral';
            note = `Replaced blown ${label(comp)} while the short was still present. Powering on now would blow it again.`;
          } else if (a.evidenceBased) {
            evidenceRepairs.push(e.seq);
            note = `Evidence-based repair: your readings had narrowed the fault to ${label(comp)}.`;
          } else {
            const others = (a.aliveBefore ?? 1) - (a.candidatesWithPart ?? 0);
            unconfirmed.push({ seq: e.seq, comp, others });
            verdict = 'info';
            note = `${label(comp)} was faulty, but your readings still allowed ${plural(others, 'other explanation')}. This was a lucky guess.`;
          }
        } else {
          replacedGood.push({ seq: e.seq, comp, cost: a.cost ?? 0, proven: !!a.provenGood });
          verdict = 'wasted';
          note = `Replaced a good part ($${a.cost})${a.provenGood ? '. Your earlier readings had already shown it was fine' : ''}.`;
        }
        if (safe) mark(e.seq, verdict, note);
        else {
          // keep the safety verdict but append the repair assessment
          const last = timeline[timeline.length - 1];
          if (last && last.seq === e.seq) last.note += ` ${note}`;
        }
        if (a.fuseBlew?.length) reblown.push(e.seq);
        if (a.operatingOk) {
          verifiedAfterRepair = true;
          verifySeq = e.seq;
        }
        break;
      }
      case 'diagnose':
        mark(e.seq, 'info', 'Recorded a diagnosis on the work order.');
        break;
      case 'complete_work_order':
        completed = true;
        working = !!a.working;
        mark(e.seq, working && verifiedAfterRepair ? 'good' : 'mistake', working ? (verifiedAfterRepair ? 'Closed the work order with a verified, working circuit.' : 'Closed the work order without verifying the repair.') : 'Closed the work order while the circuit was still faulty.');
        break;
      case 'hint':
        mark(e.seq, 'info', `Used hint level ${e.payload?.level ?? '?'}.`);
        break;
      default:
        mark(e.seq, 'neutral', '');
    }
  }

  // ---------------- Diagnosis ----------------
  const diag = state.diagnosis;
  const realKeys = realFaults.map((f) => `${f.comp}:${f.type}`);
  let diagScore = 0;
  let compScore = 0;
  if (diag.length) {
    const per = realFaults.map((f) => {
      if (diag.some((d) => d.comp === f.comp && d.type === f.type)) return 1;
      if (diag.some((d) => d.comp === f.comp)) return 0.6;
      return 0;
    });
    const perComp = realFaults.map((f) => (diag.some((d) => d.comp === f.comp) ? 1 : 0));
    const extras = diag.filter(
      (d) => !realKeys.includes(`${d.comp}:${d.type}`) && !realFaults.some((f) => f.comp === d.comp) && !def.acceptableExtras.includes(`${d.comp}:${d.type}`),
    ).length;
    diagScore = clamp(per.reduce((s: number, x: number) => s + x, 0) / per.length - 0.15 * extras);
    compScore = perComp.reduce((s: number, x: number) => s + x, 0) / perComp.length;
  }
  const diagText = (d: { comp: string; type: FaultType }) => `${label(d.comp)} (${faultTypeLabel(kindOf(d.comp), d.type).toLowerCase()})`;
  const diagnoseSeq = [...log].reverse().find((e) => e.type === 'diagnose')?.seq ?? null;
  if (!diag.length) addMistake('elec.no_diagnosis', null, 'The work order was closed without recording which part failed.');
  else if (diagScore < 1) {
    addMistake(
      'elec.wrong_diagnosis',
      diagnoseSeq,
      `You recorded ${listJoin(diag.map(diagText))}, but the actual fault was ${listJoin(realFaults.map((f) => `${label(f.comp)} (${faultTypeLabel(kindOf(f.comp), f.type).toLowerCase()})`))}.`,
    );
    if (diagnoseSeq !== null) {
      const t = timeline.find((x) => x.seq === diagnoseSeq);
      if (t) {
        t.verdict = 'mistake';
        t.note = 'The recorded diagnosis does not match the actual fault.';
      }
    }
  } else {
    addStrength('elec.correct_diagnosis', diagnoseSeq !== null ? [diagnoseSeq] : [], `You recorded ${listJoin(diag.map(diagText))}.`);
    if (diagnoseSeq !== null) {
      const t = timeline.find((x) => x.seq === diagnoseSeq);
      if (t) {
        t.verdict = 'good';
        t.note = 'Correct diagnosis recorded.';
      }
    }
  }

  // ---------------- Safety ----------------
  const critical = liveContact.length + liveReplace.length;
  if (liveContact.length) addMistake('elec.live_resistance_test', null, `${plural(liveContact.length, 'resistance/continuity test')} on an energized circuit`);
  const lr = mistakes.get('elec.live_resistance_test');
  if (lr) lr.steps = liveContact;
  if (liveReplace.length) {
    addMistake('elec.live_part_replacement', null, `${plural(liveReplace.length, 'part')} removed or replaced while energized`);
    mistakes.get('elec.live_part_replacement')!.steps = liveReplace;
  }
  if (notIsolated.length) {
    addMistake('elec.not_isolated', null, 'Contact work while main power was still ON');
    mistakes.get('elec.not_isolated')!.steps = notIsolated;
  }
  if (noVerify.length) {
    addMistake('elec.no_zero_energy_verification', null, 'Contact work after switching off, but before measuring 0 V on the load side');
    mistakes.get('elec.no_zero_energy_verification')!.steps = noVerify;
  }
  if (noLockout.length) {
    addMistake('elec.no_lockout', null, 'Contact work without a lockout tag on the disconnect');
    mistakes.get('elec.no_lockout')!.steps = noLockout;
  }
  let safety = 1 - 0.5 * Math.min(2, critical) - (notIsolated.length ? 0.25 : 0) - (noVerify.length ? 0.2 : 0) - (noLockout.length ? 0.1 : 0);
  safety = round(clamp(safety), 3);
  if (contactCount > 0 && critical === 0 && !notIsolated.length && !noVerify.length && !noLockout.length) {
    addStrength('elec.safe_procedure', [], 'Every contact test and repair happened with the disconnect OFF, locked out, and 0 V verified.');
  }

  // ---------------- Process ----------------
  if (replacedGood.length) {
    const cost = replacedGood.reduce((s, r) => s + r.cost, 0);
    addMistake(
      'elec.replaced_good_part',
      null,
      `Replaced ${listJoin(replacedGood.map((r) => label(r.comp)))} ($${cost} of unnecessary parts)${replacedGood.some((r) => r.proven) ? ', including parts your own readings had already cleared' : ''}`,
    );
    mistakes.get('elec.replaced_good_part')!.steps = replacedGood.map((r) => r.seq);
    mistakes.get('elec.replaced_good_part')!.count = replacedGood.length;
  }
  if (unconfirmed.length) {
    addMistake('elec.unconfirmed_repair', null, `${listJoin(unconfirmed.map((u) => label(u.comp)))} replaced before your readings had ruled out the alternatives`);
    mistakes.get('elec.unconfirmed_repair')!.steps = unconfirmed.map((u) => u.seq);
  }
  const wastedReadings = redundantCount + sameNode;
  if (wastedReadings >= 2) {
    addMistake('elec.redundant_measurements', null, `${plural(wastedReadings, 'reading')} added no new information`);
    mistakes.get('elec.redundant_measurements')!.steps = timeline.filter((t) => t.verdict === 'wasted' && log.find((l) => l.seq === t.seq)?.type !== 'replace').map((t) => t.seq);
  }
  const informativeRatio = diagMeasurements > 0 ? informative / diagMeasurements : 0;
  const randomProbing = diagMeasurements >= 5 && informativeRatio < 0.4;
  if (randomProbing) addMistake('elec.random_probing', null, `Only ${pct(informativeRatio)} of your ${Math.round(diagMeasurements)} readings narrowed down the fault`);
  const firstReplace = log.find((e) => e.type === 'replace');
  if (firstReplace && firstReplace.annotations?.sourceStillSuspect && kindOf(String(firstReplace.annotations.comp)) !== 'battery') {
    addMistake('elec.skipped_source_check', firstReplace.seq, 'You started replacing parts while a weak or failed supply was still a possible explanation');
  }
  if (lastRepairSeq !== null && !verifiedAfterRepair) {
    addMistake('elec.unverified_repair', lastRepairSeq, 'After your last repair you did not operate the circuit to prove it works');
  }
  if (reblown.length) {
    addMistake('elec.fuse_reblown', null, 'A replacement fuse blew because the short circuit had not been found and repaired');
    mistakes.get('elec.fuse_reblown')!.steps = reblown;
  }
  if (completed && !working) addMistake('elec.left_unrepaired', null, 'The circuit still did not work when the work order was closed');
  if (def.reproduce && (reproducedSeq === null || (firstMeasureSeq !== null && reproducedSeq > firstMeasureSeq))) {
    addMistake('elec.didnt_reproduce', firstMeasureSeq, `You started testing before you ${def.reproduce.label.toLowerCase()}`);
  }

  let process =
    1 -
    0.25 * Math.min(2, replacedGood.length) -
    0.25 * Math.min(2, unconfirmed.length) -
    Math.min(0.2, 0.04 * Math.max(0, wastedReadings - 1)) -
    (randomProbing ? 0.15 : 0) -
    (mistakes.has('elec.skipped_source_check') ? 0.05 : 0) -
    (mistakes.has('elec.unverified_repair') ? 0.2 : 0) -
    (reblown.length ? 0.15 : 0) -
    (mistakes.has('elec.didnt_reproduce') ? 0.05 : 0) -
    (completed && !working ? 0.2 : 0);
  process = round(clamp(process), 3);

  // ---------------- Efficiency ----------------
  const expertM = Math.max(1, state.expert.measurements);
  let efficiency: number;
  if (diagMeasurements <= 0) efficiency = unconfirmed.length || replacedGood.length ? 0.5 : 1;
  else efficiency = Math.min(1, expertM / Math.max(expertM, diagMeasurements));
  efficiency = round(clamp(efficiency * (1 - 0.1 * Math.min(3, replacedGood.length))), 3);

  // ---------------- Strengths ----------------
  if (faultyRepairs > 0 && evidenceRepairs.length === faultyRepairs - (log.some((e) => e.annotations?.shortPresent) ? 1 : 0) && evidenceRepairs.length > 0 && !replacedGood.length && !unconfirmed.length) {
    addStrength('elec.evidence_based', evidenceRepairs, 'Every part you replaced had been proven faulty by your own readings.');
  }
  if (working && diagMeasurements <= expertM + 2 && informativeRatio >= 0.6 && diagMeasurements > 0) {
    addStrength('elec.systematic_isolation', [], `${Math.round(diagMeasurements)} diagnostic readings (expert path: ${expertM}), and ${pct(informativeRatio)} of them narrowed the possibilities.`);
  }
  if (sourceEvidenceSeq !== null && measurementIndexAtSource <= 2) {
    addStrength('elec.source_first', [sourceEvidenceSeq], 'You confirmed the supply voltage within your first two readings.');
  }
  if (verifiedAfterRepair && verifySeq !== null) addStrength('elec.verified_repair', [verifySeq], 'You restored power and confirmed the circuit works after the repair.');
  if (def.reproduce && reproducedSeq !== null && (firstMeasureSeq === null || reproducedSeq < firstMeasureSeq)) {
    addStrength('elec.reproduced_symptom', [reproducedSeq], 'You recreated the hot-engine condition before testing.');
  }
  if (clueSteps.length) addStrength('elec.useful_inspection', clueSteps, 'A visual inspection turned up a real clue.');

  // ---------------- Scores ----------------
  const repairedShare = realFaults.length
    ? realFaults.filter((f) => state.replaced.some((r) => r.comp === f.comp || def.circuit.comps.find((c) => c.id === r.comp)?.unit === def.circuit.comps.find((c) => c.id === f.comp)?.unit && !!def.circuit.comps.find((c) => c.id === f.comp)?.unit)).length / realFaults.length
    : 0;
  const accuracy = round(clamp((working ? 0.5 : 0.5 * repairedShare * 0.6) + 0.5 * diagScore), 3);
  const solved = working && diagScore >= 0.5;

  let processVerdict: ModuleEvaluation['processVerdict'];
  if (!working) {
    processVerdict = { label: 'Fault not repaired', tone: 'danger', explanation: 'The circuit still did not work when the work order was closed.' };
  } else if (safety < 0.5) {
    processVerdict = {
      label: 'Repaired, but with an unsafe process',
      tone: 'danger',
      explanation: `The circuit works, but ${plural(critical, 'critical safety violation')} would put a real technician at risk.`,
    };
  } else if (replacedGood.length || unconfirmed.length) {
    processVerdict = {
      label: 'Repaired by trial and error',
      tone: 'warning',
      explanation: 'The circuit works, but parts were swapped without evidence. Measurements, not guesses, should drive repairs.',
    };
  } else if (efficiency < 0.6 || randomProbing) {
    processVerdict = {
      label: 'Repaired, but the diagnosis was inefficient',
      tone: 'warning',
      explanation: `You took ${Math.round(diagMeasurements)} diagnostic readings where the expert path needed ${expertM}.`,
    };
  } else if (!verifiedAfterRepair) {
    processVerdict = { label: 'Repaired, but not verified', tone: 'warning', explanation: 'You never proved the repair worked by operating the circuit.' };
  } else if (safety < 1) {
    processVerdict = { label: 'Effective diagnosis, with safety gaps', tone: 'warning', explanation: 'Your diagnosis was solid, but your isolation procedure had gaps.' };
  } else {
    processVerdict = { label: 'Effective, safe process', tone: 'success', explanation: 'Every repair was backed by evidence, and you followed a safe procedure from start to finish.' };
  }

  const outcomeLabel = working ? (diagScore >= 1 ? 'Fault found and repaired' : 'Circuit repaired, but the diagnosis was inaccurate') : 'Circuit still faulty';

  // ---------------- Skill evidence ----------------
  const ev: SkillEvidence[] = [];
  const push = (skillId: string, score: number, weight: number, reasons: string[]) => {
    if (weight <= 0) return;
    ev.push({ skillId, score: round(clamp(score), 3), weight: round(clamp(weight), 3), reasons });
  };
  push('elec.safety', safety, w('elec.safety') * (contactCount > 0 ? 1 : 0.4), [
    critical ? `${plural(critical, 'critical violation')}` : contactCount ? 'contact work done with the circuit isolated' : 'little contact work required',
    ...(noVerify.length ? ['skipped zero-energy verification'] : []),
  ]);
  push('elec.schematic', 0.3 * (totalReadings ? 1 - sameNode / totalReadings : 0.5) + 0.2 * informativeRatio + 0.5 * compScore, w('elec.schematic'), [
    compScore >= 1 ? 'identified the failed part correctly' : diag.length ? 'misidentified the failed part' : 'no diagnosis recorded',
  ]);
  if (voltageDiag > 0) {
    push('elec.voltage', 0.6 * (voltageInformative / voltageDiag) + 0.4 * (voltageInformative > 0 ? 1 : 0.3), w('elec.voltage'), [
      `${voltageInformative} of ${voltageDiag} voltage readings narrowed the fault`,
    ]);
  } else {
    push('elec.voltage', 0.2, w('elec.voltage') * (state.expert.deadPhase && state.expert.measurements > 0 && instance.templateId === 'elec.tripping-fuse' ? 0.3 : 1), [
      'no diagnostic voltage readings were taken',
    ]);
  }
  if (resistTests > 0) {
    push('elec.resistance', 0.5 * (resistInformative / resistTests) + 0.5 * (resistProper / resistTests), w('elec.resistance'), [
      `${resistProper} of ${resistTests} resistance/bench tests done on an isolated circuit`,
    ]);
  } else {
    push('elec.resistance', 0.3, w('elec.resistance') * (state.expert.deadPhase ? 1 : 0.2), ['no resistance or bench tests performed']);
  }
  const evidenceRatio = faultyRepairs > 0 ? evidenceRepairs.length / faultyRepairs : 0;
  push('elec.isolation', 0.55 * efficiency + 0.45 * evidenceRatio - (randomProbing ? 0.2 : 0), w('elec.isolation'), [
    `${Math.round(diagMeasurements)} diagnostic readings vs ${expertM} on the expert path`,
    evidenceRatio >= 1 ? 'repairs backed by evidence' : 'some repairs were guesses',
  ]);
  push('elec.repair', (working ? 0.4 : 0) + 0.3 * (1 - Math.min(1, replacedGood.length / 2)) + (verifiedAfterRepair ? 0.3 : 0), w('elec.repair'), [
    working ? 'circuit restored' : 'circuit not restored',
    replacedGood.length ? `${plural(replacedGood.length, 'unnecessary part')}` : 'no unnecessary parts',
    verifiedAfterRepair ? 'repair verified' : 'repair not verified',
  ]);

  // ---------------- Metrics ----------------
  const minimalCost = [...new Set(realFaults.map((f) => f.comp))].reduce((s, c) => s + (def.circuit.comps.find((x) => x.id === c)?.cost ?? 0), 0) +
    def.initial.blown.reduce((s, c) => s + (def.circuit.comps.find((x) => x.id === c)?.cost ?? 0), 0);
  const metrics = [
    { key: 'readings', label: 'Diagnostic readings', value: round(diagMeasurements, 1), benchmark: expertM, benchmarkLabel: 'expert path', better: 'lower' as const },
    { key: 'informative', label: 'Readings that narrowed the fault', value: diagMeasurements ? pct(informativeRatio) : 'n/a' },
    { key: 'parts', label: 'Parts replaced', value: state.replaced.length, benchmark: [...new Set(realFaults.map((f) => f.comp))].length + def.initial.blown.length, benchmarkLabel: 'needed', better: 'lower' as const },
    { key: 'cost', label: 'Parts cost', value: `$${state.partsCost}`, benchmark: `$${minimalCost}`, benchmarkLabel: 'minimum' },
    { key: 'safety', label: 'Safety issues', value: critical + notIsolated.length + noVerify.length + noLockout.length, benchmark: 0, benchmarkLabel: 'target', better: 'lower' as const },
    { key: 'time', label: 'Time on task', value: `${Math.floor(lastT / 60000)}:${String(Math.floor((lastT % 60000) / 1000)).padStart(2, '0')}` },
  ];

  // Ensure every action has a timeline entry
  const seen = new Set(timeline.map((t) => t.seq));
  for (const e of log) if (!seen.has(e.seq)) timeline.push({ seq: e.seq, verdict: 'neutral', note: '' });
  timeline.sort((x, y) => x.seq - y.seq);

  const groundDetails = realFaults.map((f) => f.detail);
  if (def.initial.blown.length) groundDetails.push(`${listJoin(def.initial.blown.map(label))} had blown because of this short. It needed replacing too, but only after the short was repaired.`);

  return {
    solved,
    outcomeLabel,
    accuracy,
    process,
    efficiency,
    safety,
    processVerdict,
    skillEvidence: ev,
    mistakes: [...mistakes.values()],
    strengths: [...strengths.values()],
    metrics,
    timeline,
    groundTruth: { summary: `Actual fault: ${listJoin(realFaults.map((f) => f.title))}`, details: groundDetails },
    expertPath: {
      summary: `An expert path needs about ${plural(expertM, 'diagnostic reading')}, chosen so each one splits the remaining possibilities.`,
      steps: state.expert.steps,
    },
  };
}
