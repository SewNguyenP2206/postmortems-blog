---
title: "Redis Cache Cluster Failover – Memory Leak in Lua Scripts"
date: "2024-09-15"
severity: "P1"
status: "resolved"
duration: "45m"
services: ["Redis", "Session Service", "Cart Service"]
author: "Backend Team"
tags: ["redis", "cache", "memory-leak", "lua"]
summary: "Redis memory leak via unoptimized Lua scripts caused OOM kills across cache cluster, degrading checkout flow for 45 minutes."
---

## Incident Overview

On September 15, 2024, at 09:18 UTC, Redis nodes in our primary cache cluster began experiencing OOM (Out of Memory) kills due to a memory leak introduced in a Lua script used for atomic cart operations. This degraded the checkout and session flows for ~45 minutes.

## Timeline

| Time (UTC) | Event |
|---|---|
| 09:18 | Redis OOM alert triggered |
| 09:22 | Session service 502 errors spike to 30% |
| 09:25 | Cart service degraded – fallback to DB activated |
| 09:40 | Root cause identified: Lua script memory leak |
| 09:58 | Hotfix deployed – Lua scripts flushed and reloaded |
| 10:03 | Full recovery confirmed |

## Root Cause

A Lua script deployed in `cart-service` v1.8.0 accumulated unreleased table references inside a loop, causing the Redis Lua interpreter to retain memory across calls. Over ~6 hours of production traffic, this consumed all available Redis memory (32GB).

```lua
-- BEFORE (buggy) – table grows unbounded
local function process_cart(keys, args)
  local results = {}  -- ❌ never cleared between script invocations
  for i, key in ipairs(keys) do
    local val = redis.call('GET', key)
    table.insert(results, val)
  end
  return results
end

-- AFTER (fixed) – local scoping fixed
local function process_cart(keys, args)
  local results = {}  -- ✅ local to this invocation
  for i = 1, #keys do
    local val = redis.call('GET', keys[i])
    if val then results[#results + 1] = val end
  end
  return results
end
```

## Impact

- **Users affected:** ~18,000 users (checkout & session impacted)
- **Revenue impact:** ~$3,200 estimated (abandoned carts)
- **SLA status:** Within SLA (degraded, not full outage)

## Detection

- **MTTD:** 4 minutes (Redis memory alert at 95% threshold)
- **MTTR:** 45 minutes

## Action Items

| Action | Owner | Due Date | Status |
|---|---|---|---|
| Add Redis memory alerting at 80% | SRE | 2024-09-22 | ✅ Done |
| Lua script memory profiling in staging | Backend | 2024-09-25 | ✅ Done |
| Add Redis Lua script linting to CI | Platform | 2024-09-30 | ✅ Done |

## Lessons Learned

1. **Lua scripts must be tested with production-scale data volumes** – the leak was only observable after millions of calls.
2. **Redis memory limits should trigger graceful degradation** – the OOM kill was abrupt with no graceful fallback initially.
