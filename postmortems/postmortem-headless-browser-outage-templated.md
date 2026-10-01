---

title: "[EKS] Data scraping worker pod – Playwright continuously crashing due to OTel Add-on 'ambush'"
date: "2026-09-25"
language: en
translation: "postmortem-headless-browser-outage-templated-vi"
severity: "P1"
status: "resolved"
duration: "Around 4-5 hours (estimated, not accurately tracked yet - see Action Items)"
services:

* "Product Data Worker"
* "Playwright / Chromium"
author: "Backend / Platform Team"
tags:
* "kubernetes"
* "eks"
* "opentelemetry"
* "admission-webhook"
* "headless-browser"
* "playwright"
summary: "A normal pod restart accidentally triggered a k8s mutating webhook, automatically injecting OTel auto-instrumentation. This caused the Chromium renderer to get stuck in a crash loop, taking down all data scraping jobs with it."

---

## Incident Overview

Around 10:00 AM on 09/25/2026, the worker using Playwright to scrape data from e-commerce sites suddenly failed en masse with timeout errors. At first glance, it seemed like a network disconnection or the target sites were blocking us, but after some debugging, the culprit was revealed: an EKS admission webhook. Specifically, during a pod restart the night before, this webhook (bundled with an EKS add-on) injected OpenTelemetry auto-instrumentation annotations into the workload. Unfortunately, this instrumentation hung during startup, causing the entire tree of Chromium child processes to continuously crash and restart.

## Timeline

| Time (UTC) | Event |
| --- | --- |
| ~23:29 (previous night) | Pod was randomly restarted due to minor infrastructure maintenance. This was the first time the pod was recreated since the add-on update. The webhook secretly injected 8 OTel annotations. |
| 10:00 | The first data scraping jobs of the day failed with `Content fetch failed` / `Navigation timeout after 60s` errors. |
| — | Jumped straight into the pod and ran `curl` to the outside, received HTTP 200 OK, ruling out network issues or egress blocks. |
| — | Brought the code to staging/dev and it ran smoothly. |
| — | Increased RAM/CPU limits, disabled sandbox, changed browser version -> Still failed. |
| — | Ran raw Chromium via command line (bypassing the Playwright library) -> Still survived. |
| — | Tried disabling auto-instrumentation -> Job passed successfully (green). |
| — | Inspected CloudTrail logs: found no one had interacted with the EKS cluster. |
| — | Had to dig into an S3 bucket containing 1-year-old CloudTrail history (from when EKS was created along with the add-on). |
| — | Root cause identified. |
| Same day | Resolved by adding an annotation to explicitly block this webhook; the service returned to normal. |

## Root Cause

The observability EKS add-on (managed by AWS) comes with a **mutating admission webhook**. Whenever a pod is restarted or created in the namespace, it automatically "gifts" it OpenTelemetry instrumentation.

This worker had been sitting idle for quite a while, without any deploys or restarts since before the latest add-on update, so it was spared. Until last night's maintenance forced a restart, and it got hit. The process was as follows:

1. The webhook injected annotations to enable auto-instrumentation for 4 different languages (even though the app actually only uses 1).
2. As soon as the pod was restarted, it was affected, and the service started using Playwright.
3. Every time the app called Playwright to launch Chromium, Chromium would spawn renderer processes. Before the renderer could do anything, it was blocked by the instrumentation. The pod did not restart, and DevOps received no alerts.
4. Customers started complaining loudly before it was discovered.

You can take a look at this audit log to see what the webhook was doing (dev name masked):

```json
{
  "requestURI": "/apis/apps/v1/namespaces//deployments/",
  "verb": "patch",
  "user": { "username": "" },
  "requestObject": {
    "spec": { "template": { "metadata": { "annotations": {
      "kubectl.kubernetes.io/restartedAt": ""
    } } } }
  },
  "annotations": {
    "mutation.webhook.admission.k8s.io/round_0_index_4": {
      "configuration": "-mutating-webhook-configuration",
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

The original command typed by the dev only contained `restartedAt`, everything below was fabricated by the webhook.

## Impact

* **User:** No impact. This is a background data scraping worker to enrich the product catalog; it is not on the user request path.
* **Revenue:** Hard to measure, basically product data updates were delayed by a few hours.
* **SLA:** Still within SLA.

## Detection

* **MTTD:** Detected manually. No automated alerts.
* **MTTR:** About 4-5 hours of manual troubleshooting from when the error was seen to when the fix was locked in (lacking metrics to measure this properly).

## Resolution

1. Quick test: Set environment variable `OTEL_SDK_DISABLED=true` to turn off OTel.
2. Root cause fix: Hardcoded the `appsignals.k8s.aws/auto-annotate-=false` annotation into the Deployment for the 3 unused languages to suppress the webhook's "enthusiasm".
3. `kubectl rollout restart` to create new pods without the annotations.
4. Re-enabled monitoring, Playwright resumed scraping data smoothly.

## Action Items

| Action Item | Assignee | Due Date | Status |
| --- | --- | --- | --- |
| Explicitly block auto-instrumentation for unused languages directly in the config, do not rely on add-on defaults | Backend | — | ✅ Done (for this worker) |

## Lessons Learned

1. **Butterfly effect:** A harmless pod restart can trigger a "time bomb" from an infrastructure update weeks ago. The "trigger event" and the "root change" often have nothing to do with each other.
2. **Hidden technical debt:** Long-lived apps that haven't been deployed in a while are actually silently accumulating risk from surrounding infrastructure changes. It blows up upon restart.
3. **CloudTrail as the savior:** Did not expect to have to dig through CloudTrail to this extent (DevOps was getting pretty frustrated before this ~~ ).