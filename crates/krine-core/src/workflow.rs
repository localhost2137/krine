//! Schema 2 routes by stable step ID. Array order and canvas positions are presentation only.
use std::collections::{BTreeMap, BTreeSet};

use crate::{
    DecisionReason, Evaluation, FinalAction, Outcome, Policy, Route, Rule, RuleAction, RuleTrace,
    Snapshot, Truth, UnknownAction, ValidationError, Verification,
    policy::{evaluate_condition, invalid},
};

fn targets(rule: &Rule) -> Vec<&str> {
    let mut targets = Vec::new();
    for action in [
        Some(&rule.then),
        rule.on_false.as_ref(),
        rule.on_verified.as_ref(),
    ]
    .into_iter()
    .flatten()
    {
        if let RuleAction::GoTo(id) = action {
            targets.push(id.as_str());
        }
    }
    if let UnknownAction::GoTo(id) = &rule.on_unknown {
        targets.push(id.as_str());
    }
    targets
}

pub(crate) fn validate(policy: &Policy) -> Result<(), ValidationError> {
    if policy.schema_version == 1 {
        if policy.entry.is_some()
            || policy.rules.iter().any(|r| {
                r.on_false.is_some()
                    || r.on_verified.is_some()
                    || r.position.is_some()
                    || matches!(r.then, RuleAction::GoTo(_))
                    || matches!(r.on_unknown, UnknownAction::GoTo(_) | UnknownAction::Allow)
            })
        {
            return Err(invalid(
                "schema_version",
                "explicit branches require policy schema 2",
            ));
        }
        return Ok(());
    }
    let rules: BTreeMap<_, _> = policy.rules.iter().map(|r| (r.id.as_str(), r)).collect();
    match &policy.entry {
        Some(RuleAction::Allow | RuleAction::Deny) => {}
        Some(RuleAction::GoTo(id)) if rules.contains_key(id.as_str()) => {}
        _ => {
            return Err(invalid(
                "entry",
                "workflow entry must be an existing step, ALLOW or DENY",
            ));
        }
    }
    if policy.otherwise != FinalAction::Deny {
        return Err(invalid(
            "otherwise",
            "schema 2 uses explicit branches; otherwise must remain DENY",
        ));
    }
    for rule in &policy.rules {
        let path = format!("rules.{}", rule.id);
        if rule.on_false.is_none() || rule.on_unknown == UnknownAction::Next {
            return Err(invalid(
                &path,
                "every workflow step needs explicit true, false and unknown branches",
            ));
        }
        let challenges = rule.then == RuleAction::Challenge
            || rule.on_false == Some(RuleAction::Challenge)
            || rule.on_unknown == UnknownAction::Challenge;
        if challenges != rule.on_verified.is_some()
            || rule.on_verified == Some(RuleAction::Challenge)
        {
            return Err(invalid(
                &path,
                "verification requires one explicit success destination; failures always deny",
            ));
        }
        if rule.position.is_some_and(|p| {
            !p.x.is_finite() || !p.y.is_finite() || p.x.abs() > 10000.0 || p.y.abs() > 10000.0
        }) {
            return Err(invalid(
                &path,
                "canvas coordinates must be finite and within -10000 to 10000",
            ));
        }
        if targets(rule).iter().any(|id| !rules.contains_key(id)) {
            return Err(invalid(&path, "branch refers to a missing workflow step"));
        }
    }
    fn visit<'a>(
        id: &'a str,
        rules: &BTreeMap<&'a str, &'a Rule>,
        active: &mut BTreeSet<&'a str>,
        done: &mut BTreeSet<&'a str>,
    ) -> Result<(), ValidationError> {
        if done.contains(id) {
            return Ok(());
        }
        if !active.insert(id) {
            return Err(invalid(
                "rules",
                "workflow connections must not form a cycle",
            ));
        }
        for target in targets(rules[id]) {
            visit(target, rules, active, done)?;
        }
        active.remove(id);
        done.insert(id);
        Ok(())
    }
    let mut done = BTreeSet::new();
    for id in rules.keys() {
        visit(id, &rules, &mut BTreeSet::new(), &mut done)?;
    }
    Ok(())
}

pub(crate) fn evaluate(
    policy: &Policy,
    snapshot: &Snapshot,
    verified: &BTreeMap<String, Verification>,
) -> Result<Evaluation, ValidationError> {
    let mut action = policy
        .entry
        .clone()
        .ok_or_else(|| invalid("entry", "missing workflow entry"))?;
    let mut trace = Vec::new();
    let mut reason = DecisionReason::Otherwise;
    let mut rule_id = None;
    loop {
        let target = match &action {
            RuleAction::Allow | RuleAction::Deny => {
                return Ok(Evaluation {
                    outcome: if action == RuleAction::Allow {
                        Outcome::Allow
                    } else {
                        Outcome::Deny
                    },
                    reason,
                    rule_id,
                    trace,
                });
            }
            RuleAction::GoTo(id) => id,
            RuleAction::Challenge => return Err(invalid("entry", "verification requires a step")),
        };
        // Bounds remain defensive even though only validated acyclic policies enter here.
        if trace.len() >= policy.rules.len() {
            return Err(invalid(
                "rules",
                "workflow traversal exceeded its step limit",
            ));
        }
        let rule = policy
            .rules
            .iter()
            .find(|r| &r.id == target)
            .ok_or_else(|| invalid("rules", "missing workflow step"))?;
        let condition = evaluate_condition(&rule.condition, snapshot);
        action = match condition.result {
            Truth::True => rule.then.clone(),
            Truth::False => rule
                .on_false
                .clone()
                .ok_or_else(|| invalid("on_false", "missing branch"))?,
            Truth::Unknown => match &rule.on_unknown {
                UnknownAction::Allow => RuleAction::Allow,
                UnknownAction::Deny => RuleAction::Deny,
                UnknownAction::Challenge => RuleAction::Challenge,
                UnknownAction::GoTo(id) => RuleAction::GoTo(id.clone()),
                UnknownAction::Next => {
                    return Err(invalid(
                        "on_unknown",
                        "implicit NEXT is not a workflow branch",
                    ));
                }
            },
        };
        reason = if condition.result == Truth::Unknown && action == RuleAction::Deny {
            DecisionReason::UnknownDenied
        } else {
            DecisionReason::WorkflowBranch
        };
        rule_id = Some(rule.id.clone());
        let mut outcome = None;
        let route = match &action {
            RuleAction::Allow => {
                outcome = Some(Outcome::Allow);
                Route::Allow
            }
            RuleAction::Deny => {
                outcome = Some(Outcome::Deny);
                Route::Deny
            }
            RuleAction::GoTo(_) => Route::Next,
            RuleAction::Challenge => match verified.get(&rule.id) {
                None => {
                    outcome = Some(Outcome::ChallengeRequired);
                    reason = DecisionReason::VerificationRequired;
                    Route::Challenge
                }
                Some(Verification::Passed) => {
                    action = rule.on_verified.clone().ok_or_else(|| {
                        invalid("on_verified", "missing verification destination")
                    })?;
                    Route::VerificationPassed
                }
                Some(Verification::Failed) => {
                    outcome = Some(Outcome::Deny);
                    reason = DecisionReason::VerificationFailed;
                    Route::VerificationFailed
                }
                Some(Verification::Expired) => {
                    outcome = Some(Outcome::Deny);
                    reason = DecisionReason::VerificationExpired;
                    Route::VerificationExpired
                }
                Some(Verification::Unavailable) => {
                    outcome = Some(Outcome::Deny);
                    reason = DecisionReason::VerificationUnavailable;
                    Route::VerificationUnavailable
                }
            },
        };
        trace.push(RuleTrace {
            rule_id: rule.id.clone(),
            condition,
            route,
        });
        if let Some(outcome) = outcome {
            return Ok(Evaluation {
                outcome,
                reason,
                rule_id,
                trace,
            });
        }
    }
}
