#!/usr/bin/env python3
"""Run labelled synthetic report submissions through a real local Krine server."""
import argparse
import http.cookiejar
import json
from pathlib import Path
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid


def condition(source, name, comparison, value):
    ref = {"source": source, "name": name}
    if source == "metric":
        ref["version"] = 1
    return {"op": "compare", "left": ref, "comparison": comparison, "value": value}


POLICY = {
    "schema_version": 2, "inputs": {"operator_authorized": "boolean"},
    "entry": {"goto": "authorization"}, "otherwise": "DENY",
    "rules": [
        {"id": "authorization", "condition": condition("input", "operator_authorized", "eq", True),
         "then": {"goto": "automation"}, "on_false": "DENY", "on_unknown": "DENY"},
        {"id": "automation", "condition": condition("metric", "browser.automation_observed", "eq", True),
         "then": "DENY", "on_false": {"goto": "velocity"}, "on_unknown": "DENY"},
        {"id": "velocity", "condition": condition("metric", "session.event_count_5m", "gte", 20),
         "then": "DENY", "on_false": "ALLOW", "on_unknown": "DENY"},
    ],
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8080")
    parser.add_argument("--browser-origin", default="http://localhost:3000")
    parser.add_argument("--secrets-dir", type=Path, default=Path("deploy/secrets"))
    parser.add_argument("--output-dir", type=Path, default=Path(".demo/report-gateway"))
    args = parser.parse_args()
    endpoint = urllib.parse.urlsplit(args.url)
    if endpoint.scheme != "http" or endpoint.hostname not in ("127.0.0.1", "localhost", "::1") or endpoint.path not in ("", "/") or endpoint.username or endpoint.password or endpoint.query or endpoint.fragment:
        parser.error("This fixture runner only supports a local HTTP Krine origin.")
    url = args.url.rstrip("/")
    check = "demo_report_gateway"
    secrets = {name: (args.secrets_dir / name).read_text().strip()
               for name in ("admin_password", "browser_public_key", "server_secret")}
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    csrf = None

    def request(path, body=None, auth="admin", method=None):
        headers = {"Content-Type": "application/json"}
        if auth == "admin":
            headers["Origin"] = url
            if csrf:
                headers.update({"X-CSRF-Token": csrf, "Idempotency-Key": str(uuid.uuid4())})
        elif auth == "browser":
            headers.update({"Origin": args.browser_origin, "X-Krine-Public-Key": secrets["browser_public_key"]})
        else:
            headers["Authorization"] = "Bearer " + secrets["server_secret"]
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(url + path, data=data, headers=headers, method=method)
        with opener.open(req, timeout=15) as response:
            return json.load(response)

    csrf = request("/v1/admin/session", {"password": secrets["admin_password"]})["csrf_token"]
    path = "/v1/admin/checks/" + check
    try:
        detail = request(path)
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        detail = request("/v1/admin/checks", {"name": check,
            "description": "Synthetic hackathon fixtures: report authorization, automation evidence and submission velocity."})
        detail = request(path + "/draft", {"revision": detail["draft_revision"],
            "description": detail["description"], "policy": POLICY}, method="PUT")
    if detail["active_version"] is None:
        if detail["draft"] != POLICY:
            raise RuntimeError("An existing demo draft differs. Review it in the dashboard; it was not overwritten.")
        active = request(path + "/publications", {"revision": detail["draft_revision"], "expected_active_version": None})
    else:
        active = request(path + "/versions/" + str(detail["active_version"]))
    # Preserve every operator edit. Rehearsal must never silently replace a policy.
    if active["policy"] != POLICY:
        raise RuntimeError("The demo workflow has changed. Restore the rehearsal policy in the dashboard before running these fixed expectations.")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    run_id = uuid.uuid4().hex
    cases = [
        ("authorized-report", {"operator_authorized": True}, {"webdriver": False}, 1, "ALLOW", ["authorization", "automation", "velocity"]),
        ("unauthorized-operator", {"operator_authorized": False}, {"webdriver": False}, 1, "DENY", ["authorization"]),
        ("automation-observed", {"operator_authorized": True}, {"webdriver": True}, 1, "DENY", ["authorization", "automation"]),
        ("missing-browser-evidence", {"operator_authorized": True}, {}, 1, "DENY", ["authorization", "automation"]),
        ("submission-burst", {"operator_authorized": True}, {"webdriver": False}, 20, "DENY", ["authorization", "automation", "velocity"]),
        ("missing-authorization", {}, {"webdriver": False}, 1, "DENY", ["authorization"]),
    ]
    results = []
    with sqlite3.connect(args.output_dir / "reports.sqlite3") as db:
        db.execute("CREATE TABLE IF NOT EXISTS reports (operation_id TEXT PRIMARY KEY, decision_id TEXT NOT NULL, run_id TEXT NOT NULL, title TEXT NOT NULL)")
        for label, inputs, signals, count, expected, expected_path in cases:
            context = request("/v1/browser/context", {"signals": signals}, "browser")
            proof = request("/v1/browser/proofs", {"client_token": context["client_token"],
                "session_token": context["session_token"], "check": check}, "browser")
            user_id = "demo_" + run_id + "_" + label
            for _ in range(count):
                request("/v1/events", {"event_id": str(uuid.uuid4()), "name": "report_submission_requested",
                    "client_id": context["client_id"], "session_id": context["session_id"],
                    "user_id": user_id, "properties": {"synthetic_demo": True, "scenario": label}}, "server")
            body = {"operation_id": str(uuid.uuid4()), "check": check, "proof": proof["proof"],
                    "ip": "127.0.0.1", "user_id": user_id, "inputs": inputs}
            decision = request("/v1/checks/evaluate", body, "server")
            if decision["outcome"] != expected:
                raise RuntimeError(f"{label}: expected {expected}, received {decision['outcome']}")
            captured = request("/v1/admin/activity/decisions/" + decision["decision_id"])
            visited = [item["rule_id"] for item in captured["evaluation"]["trace"]]
            if visited != expected_path:
                raise RuntimeError(f"{label}: unexpected traversal {visited}")
            if request("/v1/checks/evaluate", body, "server") != decision:
                raise RuntimeError(f"{label}: retry changed the decision")
            # The application, not Krine, owns execution and business deduplication.
            # Execute twice to verify recovery cannot insert the same report twice.
            for _ in range(2):
                if decision["outcome"] == "ALLOW":
                    db.execute("INSERT OR IGNORE INTO reports VALUES (?, ?, ?, ?)",
                               (body["operation_id"], decision["decision_id"], run_id, "Synthetic infrastructure status report"))
            results.append({"scenario": label, "synthetic": True, "decision": decision,
                            "visited": visited, "reason_summary": captured["reason_summary"]})
            print(f"{label:27} {expected:5}  {' → '.join(visited)}")
        stored = db.execute("SELECT count(*) FROM reports WHERE run_id=?", (run_id,)).fetchone()[0]
        if stored != 1:
            raise RuntimeError(f"Expected one accepted report, found {stored}")
    output = args.output_dir / (run_id + ".json")
    output.write_text(json.dumps({"run_id": run_id, "synthetic": True, "accepted_reports": stored, "results": results}, indent=2) + "\n")
    print(f"\n6 scenarios verified; 1 report stored; retries did not duplicate it.\nEvidence: {output}\nDashboard: {url}/inspect/check?name={check}")


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as error:
        # Never print request headers, credentials or proof bodies.
        print(f"Krine returned HTTP {error.code}. Check URL, allowed browser origin and local credentials.", file=sys.stderr)
        sys.exit(1)
    except (OSError, RuntimeError, ValueError, KeyError) as error:
        print(f"Demo stopped: {error}", file=sys.stderr)
        sys.exit(1)
