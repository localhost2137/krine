import { describe, expect, it } from "vitest";
import { policyChanges, policyError } from "./policy";
import { reachableSteps, removeStep, setBranch, toWorkflow, workflowError } from "./workflow";
import type { Policy } from "./types";
const legacy: Policy = { schema_version: 1, inputs: { trusted: "boolean" }, otherwise: "ALLOW", rules: [
  { id: "a", condition: { op: "known", value: { source: "input", name: "trusted" } }, then: "CHALLENGE", on_unknown: "NEXT" },
  { id: "b", condition: { op: "known", value: { source: "input", name: "trusted" } }, then: "DENY", on_unknown: "DENY" },
] };
describe("workflow contracts", () => {
  it("converts legacy order, unknown continuation, verification and final fallback without mutating the published policy", () => {
    const converted = toWorkflow(legacy);
    expect(converted.entry).toEqual({ goto: "a" });
    expect(converted.rules[0]).toMatchObject({ then: "CHALLENGE", on_false: { goto: "b" }, on_unknown: { goto: "b" }, on_verified: { goto: "b" } });
    expect(converted.rules[1]!.on_false).toBe("ALLOW");
    expect(converted.otherwise).toBe("DENY");
    expect(legacy.schema_version).toBe(1);
    expect(workflowError(converted)).toBeNull();
    expect(policyChanges(legacy, converted).join(" ")).toContain("Convert ordered rules");
  });
  it("rejects cycles, nonexistent destinations and missing verification routes", () => {
    const p = toWorkflow(legacy);
    expect(workflowError(setBranch(p, "b", "then", { goto: "a" }))).toContain("loop");
    expect(policyError(setBranch(p, "b", "then", { goto: "missing" }))).toContain("Connect every");
    const broken = structuredClone(p); delete broken.rules[0]!.on_verified;
    expect(workflowError(broken)).toContain("Verification needs");
  });
  it("rewires incoming branches to Deny on removal, and removes unused verification continuations", () => {
    const p = toWorkflow(legacy);
    const removed = removeStep(p, "b");
    expect(removed.rules[0]).toMatchObject({ on_false: "DENY", on_unknown: "DENY", on_verified: "DENY" });
    const withoutVerification = setBranch(removed, "a", "then", "ALLOW");
    expect(withoutVerification.rules[0]!.on_verified).toBeUndefined();
    expect(workflowError(withoutVerification)).toBeNull();
    expect(removeStep(withoutVerification, "a").entry).toBe("DENY");
  });
  it("follows explicit destinations regardless of array order and reports unreachable steps", () => {
    const p = toWorkflow(legacy);
    p.rules.reverse();
    expect([...reachableSteps(p)]).toEqual(["a", "b"]);
    expect(workflowError(p)).toBeNull();
    expect(reachableSteps({ ...p, entry: "DENY" }).size).toBe(0);
  });
});
