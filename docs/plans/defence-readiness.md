# Defence task readiness

Assessment date: 2026-10-04. Scope: this checkout, the supplied competition PDF,
and the local golden-sach design/workflow reference.

## Task fit

The supplied PDF is the Defence competition's terms, not its detailed challenge.
Clause 3 says the detailed task is announced separately. It requests a project
description and a PDF presentation of at most ten slides, with optional demo and
repository links. The judging weights are idea/innovation 30%, category relevance
20%, applicability/usability 20%, design 20%, and completeness 10%.

Source: https://mudnibfuppwadjkynscc.supabase.co/storage/v1/object/public/task-files/6f0f5e2e-246f-4078-a3f7-1aad9152e9f0/files/312cc8e5-48a3-4c4b-a9a1-9b28861995e9.pdf

Working assumption, pending the actual brief: Krine demonstrates protection of a
web application's sensitive actions from automation and account abuse. It can
support a defence-related application under that interpretation. This is not
proof of category fit, challenge eligibility, or completeness against an unseen
brief. The terms also constrain when competition work starts; confirm treatment
of an existing project with the organizer before relying on it for a submission.

## What is implemented

| Area | Current capability |
| --- | --- |
| Enforcement | Rust evaluator, backend-authoritative events/inputs, browser-bound proofs, idempotent checks, pinned policy versions and verification continuation |
| Policy work | Connected acyclic workflows, explicit true/false/unknown/verified destinations, canvas and inspector, server validation, reviewed publication and version restoration |
| Compatibility | Existing ordered policies retain their meaning; explicit draft conversion; original historical evidence remains readable |
| Evidence | Versioned metric catalog, normalized IP/verification providers, reversible relationships, captured reasons, activity and bounded analytics |
| Integration | Local TypeScript browser/server SDKs and a protected trial example |
| Design | golden-sach's navy workspace palette and sidebar; React Flow ports, pan/zoom, minimap and inspector |
| Self-hosting | PostgreSQL, ClickHouse, Valkey, Compose deployment and documented recovery workflows |

## Work remaining for a credible challenge demonstration

1. Obtain the actual task description and choose one concrete protected action.
   State who uses it, what abuse is stopped, and why it belongs in Defence.
2. Integrate that action into the audience-facing demonstration application, with trustworthy
   backend inputs. The report-gateway fixture runner already verifies a normal
   allow, abusive denials and missing evidence against the live engine.
   If verification is part of the story, configure and exercise a real provider.
3. Rehearse the whole loop: action request → saved workflow → backend decision →
   captured explanation → changed draft → reviewed publication → changed result.
4. Prepare the required short presentation and submission materials. Separate
   live evidence from fictional historical sample data.

For this interpretation, the main remaining demo work is scenario selection,
application integration and presentation. It is not a new engine build. A
percentage would be misleading until the actual challenge is known.

## Work remaining for production use

- Named operators, server-enforced roles, attributable administrative audit,
  session revocation/offboarding and optional enterprise sign-in. This checkout
  still uses a shared administrator password.
- Operating telemetry and measured sustained capacity, overload behavior, and
  recovery on a fresh target at an explicit hardware/workload profile.
- SDK package publication and a verified application-specific rollout, including
  deliberate fail-open/fail-closed behavior and business-action deduplication.
- Security review of the new workflow paths and the deployment, plus the relevant
  privacy/retention and operational requirements of the intended environment.

See [production readiness](production-readiness.md) for the broader existing
plan. Workflow authoring now directly adapts golden-sach's node and connector
interactions, searchable block picker, inspectors, arrangement and optical lens.
Synthetic path tests run through Krine's real Rust evaluator. LLM/MCP controls,
historical impact/replay and human approval workflows have not been imported.

## Verified in this checkout

- Dashboard: 443 tests pass; TypeScript and production build pass.
- Rust: workspace tests pass; formatting and Clippy with warnings denied pass.
- Store-backed tests pass for workflow publication, evaluation, retry and captured
  history, plus provider verification on a false branch and its pinned continuation.
  Provider integration uses a mock service, not a claim of live-provider readiness.
- The [report gateway rehearsal](report-gateway-demo.md) runs six labelled
  synthetic scenarios against the running server and all three stores. One report
  is accepted, five denied, traversal paths match, retries retain the same decision,
  and application writes do not duplicate the accepted report.

The local review is at `http://127.0.0.1:18088`; it uses the isolated
`krine-test-workflows` stores and `deploy/secrets/workflow-review` credentials.
The old dashboard on port 5174 belongs to a different checkout.
