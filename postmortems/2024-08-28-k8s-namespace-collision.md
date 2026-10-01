---
title: "CI/CD Pipeline Failure – Kubernetes Namespace Collision"
date: "2024-08-28"
severity: "P2"
status: "resolved"
duration: "1h 10m"
services: ["Jenkins", "Kubernetes", "Deployment Pipeline"]
author: "DevOps Team"
tags: ["kubernetes", "ci-cd", "namespace", "deployment"]
summary: "A Kubernetes namespace naming collision between staging and canary deployments caused production deployments to fail for 1h10m."
---

## Incident Overview

On August 28, 2024, at 11:05 UTC, production deployments began failing due to a Kubernetes namespace naming collision introduced by a new canary deployment feature. This blocked all production releases for approximately 1 hour 10 minutes.

## Timeline

| Time (UTC) | Event |
|---|---|
| 11:05 | Production deploy pipeline fails |
| 11:10 | Dev team notified – deploy queue blocked |
| 11:20 | Investigation begins: kubectl errors in logs |
| 11:45 | Root cause identified: namespace collision |
| 12:00 | Hotfix applied – namespace naming convention updated |
| 12:15 | Deployments unblocked and verified |

## Root Cause

The new canary feature used `{service}-canary` as the namespace prefix. An existing staging namespace for `payment-service` was named `payment-service-canary`, causing the Kubernetes API to reject new canary deployments with a 409 Conflict error.

## Impact

- **Teams affected:** All engineering teams (deploy queue blocked)
- **Deployments blocked:** 14 pending releases
- **No user-facing impact** – existing production pods unaffected

## Action Items

| Action | Owner | Due Date | Status |
|---|---|---|---|
| Enforce namespace naming conventions via admission webhook | Platform | 2024-09-05 | ✅ Done |
| Add namespace collision check to deploy script | DevOps | 2024-09-03 | ✅ Done |
| Document namespace conventions in runbook | DevOps | 2024-09-04 | ✅ Done |

## Lessons Learned

1. **Namespace conventions need to be enforced at the API level** – documentation alone is insufficient.
2. **Pre-flight checks should validate Kubernetes resources before deploying** – catching conflicts before they block queues.
