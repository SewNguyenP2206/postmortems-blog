---
title: "Database Production Outage – PostgreSQL Connection Pool Exhausted"
date: "2024-10-01"
severity: "P0"
status: "resolved"
duration: "2h 34m"
services: ["PostgreSQL", "API Gateway", "User Service"]
author: "Platform Team"
tags: ["database", "connection-pool", "production"]
summary: "Complete PostgreSQL connection pool exhaustion caused a 2h34m outage affecting 100% of API traffic."
---

## Incident Overview

On October 1, 2024, at 14:32 UTC, our production PostgreSQL cluster experienced complete connection pool exhaustion, rendering all API endpoints unavailable for approximately 2 hours and 34 minutes.

## Timeline

| Time (UTC) | Event |
|---|---|
| 14:32 | Alerts triggered: API error rate > 50% |
| 14:35 | On-call engineer paged |
| 14:40 | Root cause identified: connection pool at 100% |
| 14:55 | Temporary mitigation: restart API pods |
| 16:00 | Database connection limits reconfigured |
| 17:06 | Full service restored |

## Root Cause

A newly deployed background job in `user-service` v2.3.1 failed to properly close database connections after completing batch operations. Each job run leaked ~50 connections. Combined with a spike in scheduled jobs triggered at 14:30 (end-of-month reporting), the connection pool of 200 connections was exhausted within 2 minutes.

```python
# BEFORE (buggy) - connection not closed
def process_batch(items):
    conn = db.get_connection()  # ❌ leaked
    cursor = conn.cursor()
    for item in items:
        cursor.execute("UPDATE users SET processed=true WHERE id=%s", (item.id,))
    conn.commit()

# AFTER (fixed) - using context manager
def process_batch(items):
    with db.get_connection() as conn:  # ✅ auto-closes
        cursor = conn.cursor()
        for item in items:
            cursor.execute("UPDATE users SET processed=true WHERE id=%s", (item.id,))
        conn.commit()
```

## Impact

- **Users affected:** 100% of API users (~45,000 active sessions)
- **Revenue impact:** ~$12,000 estimated
- **SLA breach:** Yes – exceeded 99.9% monthly SLA

## Detection

- **Mean Time to Detect (MTTD):** 3 minutes (Datadog alert)
- **Mean Time to Respond (MTTR):** 2h 34m

## Resolution

1. Rolled back `user-service` to v2.3.0
2. Increased PgBouncer connection pool limit as temporary measure
3. Fixed connection leak in background job code
4. Deployed v2.3.2 with fix

## Action Items

| Action | Owner | Due Date | Status |
|---|---|---|---|
| Add connection leak detection in CI | Platform | 2024-10-08 | ✅ Done |
| Implement pg_stat_activity alerting | SRE | 2024-10-10 | ✅ Done |
| Review all background jobs for leaks | Backend | 2024-10-15 | 🔄 In Progress |
| Load test connection pool limits | QA | 2024-10-20 | ⏳ Pending |

## Lessons Learned

1. **Connection pooling must be tested under load** – our staging environment had a much larger pool limit, masking the issue.
2. **Background job resource usage must be explicitly monitored** – scheduled jobs ran outside our normal APM traces.
3. **Runbooks need connection pool recovery steps** – the on-call engineer had to manually research the mitigation.
