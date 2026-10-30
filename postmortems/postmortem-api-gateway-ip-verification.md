---
title: "API Gateway – 423 Errors from IP Verification After a Request-Path Change"
date: "2026-10-28"
language: en
translation: "postmortem-api-gateway-ip-verification-vi"
severity: "P1"
status: "resolved"
duration: "Several hours; exact recovery time TBD"
services: ["User service", "API Gateway / VPC Link", "Application Load Balancer"]
author: "Engineering team"
tags: ["api-gateway", "ip-verification", "networking", "production"]
summary: "After DNS was moved from an Application Load Balancer to API Gateway, the user service saw the wrong source IP through VPC Link and returned 423 for the organization access endpoint."
---

## Incident Overview

On October 28, 2026, after production DNS was moved from an Application Load Balancer to an API Gateway HTTP API through VPC Link, users received a 423 error and an “IP address not allowed” message when calling `/user/api/organization/access`.

The `/user/api/health` endpoint continued returning 200 because it did not run IP verification. The issue was resolved with a hotfix to the user service's IP verification logic that night. The exact recovery time and number of affected customers still need to be confirmed.

## Timeline

| Time (ICT, UTC+7) | Event |
| --- | --- |
| ~18:50 | DNS moved from the Application Load Balancer to an API Gateway HTTP API through VPC Link. `/user/api/health` continued returning 200. |
| Afterward | Production users received 423 responses from `/user/api/organization/access`; the user service saw a source address different from the user's IP. |
| Evening | Ruled out the WAF and browser-side proxy/VPN: the WAF returned 403, not the application's 423. |
| 19:54 | API Gateway access logs confirmed that the gateway received the request's correct source IP. |
| ~20:39 | Attempted to overwrite `X-Forwarded-For` using parameter mapping, but HTTP API rejected operations on that header. |
| Overnight | Updated IP verification logic in the user service and deployed a hotfix; the issue was resolved. Exact recovery time TBD. |

## Root Cause

Two conditions combined to cause the incident:

1. **Staging differed from production:** IP verification was disabled in staging but enabled in production, so staging tests did not catch the issue.
2. **The request path changed:** previously, requests went from the browser through the Application Load Balancer to the user service. After the change, requests passed through API Gateway and VPC Link first. The source address seen by the user service was no longer the user's IP.
3. **Verification relied on the connection's source address:** the user service compared that address against its allowlist and returned 423 when it did not match.

API Gateway still identified the request's correct source IP, as confirmed by its access logs. HTTP API does not allow overwriting `X-Forwarded-For`; mapping a separate `X-Client-IP` header is a viable way to pass the address to the backend. However, the team still needs to confirm which header or source the user service reads after the hotfix.

One detail remains unexplained: the IP address recorded by the user service. Logging and comparing `X-Forwarded-For`, `X-Client-IP`, and the connection address (`remoteAddr`) is needed to determine its source.

## Impact

- **Users affected:** production users routed through the new API path and subject to IP verification at `/user/api/organization/access`.
- **Symptom:** the endpoint returned 423 and the UI reported that the current IP could not access the service.
- **Number of affected customers:** TBD.
- **Duration:** from approximately 18:50 ICT on October 28 until the hotfix was deployed overnight; exact end time TBD.
- **Revenue and SLA impact:** no confirmed figures.

## Detection and Diagnosis

| Hypothesis | Result |
| --- | --- |
| WAF blocked the request | Ruled out. The WAF returned 403; the actual error was 423 from the application. |
| A browser-side proxy/VPN changed the IP | No supporting evidence; the issue began when the request path changed. |
| API Gateway received the wrong user IP | Ruled out. Access logs showed the correct request source IP. |
| Overwrite `X-Forwarded-For` using parameter mapping | Not possible on HTTP API because operations on this header are restricted. |
| Pass the IP through a separate `X-Client-IP` header | Supported by HTTP API; confirm which header the user service uses after the hotfix. |

The health check did not detect the issue because its endpoint did not run IP verification. The user service also lacked enough header and connection-address logging to determine which IP was used for the check.

## Resolution

1. Updated IP verification in the user service so it no longer relies on the VPC Link connection's source IP, then deployed a production hotfix.
2. Added an `X-Client-IP` mapping from the source IP received by API Gateway and kept the existing `Host` mapping.
3. Confirm which source the user service reads and ensure it trusts only headers set by a trusted gateway.

## Action Items

| Action | Owner | Due Date | Status |
| --- | --- | --- | --- |
| Enable IP verification in staging to match production, or explicitly document and review any configuration differences | Dev team | TBD | ⏳ Pending |
| Add end-to-end tests through API Gateway → VPC Link → load balancer → user service with IP verification enabled | Dev team | TBD | ⏳ Pending |
| Log `X-Forwarded-For`, `X-Client-IP`, and `remoteAddr` in the user service | Dev team | TBD | ⏳ Pending |
| Restrict the load balancer to traffic from the VPC Link Security Group to prevent direct access and header spoofing | Infra team | TBD | ⏳ Pending |
| Add a synthetic check for an endpoint that exercises IP verification, not only `/user/api/health` | Infra team | TBD | ⏳ Pending |
| Use a production DNS/architecture change checklist that includes equivalent-environment testing and a rollback plan | Infra team | TBD | ⏳ Pending |
| Keep API Gateway access logs enabled with source IP, status, and latency | Infra team | TBD | ⏳ Pending |
| Confirm the number of affected customers, recovery time, and specific owners/due dates | Dev / infra teams | TBD | ⏳ Pending |

## Lessons Learned

1. Staging only reflects production when mechanisms that can break requests, such as IP verification, are configured equivalently.
2. Adding API Gateway and VPC Link can change the source address seen by a backend. Revalidate IP-dependent logic whenever the network architecture changes.
3. A basic health check cannot represent a business flow that performs IP verification; add synthetic checks for the real endpoint.
4. Forwarded-IP headers are trustworthy only when the backend accepts requests from a controlled gateway and cannot be reached directly to spoof those headers.
5. Gateway access logs can verify the request's entry point, but backend logs must also capture relevant headers and connection addresses for end-to-end diagnosis.
