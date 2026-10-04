use krine_core::*;
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn step(id: &str, yes: Value, no: Value, unknown: Value) -> Value {
    json!({"id":id,"condition":{"op":"compare","left":{"source":"input","name":id},"comparison":"eq","value":true},"then":yes,"on_false":no,"on_unknown":unknown})
}
fn workflow(rules: Vec<Value>, entry: Value) -> Value {
    let inputs: serde_json::Map<String, Value> = rules
        .iter()
        .map(|r| (r["id"].as_str().unwrap().to_owned(), json!("boolean")))
        .collect();
    json!({"schema_version":2,"entry":entry,"inputs":inputs,"rules":rules,"otherwise":"DENY"})
}
fn validated(value: Value) -> ValidatedPolicy {
    ValidatedPolicy::try_from(serde_json::from_value::<Policy>(value).unwrap()).unwrap()
}
fn snapshot(values: &[(&str, bool)]) -> Snapshot {
    Snapshot {
        inputs: values
            .iter()
            .map(|(k, v)| ((*k).into(), Scalar::Boolean(*v)))
            .collect(),
        ..Snapshot::default()
    }
}
#[test]
fn branches_skip_steps_join_and_ignore_array_order() {
    let rules = vec![
        step("a", json!({"goto":"c"}), json!({"goto":"b"}), json!("DENY")),
        step("b", json!({"goto":"c"}), json!("DENY"), json!("DENY")),
        step("c", json!("ALLOW"), json!("DENY"), json!("DENY")),
    ];
    let mut value = workflow(rules, json!({"goto":"a"}));
    let first = evaluate(
        &validated(value.clone()),
        &snapshot(&[("a", true), ("c", true)]),
        &BTreeMap::new(),
    )
    .unwrap();
    assert_eq!(first.outcome, Outcome::Allow);
    assert_eq!(
        first
            .trace
            .iter()
            .map(|t| t.rule_id.as_str())
            .collect::<Vec<_>>(),
        ["a", "c"]
    );
    value["rules"].as_array_mut().unwrap().reverse();
    assert_eq!(
        evaluate(
            &validated(value),
            &snapshot(&[("a", true), ("c", true)]),
            &BTreeMap::new()
        )
        .unwrap(),
        first
    );
}
#[test]
fn false_and_unknown_paths_are_independent() {
    let p = validated(workflow(
        vec![
            step("a", json!("DENY"), json!("ALLOW"), json!({"goto":"b"})),
            step("b", json!("ALLOW"), json!("DENY"), json!("DENY")),
        ],
        json!({"goto":"a"}),
    ));
    assert_eq!(
        evaluate(&p, &snapshot(&[("a", false)]), &BTreeMap::new())
            .unwrap()
            .outcome,
        Outcome::Allow
    );
    let missing = evaluate(&p, &snapshot(&[]), &BTreeMap::new()).unwrap();
    assert_eq!(missing.outcome, Outcome::Deny);
    assert_eq!(missing.trace.len(), 2);
    assert_eq!(missing.trace[0].condition.result, Truth::Unknown);
    assert_eq!(
        evaluate(&p, &snapshot(&[("b", true)]), &BTreeMap::new())
            .unwrap()
            .outcome,
        Outcome::Allow
    );
}
#[test]
fn verification_uses_its_explicit_success_route_and_every_failure_denies() {
    let mut a = step("a", json!("DENY"), json!("CHALLENGE"), json!("DENY"));
    a["on_verified"] = json!({"goto":"c"});
    let p = validated(workflow(
        vec![
            a,
            step("b", json!("DENY"), json!("DENY"), json!("DENY")),
            step("c", json!("ALLOW"), json!("DENY"), json!("DENY")),
        ],
        json!({"goto":"a"}),
    ));
    let s = snapshot(&[("a", false), ("c", true)]);
    let pending = evaluate(&p, &s, &BTreeMap::new()).unwrap();
    assert_eq!(pending.outcome, Outcome::ChallengeRequired);
    for (state, reason) in [
        (Verification::Failed, DecisionReason::VerificationFailed),
        (Verification::Expired, DecisionReason::VerificationExpired),
        (
            Verification::Unavailable,
            DecisionReason::VerificationUnavailable,
        ),
    ] {
        let result = evaluate(&p, &s, &BTreeMap::from([("a".into(), state)])).unwrap();
        assert_eq!(result.outcome, Outcome::Deny);
        assert_eq!(result.reason, reason);
        assert_eq!(result.trace.len(), 1);
    }
    let result = evaluate(
        &p,
        &s,
        &BTreeMap::from([("a".into(), Verification::Passed)]),
    )
    .unwrap();
    assert_eq!(result.outcome, Outcome::Allow);
    assert_eq!(result.trace[1].rule_id, "c");
}
#[test]
fn rejects_cycles_dangling_targets_implicit_routes_and_schema_downgrades() {
    let base = workflow(
        vec![
            step("a", json!("ALLOW"), json!("DENY"), json!("DENY")),
            step("b", json!({"goto":"a"}), json!("DENY"), json!("DENY")),
        ],
        json!({"goto":"a"}),
    );
    let invalid = |v: Value| {
        let parsed = serde_json::from_value::<Policy>(v);
        assert!(parsed.is_err() || ValidatedPolicy::try_from(parsed.unwrap()).is_err());
    };
    for port in ["then", "on_false", "on_unknown"] {
        let mut v = base.clone();
        v["rules"][0][port] = json!({"goto":"b"});
        invalid(v);
        let mut v = base.clone();
        v["rules"][0][port] = json!({"goto":"missing"});
        invalid(v);
    }
    let mut v = base.clone();
    v["rules"][0]["on_unknown"] = json!("NEXT");
    invalid(v);
    let mut v = base.clone();
    v["entry"] = json!("CHALLENGE");
    invalid(v);
    let mut v = base.clone();
    v["schema_version"] = json!(1);
    invalid(v);
    let mut v = base.clone();
    v["rules"][0]["then"] = json!("CHALLENGE");
    invalid(v);
    let mut v = base.clone();
    v["rules"][0]["then"] = json!("CHALLENGE");
    v["rules"][0]["on_verified"] = json!({"goto":"b"});
    invalid(v);
    let mut v = base.clone();
    v["rules"][0]["position"] = json!({"x":10001,"y":0});
    invalid(v);
    let mut v = base;
    v["rules"][0].as_object_mut().unwrap().remove("on_false");
    invalid(v);
}
#[test]
fn captured_reasons_retain_workflow_version_and_false_branch_evidence() {
    let p = validated(workflow(
        vec![step("a", json!("DENY"), json!("ALLOW"), json!("DENY"))],
        json!({"goto":"a"}),
    ));
    let s = snapshot(&[("a", false)]);
    let result = evaluate(&p, &s, &BTreeMap::new()).unwrap();
    let detail = json!({"policy":p.policy(),"snapshot":s,"evaluation":result,"outcome":result.outcome,"reason":result.reason,"provider_revisions":{}});
    let summary = capture_reason(&detail).unwrap();
    assert_eq!(summary["policy_schema_version"], 2);
    assert_eq!(summary["reason"], "workflow_branch");
    assert_eq!(summary["rules"][0]["result"], "false");
}
#[test]
fn entry_can_end_without_conditions_and_verified_terminal_is_final() {
    assert_eq!(
        evaluate(
            &validated(workflow(vec![], json!("ALLOW"))),
            &Snapshot::default(),
            &BTreeMap::new()
        )
        .unwrap()
        .outcome,
        Outcome::Allow
    );
    let mut a = step("a", json!("CHALLENGE"), json!("DENY"), json!("DENY"));
    a["on_verified"] = json!("ALLOW");
    let p = validated(workflow(vec![a], json!({"goto":"a"})));
    let result = evaluate(
        &p,
        &snapshot(&[("a", true)]),
        &BTreeMap::from([("a".into(), Verification::Passed)]),
    )
    .unwrap();
    assert_eq!(result.outcome, Outcome::Allow);
    assert_eq!(result.trace[0].route, Route::VerificationPassed);
}
