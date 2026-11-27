import type { Feature, FileDiff, Review, Shots } from "./build.ts";

export type Provenance = "stated" | "decided" | "inferred";
export type Statement = { id: string; text: string; source: Provenance; from?: string; flag?: string };
export type Rule = Statement & { serves?: string[]; derived?: string };
export type Evidence = { by: "test" | "stand" | "reading" | "none"; file?: string; name?: string; existing?: boolean; note?: string };
export type Behaviour = {
  id: string; title: string; kind?: "main" | "edge" | "error";
  given?: string[]; when?: string[]; then?: string[];
  checks?: string[]; derived?: string; flag?: string; evidence: Evidence;
  screenshots?: Shots;
};
export type Purpose = {
  absent?: string;
  summary?: string; domain?: string;
  goals?: Statement[]; nonGoals?: Statement[];
  sources?: { label: string; url?: string; read: boolean; note?: string }[];
};
export type Library = { name: string; version?: string; change?: "added" | "upgraded" | "removed"; why: string; where?: string };
export type Alignment = {
  unserved: string[];
  derived: { id: string; level: "mid" | "low"; why: string }[];
  unchecked: string[];
  evidence: Record<Evidence["by"], number>;
  manifests: string[];
};

export const LEVEL_IDS = ["@high", "@mid", "@low"] as const;
export const LIMITS = {
  summary: 50, domain: 50, statement: 30, goals: 5, nonGoals: 5,
  scenario: 60, rule: 35, rules: 7,
  title: 14, step: 25, steps: 7, behaviours: 10,
  flag: 35, why: 35,
};

const PROVENANCE: readonly string[] = ["stated", "decided", "inferred"];
const KINDS: readonly string[] = ["main", "edge", "error"];
const EVIDENCE: readonly string[] = ["test", "stand", "reading", "none"];
const ID = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const MANIFEST = /^(package\.json|go\.mod|cargo\.toml|pyproject\.toml|requirements.*\.txt|pipfile|gemfile|pom\.xml|build\.gradle(\.kts)?|composer\.json|package\.swift|pubspec\.ya?ml|mix\.exs|.*\.csproj)$/i;

export const isLayered = (review: Review) => "purpose" in review;
export const wordCount = (text: unknown) => (typeof text === "string" ? text.trim().split(/\s+/).filter(Boolean).length : 0);
const filled = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const texts = (value: unknown): value is string[] => Array.isArray(value) && value.every(filled);
const SMALL_WORDS = new Set("a an the this that these those some any each every its their his her of to in on at by for from with as and or but is are was were be been it they then when given".split(" "));
const stem = (word: string) => word.replace(/'s$/, "").replace(/(ing|ed|es|s)$/, "");
const contentWords = (text: string) =>
  (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'_.-]*/gu) ?? []).map((w) => w.replace(/[.'-]+$/, "")).filter((w) => w && !SMALL_WORDS.has(w)).map(stem);

export function decisionUnits(review: Review): string[] {
  if (!isLayered(review)) return review.features.map((f) => f.id);
  return review.purpose?.absent ? ["@mid", "@low"] : [...LEVEL_IDS];
}

export function levelProblems(review: Review): string[] {
  if (!isLayered(review)) return [];
  const problems: string[] = [];
  const seen = new Map<string, string>();
  const claim = (id: unknown, where: string) => {
    if (typeof id !== "string" || !ID.test(id)) { problems.push(`${where}: needs an id of letters, digits, dots and dashes, starting with a letter`); return; }
    const earlier = seen.get(id);
    if (earlier) problems.push(`${where}: id ${id} is already ${earlier}`);
    else seen.set(id, where);
  };
  const budget = (where: string, what: string, text: unknown, max: number) => {
    const n = wordCount(text);
    if (n > max) problems.push(`${where}: ${n} words, and ${what} takes at most ${max}`);
  };
  const statement = (s: Statement, where: string, max: number, what: string) => {
    if (!filled(s?.text)) { problems.push(`${where}: needs text`); return; }
    budget(where, what, s.text, max);
    if (!PROVENANCE.includes(s.source)) problems.push(`${where}: source must say where it comes from: stated, decided or inferred`);
    else if (s.source === "stated" && !filled(s.from)) problems.push(`${where}: a stated ${what.replace(/^an? /, "")} names where it is stated, in "from"`);
    if (s.flag !== undefined) budget(`${where} flag`, "a flag", s.flag, LIMITS.flag);
  };

  const purpose = review.purpose;
  const goalIds = new Set<string>(), parentIds = new Set<string>();
  if (!purpose || typeof purpose !== "object") {
    problems.push(`purpose: the high level, as { "summary", "goals" }, or { "absent": "why this PR has none" }`);
  } else if (purpose.absent !== undefined) {
    if (!filled(purpose.absent)) problems.push(`purpose.absent: say why this PR touches no goal`);
    if (purpose.goals?.length || purpose.nonGoals?.length) problems.push(`purpose: it is absent or it has goals, not both`);
  } else {
    if (!filled(purpose.summary)) problems.push(`purpose.summary: one or two sentences on why this PR exists`);
    budget("purpose.summary", "the summary", purpose.summary, LIMITS.summary);
    budget("purpose.domain", "the domain", purpose.domain, LIMITS.domain);
    if (!Array.isArray(purpose.goals) || !purpose.goals.length) problems.push(`purpose.goals: at least one goal, or { "absent": "…" } when the PR touches none`);
    for (const [key, what, max] of [["goals", "a goal", LIMITS.goals], ["nonGoals", "a non-goal", LIMITS.nonGoals]] as const) {
      const list = purpose[key] ?? [];
      if (!Array.isArray(list)) { problems.push(`purpose.${key}: a list`); continue; }
      if (list.length > max) problems.push(`purpose.${key}: ${list.length} of them, and the high level takes at most ${max}`);
      for (const s of list) {
        const where = `purpose ${what.replace(/^an? /, "")} ${s?.id ?? "?"}`;
        claim(s?.id, where);
        statement(s, where, LIMITS.statement, what);
        if (typeof s?.id === "string") { parentIds.add(s.id); if (key === "goals") goalIds.add(s.id); }
      }
    }
    for (const [i, s] of (purpose.sources ?? []).entries()) {
      if (!filled(s?.label) || typeof s?.read !== "boolean") problems.push(`purpose.sources ${i + 1}: a label, and "read": true or false`);
    }
  }

  const absent = !!purpose?.absent;
  const parents = (list: unknown, where: string) => {
    if (list === undefined) return;
    if (!Array.isArray(list) || !list.length) { problems.push(`${where}: "serves" lists goal or non-goal ids`); return; }
    for (const id of list) if (!parentIds.has(id)) problems.push(`${where}: serves ${JSON.stringify(id)}, which is no goal or non-goal of this review`);
  };

  const ruleIds = new Set<string>();
  for (const f of review.features ?? []) {
    const fw = `feature ${f.id}`;
    if (typeof f.id === "string" && f.id.startsWith("@")) problems.push(`${fw}: an id starting with @ is a level's`);
    const earlier = seen.get(f.id);
    if (earlier) problems.push(`${fw}: id ${f.id} is already ${earlier}`);
    else seen.set(f.id, fw);
    budget(`${fw} scenario`, "a scenario", f.scenario, LIMITS.scenario);
    parents(f.serves, fw);
    if (f.derived !== undefined && !filled(f.derived)) problems.push(`${fw}: "derived" says why it is here though no goal asks for it`);
    if (!absent && !f.serves?.length && !filled(f.derived)) {
      problems.push(`${fw}: serves no goal — list the goals in "serves", or say in "derived" why it is here though none asks for it`);
    }
    if (!Array.isArray(f.rules) || !f.rules.length) problems.push(`${fw}: needs rules — how the product behaves, in product words`);
    else if (f.rules.length > LIMITS.rules) problems.push(`${fw}: ${f.rules.length} rules, and a feature takes at most ${LIMITS.rules} — split the feature or merge rules`);
    for (const r of Array.isArray(f.rules) ? f.rules : []) {
      const where = `${fw} rule ${r?.id ?? "?"}`;
      claim(r?.id, where);
      statement(r, where, LIMITS.rule, "a rule");
      parents(r?.serves, where);
      if (r?.derived !== undefined) { if (!filled(r.derived)) problems.push(`${where}: "derived" says why it is here though no goal asks for it`); else budget(`${where} derived`, "a reason", r.derived, LIMITS.why); }
      if (typeof r?.id === "string") ruleIds.add(r.id);
    }
  }

  for (const f of review.features ?? []) {
    const fw = `feature ${f.id}`;
    if (f.behaviours !== undefined && !Array.isArray(f.behaviours)) { problems.push(`${fw}: behaviours is a list`); continue; }
    const list = f.behaviours ?? [];
    if (list.length > LIMITS.behaviours) problems.push(`${fw}: ${list.length} behaviours, and a feature takes at most ${LIMITS.behaviours} — keep the cases a tester would not guess`);
    for (const b of list) {
      const where = `${fw} behaviour ${b?.id ?? "?"}`;
      claim(b?.id, where);
      if (!filled(b?.title)) problems.push(`${where}: needs a title`);
      budget(`${where} title`, "a title", b?.title, LIMITS.title);
      if (b?.kind !== undefined && !KINDS.includes(b.kind)) problems.push(`${where}: kind is main, edge or error`);
      for (const key of ["given", "when", "then"] as const) {
        const list: unknown = b?.[key];
        if (list !== undefined && (!texts(list) || !list.length)) problems.push(`${where}: ${key} is a list of steps — leave it out when the title already says it`);
      }
      const steps = [b?.given, b?.when, b?.then].flatMap((s) => (texts(s) ? s : []));
      if (steps.length > LIMITS.steps) problems.push(`${where}: ${steps.length} steps, and a behaviour takes at most ${LIMITS.steps}`);
      for (const step of steps) budget(`${where} step "${step.slice(0, 32)}…"`, "a step", step, LIMITS.step);
      for (const step of texts(b?.given) ? b.given : []) {
        if (contentWords(step).length < 2) problems.push(`${where}: given ${JSON.stringify(step)} sets nothing up — say what must be true of it, or drop the line`);
      }
      if (steps.length && filled(b?.title)) {
        const title = new Set(contentWords(b.title)), said = steps.flatMap(contentWords);
        if (said.length && said.every((w) => title.has(w))) problems.push(`${where}: its steps repeat its title — keep only the steps that say more, or none`);
      }
      if (b?.checks !== undefined && (!Array.isArray(b.checks) || !b.checks.length)) problems.push(`${where}: "checks" lists rule ids`);
      for (const id of Array.isArray(b?.checks) ? b.checks : []) {
        if (!ruleIds.has(id)) problems.push(`${where}: checks ${JSON.stringify(id)}, which is no rule of this review`);
      }
      if (b?.derived !== undefined) { if (!filled(b.derived)) problems.push(`${where}: "derived" says why it is here though no rule asks for it`); else budget(`${where} derived`, "a reason", b.derived, LIMITS.why); }
      if (!b?.checks?.length && !filled(b?.derived)) {
        problems.push(`${where}: checks no rule — list the rules in "checks", or say in "derived" why it is here though none asks for it`);
      }
      if (b?.flag !== undefined) budget(`${where} flag`, "a flag", b.flag, LIMITS.flag);
      if (b?.screenshots !== undefined) {
        const shots: Shots | null = b.screenshots;
        const path = (v: unknown) => v === undefined || filled(v);
        if (!shots || typeof shots !== "object" || Array.isArray(shots) || !path(shots.before) || !path(shots.after) || !(filled(shots.before) || filled(shots.after))) {
          problems.push(`${where}: screenshots names an image file in "before", "after" or both — leave it out when there is no capture of this case`);
        } else if (!filled(shots.caption)) problems.push(`${where}: its screenshots need a caption that says what the capture shows of this case`);
        else budget(`${where} screenshots caption`, "a caption", shots.caption, LIMITS.why);
      }
      const e = b?.evidence;
      if (!e || !EVIDENCE.includes(e.by)) problems.push(`${where}: evidence.by says how it is known: test, stand, reading or none`);
      else if (e.by === "test" && (!filled(e.file) || !filled(e.name))) problems.push(`${where}: evidence by test names the test's file and its name`);
      else if ((e.by === "stand" || e.by === "reading") && !filled(e.note)) problems.push(`${where}: evidence by ${e.by} says in "note" what was seen and where`);
    }
  }

  if (!Array.isArray(review.libraries)) problems.push(`libraries: the libraries and frameworks this PR adds, upgrades or removes — [] when none`);
  else for (const [i, lib] of review.libraries.entries()) {
    const where = `libraries ${lib?.name ?? i + 1}`;
    if (!filled(lib?.name) || !filled(lib?.why)) problems.push(`${where}: a name, and why it is here`);
    budget(`${where} why`, "a reason", lib?.why, LIMITS.why);
  }
  return problems;
}

export function diffProblems(review: Review, diffs: Map<string, FileDiff>): string[] {
  if (!isLayered(review)) return [];
  const problems: string[] = [];
  for (const f of review.features ?? []) {
    for (const b of f.behaviours ?? []) {
      const e = b.evidence;
      if (e?.by !== "test" || e.existing) continue;
      const where = `feature ${f.id} behaviour ${b.id}`;
      const diff = diffs.get(e.file!);
      if (!diff) { problems.push(`${where}: its test file ${e.file} is not changed in this PR — set "existing": true if the test was already there`); continue; }
      const found = diff.hunks.some((h) => h.lines.some((l) => l.t !== "-" && l.text.includes(e.name!)));
      if (!found) problems.push(`${where}: the diff of ${e.file} has no line with ${JSON.stringify(e.name)} — name the test as the diff spells it, or set "existing": true`);
    }
  }
  const manifests = changedManifests(diffs);
  if (manifests.length && !review.libraries?.length && !filled(review.librariesNote)) {
    problems.push(`libraries: ${manifests.join(", ")} changed and no library is listed — list what it adds, upgrades or removes, or say in "librariesNote" why none`);
  }
  return problems;
}

export const changedManifests = (diffs: Map<string, FileDiff>) =>
  [...diffs.keys()].filter((path) => MANIFEST.test(path.slice(path.lastIndexOf("/") + 1))).sort();

export function alignment(review: Review, diffs?: Map<string, FileDiff> | null): Alignment {
  const goals = review.purpose?.goals ?? [];
  const served = new Set<string>();
  const derived: Alignment["derived"] = [];
  const checked = new Set<string>();
  const evidence: Alignment["evidence"] = { test: 0, stand: 0, reading: 0, none: 0 };
  const rules: string[] = [];
  for (const f of review.features as Feature[]) {
    for (const id of f.serves ?? []) served.add(id);
    if (f.derived) derived.push({ id: f.id, level: "mid", why: f.derived });
    for (const r of f.rules ?? []) {
      rules.push(r.id);
      for (const id of r.serves ?? []) served.add(id);
      if (r.derived) derived.push({ id: r.id, level: "mid", why: r.derived });
    }
    for (const b of f.behaviours ?? []) {
      for (const id of b.checks ?? []) checked.add(id);
      if (b.derived) derived.push({ id: b.id, level: "low", why: b.derived });
      evidence[b.evidence.by]++;
    }
  }
  return {
    unserved: goals.map((g) => g.id).filter((id) => !served.has(id)),
    derived,
    unchecked: rules.filter((id) => !checked.has(id)),
    evidence,
    manifests: diffs ? changedManifests(diffs) : [],
  };
}

export function findings(review: Review, a: Alignment): string[] {
  if (!isLayered(review)) return [];
  const rules = review.features.reduce((n, f) => n + (f.rules?.length ?? 0), 0);
  const behaviours = review.features.reduce((n, f) => n + (f.behaviours?.length ?? 0), 0);
  const p = review.purpose!;
  const out = [p.absent
    ? `levels: no high level (${p.absent}), ${rules} rules, ${behaviours} behaviours`
    : `levels: ${p.goals?.length ?? 0} goals and ${p.nonGoals?.length ?? 0} non-goals, ${rules} rules, ${behaviours} behaviours`];
  if (a.unserved.length) out.push(`alignment: nothing serves ${a.unserved.join(", ")}`);
  if (a.unchecked.length) out.push(`alignment: no behaviour checks ${a.unchecked.join(", ")}`);
  if (a.derived.length) out.push(`alignment: ${a.derived.length} derived, for the reviewer to keep or drop: ${a.derived.map((d) => d.id).join(", ")}`);
  out.push(`evidence: ${a.evidence.test} by a test, ${a.evidence.stand} on a stand, ${a.evidence.reading} by reading, ${a.evidence.none} not covered`);
  return out;
}
