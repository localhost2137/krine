# ADR 0020: Connected policy workflows

**Status:** Accepted

## Context

The founder requested golden-sach's dark workspace and connected workflow editor,
then clarified that branching workflows are preferable to a canvas over ordered
rules. The old editor's implicit next rule cannot express branching and joins
without duplicating conditions. Existing published policies and in-progress
operations must retain their meaning.

## Decision

Add policy schema 2 alongside immutable schema 1. A check remains the application
integration boundary; its policy is now authored as a connected workflow. Keep the
existing rule IDs and condition representation so captured evidence, metric
versions, provider dependencies and verification binding remain compatible.

Schema 2 has an explicit `entry`, and each step has `then`, `on_false` and
`on_unknown` destinations. A destination is `ALLOW`, `DENY`, `CHALLENGE` or
`{"goto":"step_id"}`. Entry cannot be `CHALLENGE`. A step with any challenge branch
also requires `on_verified`, which can allow, deny or go to another step. Failed,
expired or unavailable verification always denies. Verification remains bound to
the same operation, step and pinned provider revision. Success follows the
configured connection; it never authorizes a separate operation.

All destinations must exist. The server rejects cycles, including disconnected
cycles, and keeps the existing bounds of 32 steps, 256 condition nodes, depth 8
and 32 typed backend inputs. Conditions preserve three-valued truth. Unknown can
be explicitly routed, including to Allow; it is never silently treated as false.
The legacy `NEXT` action is forbidden in schema 2. `otherwise` remains `DENY` as a
compatibility field and is not an execution path in schema 2.

Steps may remain outside the entry path while editing; the editor and publication
review explicitly mark them as not executable. Array order gives stable display
numbers, not evaluation order. Optional bounded canvas positions affect only
layout. Every branch and verification continuation is validated again by the
server on save and publication.

New checks start as a schema 2 workflow whose entry denies. Existing schema 1
policies retain their editor and an explicit conversion action. Conversion makes
all implicit false, unknown-next and verified-success routes explicit, including
the original Otherwise result. It changes the draft only. No database rewrite or
historical reinterpretation is performed. Schema 1 rejects schema 2 fields and
actions, preventing a graph from being accidentally downgraded to ordered rules.

Use React Flow 12.12.0, the reference project's canvas library, with ports,
movable steps, pan/zoom, a minimap and a step inspector. Branch selects and a step
selector provide keyboard alternatives to spatial editing. Removing a step routes
its incoming connections to Deny. New condition steps default to matched Deny and
unknown Deny. Existing conflict recovery and reviewed publication stay in charge
of persistence. Published and historical workflows are read-only.

Decision traces retain visited step IDs in traversal order. Captured schema 2
reason summaries carry `policy_schema_version: 2` and use `workflow_branch` for a
regular terminal branch, distinguishing false or unknown paths from legacy
`rule_matched`. All legacy captured reason fixtures remain byte-compatible.

### Authoring workspace and synthetic preview

Adapt the founder-owned Golden Sachs editor's node cards, connector interactions,
optical lens, contextual block picker and longest-path arrangement directly into
Krine. The palette contains registered versioned metrics, declared backend inputs,
conditions and outcomes. Inserting a condition preserves the existing continuation,
including verification success. Keep manual positions, local undo/redo, explicit
auto-arrangement, collapsible inspectors and immutable version navigation.

The Test path panel sends a supplied policy and explicitly synthetic snapshot to
`POST /v1/admin/policy-preview`. This authenticated, CSRF-protected endpoint invokes
the same validated Rust evaluator without application state, stores or providers.
It returns a trace for canvas highlighting and never publishes, creates a decision
record or authorizes an application operation. Editing evidence or policy clears
the displayed result and invalidates pending responses. Verification states here
are simulated; this is not a live provider test or historical impact analysis.

## Alternatives considered

- **A canvas over ordered rules:** visually similar but does not satisfy the
  requested branching behavior.
- **Replace all policies with the reference project's engine:** changes product
  semantics and imports unrelated LLM/MCP control concepts.
- **Arbitrary code or cyclic workflows:** adds execution risk and unbounded work
  without a requirement. A bounded acyclic decision graph covers the use case.

## Consequences

- This supersedes ADR 0008's prohibition on a policy canvas and permanent policy
  inspector; navigation and other domain boundaries remain intact.
- Deploy dashboard and backend together. Older binaries cannot read schema 2;
  use a stopped upgrade and take a backup before publishing workflow policies.
  A rollback must restore compatible application and database state together.
- This adds synthetic path testing, but not historical replay, approval queues,
  SSO, or new providers.
  Those are separate capabilities; visual similarity does not imply parity with
  every golden-sach feature.
- The workspace uses the reference's current graphite palette, sidebar, controls
  and typography while retaining Krine's branding. Inter and JetBrains Mono are
  bundled locally to preserve self-hosted operation.
