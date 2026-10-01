---
title: "[TEMPLATE] Service Name – Short Incident Description"
date: "YYYY-MM-DD"
severity: "P0"          # P0 | P1 | P2 | P3
status: "resolved"      # resolved | ongoing | monitoring
duration: "Xh Ym"
services:
  - "Service A"
  - "Service B"
author: "Team Name"
tags:
  - "tag1"
  - "tag2"
summary: "One-sentence summary of what happened and its impact."
---

## Incident Overview

Brief description of the incident, when it occurred, and its overall impact.

## Timeline

| Time (UTC) | Event |
|---|---|
| HH:MM | Event description |
| HH:MM | Event description |
| HH:MM | Full recovery confirmed |

## Root Cause

Detailed technical explanation of what caused the incident.

```
# Include relevant code, config, or logs here
```

## Impact

- **Users affected:** X users / X% of traffic
- **Revenue impact:** $X estimated
- **SLA status:** Breached / Within SLA

## Detection

- **Mean Time to Detect (MTTD):** X minutes
- **Mean Time to Respond (MTTR):** Xh Ym

## Resolution

Steps taken to resolve the incident.

## Action Items

| Action | Owner | Due Date | Status |
|---|---|---|---|
| Action item | Team | YYYY-MM-DD | ⏳ Pending |

## Lessons Learned

1. Key insight from this incident.
2. Process or tooling improvement identified.
