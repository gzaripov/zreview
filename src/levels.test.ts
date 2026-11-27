import { describe, expect, test } from "bun:test";
import { parseUnifiedDiff, type Feature, type Review } from "./build.ts";
import { alignment, decisionUnits, diffProblems, findings, levelProblems, type Behaviour } from "./levels.ts";
import { classify, decided } from "./serve.ts";

const DIFF = [
  "diff --git a/src/pay.spec.ts b/src/pay.spec.ts",
  "--- a/src/pay.spec.ts",
  "+++ b/src/pay.spec.ts",
  "@@ -1,2 +1,5 @@",
  " import { it } from 'bun:test';",
  "+it('refunds a paid order once', () => {",
  "+  expect(refund(order)).toBe(true);",
  "+});",
  " it('charges a card', () => {});",
].join("\n");
const MANIFEST_DIFF = [
  "diff --git a/app/package.json b/app/package.json",
  "--- a/app/package.json",
  "+++ b/app/package.json",
  "@@ -1,2 +1,3 @@",
  " {",
  '+  "dependencies": { "stripe": "17.0.0" },',
  " }",
].join("\n");

const behaviour = (over: Partial<Behaviour> = {}): Behaviour => ({
  id: "B1", title: "A paid order is refunded once",
  when: ["the customer asks for a refund"], then: ["the money goes back"],
  checks: ["R1"], evidence: { by: "test", file: "src/pay.spec.ts", name: "refunds a paid order once" },
  ...over,
});
const feature = (over: Partial<Feature> = {}): Feature => ({
  id: "refund", title: "Refund", scenario: "A customer gets the money back.", description: "",
  serves: ["G1"],
  rules: [{ id: "R1", text: "A paid order can be refunded once.", source: "stated", from: "ticket" }],
  behaviours: [behaviour()],
  ...over,
});
const review = (over: Partial<Review> = {}, ...features: Feature[]): Review => ({
  pr: { repo: "o/r", title: "Refunds" },
  purpose: { summary: "Customers can get refunds.", goals: [{ id: "G1", text: "A customer can undo a payment.", source: "stated", from: "ticket" }] },
  libraries: [],
  features: features.length ? features : [feature()],
  ...over,
});
const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");

describe("levelProblems", () => {
  test("a review without a purpose is not layered, and is decided feature by feature", () => {
    const plain: Review = { pr: { repo: "o/r", title: "t" }, features: [{ id: "a", title: "a", scenario: "", description: "" }] };
    expect(levelProblems(plain)).toEqual([]);
    expect(decisionUnits(plain)).toEqual(["a"]);
  });

  test("a well-formed layered review passes, and is decided level by level", () => {
    expect(levelProblems(review())).toEqual([]);
    expect(decisionUnits(review())).toEqual(["@high", "@mid", "@low"]);
  });

  test("a feature that serves no goal needs a goal or a reason", () => {
    expect(levelProblems(review({}, feature({ serves: undefined })))).toEqual([
      `feature refund: serves no goal — list the goals in "serves", or say in "derived" why it is here though none asks for it`,
    ]);
    expect(levelProblems(review({}, feature({ serves: undefined, derived: "Cleanup the refund needed." })))).toEqual([]);
  });

  test("a behaviour that checks no rule needs a rule or a reason", () => {
    expect(levelProblems(review({}, feature({ behaviours: [behaviour({ checks: undefined })] })))).toEqual([
      `feature refund behaviour B1: checks no rule — list the rules in "checks", or say in "derived" why it is here though none asks for it`,
    ]);
    expect(levelProblems(review({}, feature({ behaviours: [behaviour({ checks: undefined, derived: "A tester would try it." })] })))).toEqual([]);
  });

  test("a reference to something that is not there is refused", () => {
    expect(levelProblems(review({}, feature({ serves: ["G9"] })))).toEqual([`feature refund: serves "G9", which is no goal or non-goal of this review`]);
    expect(levelProblems(review({}, feature({ behaviours: [behaviour({ checks: ["R9"] })] })))).toEqual([
      `feature refund behaviour B1: checks "R9", which is no rule of this review`,
    ]);
  });

  test("an id names one thing across the levels", () => {
    const twice = feature({ rules: [{ id: "G1", text: "A paid order can be refunded once.", source: "inferred" }], behaviours: [behaviour({ checks: ["G1"] })] });
    expect(levelProblems(review({}, twice))).toEqual([`feature refund rule G1: id G1 is already purpose goal G1`]);
  });

  test("every level has a size it may not outgrow", () => {
    const long = review({ purpose: { summary: "Refunds.", goals: [{ id: "G1", text: words(31), source: "inferred" }] } });
    expect(levelProblems(long)).toEqual([`purpose goal G1: 31 words, and a goal takes at most 30`]);
    const rules = Array.from({ length: 8 }, (_, i) => ({ id: `R${i + 1}`, text: "A rule.", source: "inferred" as const }));
    expect(levelProblems(review({}, feature({ rules })))).toEqual([`feature refund: 8 rules, and a feature takes at most 7 — split the feature or merge rules`]);
    const steps = behaviour({ given: ["one paid order", "two paid orders", "a closed till"], when: ["the first is refunded", "the second is refunded", "the till opens"], then: ["both are paid back", "the till balances"] });
    expect(levelProblems(review({}, feature({ behaviours: [steps] })))).toEqual([`feature refund behaviour B1: 8 steps, and a behaviour takes at most 7`]);
  });

  test("a behaviour whose title says it all needs no steps", () => {
    const bare = behaviour({ when: undefined, then: undefined });
    expect(levelProblems(review({}, feature({ behaviours: [bare] })))).toEqual([]);
    const outcome = behaviour({ when: undefined, then: ["the card statement shows one credit"] });
    expect(levelProblems(review({}, feature({ behaviours: [outcome] })))).toEqual([]);
    expect(levelProblems(review({}, feature({ behaviours: [behaviour({ then: [] })] })))).toEqual([
      `feature refund behaviour B1: then is a list of steps — leave it out when the title already says it`,
    ]);
  });

  test("a given that sets nothing up is refused", () => {
    expect(levelProblems(review({}, feature({ behaviours: [behaviour({ given: ["a customer"] })] })))).toEqual([
      `feature refund behaviour B1: given "a customer" sets nothing up — say what must be true of it, or drop the line`,
    ]);
    expect(levelProblems(review({}, feature({ behaviours: [behaviour({ given: ["a customer with a paid order"] })] })))).toEqual([]);
    expect(levelProblems(review({}, feature({ behaviours: [behaviour({ given: ["оплаченный заказ"] })] })))).toEqual([]);
  });

  test("steps that only repeat the title are refused", () => {
    const echo = behaviour({ when: ["an order is paid"], then: ["the order is refunded once"] });
    expect(levelProblems(review({}, feature({ behaviours: [echo] })))).toEqual([
      `feature refund behaviour B1: its steps repeat its title — keep only the steps that say more, or none`,
    ]);
  });

  test("a statement says where it comes from", () => {
    const unsourced = feature({ rules: [{ id: "R1", text: "A paid order can be refunded once.", source: "stated" }] });
    expect(levelProblems(review({}, unsourced))).toEqual([`feature refund rule R1: a stated rule names where it is stated, in "from"`]);
  });

  test("evidence says how the behaviour is known", () => {
    const unnamed = behaviour({ evidence: { by: "test", file: "src/pay.spec.ts" } });
    expect(levelProblems(review({}, feature({ behaviours: [unnamed] })))).toEqual([`feature refund behaviour B1: evidence by test names the test's file and its name`]);
    const unseen = behaviour({ evidence: { by: "reading" } });
    expect(levelProblems(review({}, feature({ behaviours: [unseen] })))).toEqual([`feature refund behaviour B1: evidence by reading says in "note" what was seen and where`]);
    expect(levelProblems(review({}, feature({ behaviours: [behaviour({ evidence: { by: "none" } })] })))).toEqual([]);
  });

  test("a behaviour can carry a capture of its case, with a caption", () => {
    const shown = behaviour({ screenshots: { after: "refund.png", caption: "The order page after the refund." } });
    expect(levelProblems(review({}, feature({ behaviours: [shown] })))).toEqual([]);
    const empty = behaviour({ screenshots: { caption: "The order page after the refund." } });
    expect(levelProblems(review({}, feature({ behaviours: [empty] })))).toEqual([
      `feature refund behaviour B1: screenshots names an image file in "before", "after" or both — leave it out when there is no capture of this case`,
    ]);
    const silent = behaviour({ screenshots: { before: "order.png", after: "refund.png" } });
    expect(levelProblems(review({}, feature({ behaviours: [silent] })))).toEqual([
      `feature refund behaviour B1: its screenshots need a caption that says what the capture shows of this case`,
    ]);
  });

  test("a PR that touches no goal says why, and is decided on two levels", () => {
    const fix = review({ purpose: { absent: "A bug fix: refunds rounded the wrong way." } }, feature({ serves: undefined }));
    expect(levelProblems(fix)).toEqual([]);
    expect(decisionUnits(fix)).toEqual(["@mid", "@low"]);
    const both = review({ purpose: { absent: "A bug fix.", goals: [{ id: "G1", text: "A goal.", source: "inferred" }] } }, feature({ serves: undefined }));
    expect(levelProblems(both)).toEqual([`purpose: it is absent or it has goals, not both`]);
  });

  test("libraries are listed even when there are none", () => {
    expect(levelProblems(review({ libraries: undefined }))).toEqual([
      `libraries: the libraries and frameworks this PR adds, upgrades or removes — [] when none`,
    ]);
  });
});

describe("diffProblems", () => {
  const withEvidence = (evidence: Behaviour["evidence"]) => review({}, feature({ behaviours: [behaviour({ evidence })] }));

  test("a test the PR adds is found in its diff", () => {
    expect(diffProblems(review(), parseUnifiedDiff(DIFF))).toEqual([]);
  });

  test("a test the diff does not have is refused", () => {
    expect(diffProblems(withEvidence({ by: "test", file: "src/pay.spec.ts", name: "refunds twice" }), parseUnifiedDiff(DIFF))).toEqual([
      `feature refund behaviour B1: the diff of src/pay.spec.ts has no line with "refunds twice" — name the test as the diff spells it, or set "existing": true`,
    ]);
    expect(diffProblems(withEvidence({ by: "test", file: "src/other.spec.ts", name: "refunds a paid order once" }), parseUnifiedDiff(DIFF))).toEqual([
      `feature refund behaviour B1: its test file src/other.spec.ts is not changed in this PR — set "existing": true if the test was already there`,
    ]);
  });

  test("a test that was already there is taken on the author's word", () => {
    expect(diffProblems(withEvidence({ by: "test", file: "src/other.spec.ts", name: "charges a card", existing: true }), parseUnifiedDiff(DIFF))).toEqual([]);
  });

  test("a changed package manifest needs its libraries listed, or a reason there are none", () => {
    const diffs = parseUnifiedDiff(`${DIFF}\n${MANIFEST_DIFF}`);
    expect(diffProblems(review(), diffs)).toEqual([
      `libraries: app/package.json changed and no library is listed — list what it adds, upgrades or removes, or say in "librariesNote" why none`,
    ]);
    expect(diffProblems(review({ librariesNote: "Only a script was renamed." }), diffs)).toEqual([]);
    expect(diffProblems(review({ libraries: [{ name: "stripe", why: "Refunds go through it." }] }), diffs)).toEqual([]);
  });
});

describe("alignment", () => {
  test("it reports what nothing serves, what nothing checks and what is only derived", () => {
    const loose = review(
      { purpose: { summary: "Refunds.", goals: [{ id: "G1", text: "Undo a payment.", source: "inferred" }, { id: "G2", text: "Refund in any currency.", source: "inferred" }] } },
      feature({
        rules: [
          { id: "R1", text: "A paid order can be refunded once.", source: "inferred" },
          { id: "R2", text: "A refund is logged.", source: "inferred", derived: "Support asked for it in passing." },
        ],
        behaviours: [behaviour(), behaviour({ id: "B2", checks: undefined, derived: "A tester would try it.", evidence: { by: "none" } })],
      }),
    );
    expect(levelProblems(loose)).toEqual([]);
    const found = alignment(loose, parseUnifiedDiff(DIFF));
    expect(found).toEqual({
      unserved: ["G2"],
      unchecked: ["R2"],
      derived: [{ id: "R2", level: "mid", why: "Support asked for it in passing." }, { id: "B2", level: "low", why: "A tester would try it." }],
      evidence: { test: 1, stand: 0, reading: 0, none: 1 },
      manifests: [],
    });
    expect(findings(loose, found)).toEqual([
      "levels: 2 goals and 0 non-goals, 2 rules, 2 behaviours",
      "alignment: nothing serves G2",
      "alignment: no behaviour checks R2",
      "alignment: 2 derived, for the reviewer to keep or drop: R2, B2",
      "evidence: 1 by a test, 0 on a stand, 0 by reading, 1 not covered",
    ]);
  });

  test("a rule serves a goal on its own, whatever its feature serves", () => {
    const own = review(
      { purpose: { summary: "Refunds.", goals: [{ id: "G1", text: "Undo a payment.", source: "inferred" }], nonGoals: [{ id: "N1", text: "Partial refunds.", source: "inferred" }] } },
      feature({ rules: [{ id: "R1", text: "A refund is always for the whole order.", source: "inferred", serves: ["N1"] }] }),
    );
    expect(levelProblems(own)).toEqual([]);
    expect(alignment(own).unserved).toEqual([]);
  });
});

describe("classify", () => {
  const approved = { decision: "approved" as const };
  const changes = { decision: "changes" as const };

  test("a layered review is approved when every level is", () => {
    expect(classify(review(), { "@high": approved, "@mid": approved })).toBe("incomplete");
    expect(classify(review(), { "@high": approved, "@mid": approved, "@low": approved })).toBe("approved");
  });

  test("changes asked for on a level or on the code win", () => {
    expect(classify(review(), { "@high": approved, "@mid": changes, "@low": approved })).toBe("changes");
    expect(classify(review(), { "@high": approved, "@mid": approved, "@low": approved, refund: changes })).toBe("changes");
  });

  test("a review with no high level is approved on the two it has", () => {
    const fix = review({ purpose: { absent: "A bug fix." } }, feature({ serves: undefined }));
    expect(classify(fix, { "@mid": approved, "@low": approved })).toBe("approved");
  });

  test("a review without levels is still decided feature by feature", () => {
    const plain: Review = { pr: { repo: "o/r", title: "t" }, features: [{ id: "a", title: "a", scenario: "", description: "" }] };
    expect(classify(plain, { a: approved })).toBe("approved");
    expect(classify(plain, {})).toBe("incomplete");
  });
});

describe("decided", () => {
  test("a level that is half read still counts as decided on", () => {
    const state = {
      "@high": { decision: "approved" as const },
      "@mid": { rows: { R1: { d: "ok" as const } } },
      "@low": { rows: { B1: { was: "ok" as const } }, comments: [{}] },
      refund: { viewed: { "src/pay.ts": "abc" } },
    };
    expect(Object.keys(decided(state))).toEqual(["@high", "@mid"]);
  });
});
