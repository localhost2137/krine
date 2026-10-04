import type { Branch, Policy, Rule } from "./types";

export type Port = "then" | "on_false" | "on_unknown" | "on_verified";
export const ports: Port[] = ["then", "on_false", "on_unknown", "on_verified"];
export const portLabel: Record<Port, string> = { then: "If matched", on_false: "If not matched", on_unknown: "If unknown", on_verified: "If verified" };
export const challenges = (rule: Rule) => [rule.then, rule.on_false, rule.on_unknown].includes("CHALLENGE");
export const targetId = (branch: Branch, source: string) => typeof branch === "object" ? branch.goto : branch === "CHALLENGE" ? `$verify:${source}` : `$${branch.toLowerCase()}`;
export const branchLabel = (branch: Branch | "NEXT" | undefined, policy: Policy): string => {
  if (!branch) return "Not connected";
  if (typeof branch === "object") {
    const index = policy.rules.findIndex((r) => r.id === branch.goto);
    return index < 0 ? "Missing step" : `Step ${index + 1}`;
  }
  return ({ ALLOW: "Allow", DENY: "Deny", CHALLENGE: "Require verification", NEXT: "Continue to next rule" })[branch];
};
export function toWorkflow(policy: Policy): Policy {
  if (policy.schema_version === 2) return policy;
  return {
    ...policy, schema_version: 2, otherwise: "DENY",
    entry: policy.rules[0] ? { goto: policy.rules[0].id } : policy.otherwise,
    rules: policy.rules.map((rule, index) => {
      const next: Branch = policy.rules[index + 1] ? { goto: policy.rules[index + 1]!.id } : policy.otherwise;
      return { ...rule, on_false: next, on_unknown: rule.on_unknown === "NEXT" ? next : rule.on_unknown, ...(challenges(rule) ? { on_verified: next } : {}) };
    }),
  };
}
export function setBranch(policy: Policy, id: string, port: Port, branch: Branch): Policy {
  return { ...policy, rules: policy.rules.map((rule) => {
    if (rule.id !== id) return rule;
    const next = { ...rule, [port]: branch };
    if (challenges(next)) next.on_verified ??= "DENY";
    else delete next.on_verified;
    return next;
  }) };
}
export function removeStep(policy: Policy, id: string): Policy {
  const replace = (branch: Branch | "NEXT" | undefined) => typeof branch === "object" && branch.goto === id ? "DENY" as const : branch;
  return { ...policy, entry: replace(policy.entry) as Branch, rules: policy.rules.filter((r) => r.id !== id).map((rule) => ({ ...rule, then: replace(rule.then) as Branch, on_false: replace(rule.on_false) as Branch, on_unknown: replace(rule.on_unknown)!, ...(rule.on_verified ? { on_verified: replace(rule.on_verified) as Branch } : {}) })) };
}
export function reachableSteps(policy: Policy): Set<string> {
  const found = new Set<string>();
  function visit(branch: Branch | "NEXT" | undefined) {
    if (typeof branch !== "object" || !branch || found.has(branch.goto)) return;
    found.add(branch.goto);
    const rule = policy.rules.find((r) => r.id === branch.goto);
    if (rule) for (const port of ports) visit(rule[port]);
  }
  visit(policy.entry);
  return found;
}
export function workflowError(policy: Policy): string | null {
  if (policy.schema_version === 1) return null;
  if (policy.schema_version !== 2) return "Unsupported policy schema.";
  if (!policy.entry || policy.entry === "CHALLENGE" || policy.otherwise !== "DENY") return "Choose a workflow entry step or final decision.";
  const rules = new Map(policy.rules.map((r) => [r.id, r]));
  if (rules.size !== policy.rules.length || rules.size > 32) return "Use at most 32 steps with unique IDs.";
  const validBranch = (b: unknown, verification = true): b is Branch => b === "ALLOW" || b === "DENY" || (verification && b === "CHALLENGE") || (typeof b === "object" && b !== null && "goto" in b && typeof b.goto === "string" && Object.keys(b).length === 1 && rules.has(b.goto));
  if (!validBranch(policy.entry, false)) return "The entry connection refers to a missing step.";
  for (const rule of policy.rules) {
    if (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(rule.id)) return "Step IDs must be valid identifiers.";
    if (![rule.then, rule.on_false, rule.on_unknown].every((b) => validBranch(b))) return "Connect every matched, unmatched and unknown branch.";
    if (challenges(rule) ? !validBranch(rule.on_verified, false) : rule.on_verified !== undefined) return "Verification needs a success destination. Failed verification always denies.";
    if (rule.position && ![rule.position.x, rule.position.y].every((n) => Number.isFinite(n) && Math.abs(n) <= 10000)) return "Keep steps within the canvas bounds.";
  }
  const active = new Set<string>(), done = new Set<string>();
  function cycle(id: string): boolean {
    if (active.has(id)) return true;
    if (done.has(id)) return false;
    active.add(id);
    for (const port of ports) {
      const branch = rules.get(id)![port];
      if (typeof branch === "object" && cycle(branch.goto)) return true;
    }
    active.delete(id); done.add(id); return false;
  }
  return policy.rules.some((r) => cycle(r.id)) ? "This connection creates a loop. Workflows must end in a decision." : null;
}
