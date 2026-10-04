# Report gateway demonstration

## Pitch

Krine is a self-hosted trust gateway for sensitive application actions. An
application sends authoritative events and asks for a decision before accepting
a report. Operators can change the decision workflow without deploying application
code, and inspect the evidence and exact version behind every outcome.

Working Defence scenario: protect an infrastructure-status reporting portal from
unauthorized submissions and automated flooding. This demonstrates submission
integrity; it does not establish that a report's contents are true. Category fit
still needs the separately announced task brief.

## Run the live fixture demonstration

With the review server running at `http://127.0.0.1:18088`, from the repository root:

```sh
python3 scripts/demo-report-gateway.py \
  --url http://127.0.0.1:18088 \
  --secrets-dir deploy/secrets/workflow-review
```

For a standard local installation, omit those options. The runner defaults to
port 8080 and `deploy/secrets`. Its browser origin defaults to
`http://localhost:3000`; use `--browser-origin` to match your configured allowed
origin. It refuses remote targets. It creates and publishes only the dedicated
`demo_report_gateway` check and never overwrites an existing edited policy.

The runner uses **synthetic application inputs and browser signals**, labelled in
the check, accepted events and evidence output. Decisions, event counters,
workflow traversal, stored explanations and retries are evaluated by the real
running Krine engine and its stores. No external IP/verification provider is
required. A SQLite application ledger stores the report only after an evaluated
Allow and deduplicates on the operation ID. The script retries each decision and
attempts the application write twice to verify those separate guarantees.

| Scenario | Expected outcome | Captured path |
| --- | --- | --- |
| Authorized report, ordinary activity | Allow; one report stored | Authorization → automation → velocity |
| Unauthorized operator | Deny | Authorization |
| Automation signal observed | Deny | Authorization → automation |
| Browser evidence missing | Deny with unknown evidence | Authorization → automation |
| Twenty accepted events within five minutes | Deny | Authorization → automation → velocity |
| Backend authorization missing | Deny with unknown input | Authorization |

Outputs go to ignored `.demo/report-gateway/`: one JSON evidence file per run and
`reports.sqlite3`. Every run uses fresh entities and operations. Repeated runs
retain earlier evidence rather than deleting it. No credentials or proofs are
written to the evidence files.

`webdriver: false` is untrusted evidence, not proof of humanity. The illustrative
threshold counts all accepted backend session events, not just report events.
Real integration must derive operator authorization from its authenticated
session and emit relevant backend events deliberately. Client-selected permission
flags must never become authoritative inputs. For this use case configure
application availability fallback to Deny and explain temporary unavailability.

## Three-minute walkthrough

1. Explain the protected action and who is allowed to perform it (20 seconds).
2. Open Checks → `demo_report_gateway`. Show entry and the explicit unknown
   routes, then expand the editor to show conditions and connections (40 seconds).
3. Run the script. Six decisions are real; only the authorized report is stored.
   Mention synthetic fixtures once, clearly (30 seconds).
4. Open View activity. Inspect an Allow, automation Deny and missing-evidence Deny.
   Show the snapshot, traversed steps, final route and immutable policy version
   (50 seconds).
5. Edit the demo's velocity threshold in a draft. Review the change, showing that
   saved drafts do not affect requests until publication. If publishing during
   rehearsal, restore version 1 through the reviewed restoration flow before
   rerunning the fixed expectations (40 seconds).

## Submission outline (at most ten slides)

1. The problem: sensitive reporting portals receive unauthorized and automated submissions.
2. The user and protected action, tied to the actual task brief.
3. The idea: self-hosted, explainable decisions before an action executes.
4. Trust boundaries: backend authority, untrusted browser evidence, explicit unknowns.
5. Workflow screenshot: permission → automation evidence → submission velocity.
6. Live demo evidence: six scenarios, their paths, and one accepted report.
7. Operator experience: draft, review, publish and inspect captured decisions.
8. Integration and architecture: SDKs, Rust engine and local stores.
9. Honest limits: synthetic fixtures; no content truth verification; shared admin; no measured production capacity claim.
10. Next step: task-specific application integration and deployment, with repository/demo links.

This is a rehearsal script and presentation outline, not the final submitted deck
or a complete reporting application. The existing protected-app example provides
the browser SDK and durable application integration pattern; it currently grants
trials and needs a scenario-specific action/UI for an audience-facing portal.
