---
title: "Product Data Worker – Playwright Renderer Crash-Loop from Silent OTel Injection"
date: "2026-09-25"
language: en
translation: "postmortem-headless-browser-outage-templated-vi"
severity: "P1"
status: "resolved"
duration: "~4-5h (approx. — not precisely tracked, see Action Items)"
services:
  - "Product Data Worker"
  - "Headless Browser Automation (Playwright/Chromium)"
author: "Backend / Platform Team"
tags:
  - "kubernetes"
  - "eks"
  - "opentelemetry"
  - "admission-webhook"
  - "headless-browser"
  - "playwright"
summary: "An unrelated add-on upgrade caused a Kubernetes mutating webhook to silently inject OpenTelemetry auto-instrumentation on the next pod restart, triggering an infinite Chromium renderer crash-loop and failing all scraping jobs."
---

## Incident Overview

On 2026-09-25, starting around 10:00, a production worker that fetches product pages from third-party sites using a headless-browser automation library (Playwright/Chromium) began failing every job with timeout errors. The failures looked like external network issues but were actually caused by a Kubernetes admission webhook — installed by a managed observability add-on — that had silently added auto-instrumentation annotations to the workload during a routine restart the night before. That instrumentation hung during startup, which cascaded into the headless browser's child-process management and put it into a permanent crash-restart loop.

## Timeline

| Time (UTC) | Event |
|---|---|
| ~23:29 (previous day) | Routine pod restart (unrelated maintenance action) — first pod recreation since an earlier add-on upgrade. A mutating admission webhook silently injects 8 auto-instrumentation annotations into the pod spec. |
| 10:00 | First scrape job after the restart fails with `Content fetch failed` / `Navigation timeout after 60s`. |
| — | Direct `curl` to target URLs from inside the pod succeeds (200 OK) — network/egress ruled out. |
| — | Identical code on a lower environment works fine — environment-specific issue confirmed. |
| — | Recurring log line noticed: a failed AWS resource-detection call, present only in the affected environment. |
| — | Resource limits, sandbox/runtime, and browser binary version all ruled out one by one. |
| — | Browser binary launched manually (outside the automation library) — works fine on its own. |
| — | Reproduced only when exercising the automation library's actual code path — process tree shows dozens of short-lived renderer child processes spawning and dying in rapid succession (crash-loop, not a simple hang). |
| — | Auto-instrumentation disabled as a test — job succeeds immediately. |
| — | Kubernetes API audit logs pulled to confirm exact mutation event and timestamp. |
| Same day | Workaround applied (annotation override), service confirmed stable. |

## Root Cause

A managed observability add-on (installed via a cloud provider's EKS add-on mechanism) ships a **mutating admission webhook** that auto-injects OpenTelemetry instrumentation into any pod recreated in namespaces it applies to — by default, for every supported language, with no opt-in annotation required from the workload owner.

The affected workload hadn't been redeployed or restarted since before the add-on's last upgrade, so it never "touched" the webhook until an unrelated, routine restart. At that point:

1. The webhook added annotations enabling auto-instrumentation for four languages (only one of which the workload actually used).
2. An init container and the OpenTelemetry SDK got auto-patched into the application runtime.
3. At startup, the SDK's cloud-resource detector tried to call a cloud API to resolve metadata and received a `403 Forbidden` (root cause of the 403 itself is still open — see Action Items).
4. Because that resolution never completed, something in the instrumentation's handling of child processes got stuck.
5. Every time the application launched a headless Chromium instance, the renderer process crashed immediately after spawning, and the browser kept spawning fresh renderer processes in a tight, backing-off retry loop — dozens of distinct renderer PIDs within seconds, none surviving. Page navigation never completed, so the application-level timeout always fired.

Audit log of the mutating webhook's patch (identifiers redacted):

```json
{
  "requestURI": "/apis/apps/v1/namespaces/<namespace>/deployments/<service-name>",
  "verb": "patch",
  "user": { "username": "<engineer-identity>" },
  "requestObject": {
    "spec": { "template": { "metadata": { "annotations": {
      "kubectl.kubernetes.io/restartedAt": "<timestamp>"
    } } } }
  },
  "annotations": {
    "mutation.webhook.admission.k8s.io/round_0_index_4": {
      "configuration": "<observability-addon>-mutating-webhook-configuration",
      "webhook": "mworkload.kb.io",
      "mutated": true
    },
    "patch.webhook.admission.k8s.io/round_0_index_4": {
      "patch": [
        { "op": "add", "path": "/spec/template/metadata/annotations/.../auto-annotate-dotnet", "value": "true" },
        { "op": "add", "path": "/spec/template/metadata/annotations/.../auto-annotate-java", "value": "true" },
        { "op": "add", "path": "/spec/template/metadata/annotations/.../auto-annotate-python", "value": "true" },
        { "op": "add", "path": "/spec/template/metadata/annotations/.../auto-annotate-nodejs", "value": "true" },
        { "op": "add", "path": "/spec/template/metadata/annotations/.../inject-dotnet", "value": "true" },
        { "op": "add", "path": "/spec/template/metadata/annotations/.../inject-java", "value": "true" },
        { "op": "add", "path": "/spec/template/metadata/annotations/.../inject-python", "value": "true" },
        { "op": "add", "path": "/spec/template/metadata/annotations/.../inject-nodejs", "value": "true" }
      ],
      "patchType": "JSONPatch"
    }
  }
}
```

The original request (the engineer's actual action) contained only the routine `restartedAt` annotation — everything else was added by the webhook.

## Impact

- **Users affected:** N/A — this is an internal data-ingestion worker (product catalog enrichment), not a user-facing request path.
- **Revenue impact:** Not directly quantifiable; downstream effect limited to delayed catalog data freshness.
- **SLA status:** Within SLA (internal batch pipeline, no customer-facing SLA breached).

## Detection

- **Mean Time to Detect (MTTD):** No automated alert fired; detected via manual review after job failures were noticed in logs.
- **Mean Time to Respond (MTTR):** ~4-5h from first observed failure to confirmed fix (approximate — see Action Items on improving detection/timing instrumentation for this pipeline).

## Resolution

1. Confirmed root cause by disabling OpenTelemetry auto-instrumentation (`OTEL_SDK_DISABLED=true`) as a test — jobs succeeded immediately.
2. Applied a durable fix: added explicit annotation overrides (`appsignals.k8s.aws/auto-annotate-<language>=false`) for the three unused languages on the Deployment spec, keeping only the instrumentation actually needed.
3. Rolled out via `kubectl rollout restart` and confirmed init containers for the unused languages were no longer present on the new pod.
4. Confirmed scrape jobs processing normally post-rollout.

## Action Items

| Action | Owner | Due Date | Status |
|---|---|---|---|
| Explicitly disable auto-instrumentation annotations for unused languages on every workload, in version control, instead of relying on the add-on's default | Backend | — | ✅ Done (this workload) |
| Root-cause the underlying `403` from the cloud resource detector (IAM/permissions or network policy) | Platform | — | ⏳ Pending |
| Audit other workloads using headless browsers or similar multi-process runtimes for the same latent exposure | Platform | — | ⏳ Pending |
| Add alerting on admission-webhook mutations that add instrumentation to a workload's spec outside its own deploy pipeline | Platform | — | ⏳ Pending |
| Add explicit timing/alerting for this pipeline's job failure rate so MTTD/MTTR can be measured precisely next time | SRE | — | ⏳ Pending |
| Document this failure mode in the internal runbook (webhook auto-injection on pod recreation; long-idle workloads are retroactively affected by add-on upgrades) | Platform | — | ⏳ Pending |

## Lessons Learned

1. A completely unrelated, routine action (restarting a pod) can trigger a behavior change introduced by an infrastructure add-on upgrade that happened weeks earlier, with zero application-side code or config change — making the "recent change" and the "triggering event" temporally and causally disconnected.
2. Managed observability add-ons that mutate workloads by default are a real risk for any workload with multi-process runtimes (headless browsers, anything that forks/execs child processes): a stall during instrumentation startup can present as a child-process crash-loop that looks nothing like an instrumentation issue.
3. A workload that goes a long time without redeploy or restart can silently accumulate exposure to infrastructure changes made in the meantime — the blast radius only becomes visible at the next recreation, which may be much later and appear unrelated.
4. Kubernetes API audit logging was the single most valuable tool in this investigation; without it, this would have been very hard to pin down with confidence.
