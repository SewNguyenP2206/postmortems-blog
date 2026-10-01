---
title: "Search Service (Staging) – Elasticsearch TLS Failure Due to a Missing CA in the Image"
date: "2026-09"
language: en
translation: "postmortem-ai-product-search-worker-otel-timeout-vi"
severity: "P3"          # non-production
status: "monitoring"    # fix applied; confirmation pending
duration: "TBD"
services:
  - "Search service (staging)"
  - "Elasticsearch (staging)"
author: "TBD"
tags:
  - "elasticsearch"
  - "tls"
  - "certificate"
  - "kubernetes"
  - "ci-cd"
summary: "In a non-production environment, a search service failed every Elasticsearch call with 'unable to verify the first certificate' because its container image shipped without the CA for that environment's Elasticsearch cluster."
---

## Incident Overview

In a non-production environment, a Node.js search service began failing its calls to Elasticsearch with:

```
ConnectionError: unable to verify the first certificate
```

Another non-production environment, deployed from the same chart with nearly identical configuration, ran normally. No production systems were affected.

The first attempted fix, mounting the cluster's CA into the pod and setting `NODE_EXTRA_CA_CERTS`, had no effect, because the application passes its own CA to the Elasticsearch client.

## Timeline

| Time (UTC) | Event |
|---|---|
| T+0 | The service logs `unable to verify the first certificate` on an Elasticsearch call |
| T+~1h | Pod redeployed with the cluster CA mounted as a file and `NODE_EXTRA_CA_CERTS` set |
| T+~1h | The same error still occurs |
| Later | An in-pod test shows TLS to Elasticsearch succeeds, both with the CA passed explicitly and with `NODE_EXTRA_CA_CERTS` alone, so the CA itself is valid |
| Later | Code inspection shows the application builds its Elasticsearch client with an explicit CA read from a configurable path, which bypasses `NODE_EXTRA_CA_CERTS` |
| Later | Comparing the two environments' CI pipelines shows one copies a CA file into the image at build time and the other does not |
| Later | The CA path setting is pointed at the mounted CA file |
| TBD | Error gone and recovery confirmed |

Relative times are used because exact timestamps are not relevant to the lessons.

## Root Cause

The application constructs the Elasticsearch client with its own CA:

```js
tls: {
  ca: fs.readFileSync(CA_PATH),
  rejectUnauthorized: true,
}
```

When a client is given its own `ca`, Node uses only that CA for the connection, so `NODE_EXTRA_CA_CERTS` is ignored.

The CA file is provided at image build time through a CI step, and that step existed in only one environment's pipeline:

```yaml
# Environment A pipeline
# copy that environment's CA file into the build context before docker build

# Environment B pipeline
# (no such step)
```

Each environment has its own Elasticsearch cluster with a self-generated CA, so the CA baked into one environment's image cannot verify another environment's cluster. The environment whose pipeline included the step worked; the other did not.

Contributing factors:

- The error message does not say which CA file was used or where it came from.
- The deployment chart had no support for environment variables or volumes, so there was no way to inject the CA from the cluster.

## Impact

- **Users affected:** non-production only; calls through the search service that query Elasticsearch failed
- **Revenue impact:** none
- **SLA status:** N/A

## Detection

- **Mean Time to Detect (MTTD):** TBD
- **Mean Time to Respond (MTTR):** TBD

Detection signal: the TLS `ConnectionError` in the application logs.

## Resolution

1. Ruled out unrelated Elasticsearch warnings and certificate expiry (an expired certificate produces `certificate has expired`, not this error).
2. Extended the deployment chart to support extra environment variables and volumes, and mounted only the CA certificate (not the server private key) from the cluster's secret.
3. Verified in the pod that TLS to Elasticsearch works with that CA.
4. Found that the application reads its CA from a configurable path, and that the two environments differ in whether a CA file is baked into the image.
5. Pointed the CA path setting at the mounted CA file, applied manually first, then committed to the chart values so the next deployment does not overwrite it.

## Action Items

| Action | Owner | Due Date | Status |
|---|---|---|---|
| Commit the chart template and values changes so the fix survives the next deployment | TBD | TBD | ⏳ Pending |
| Confirm the error is gone and record the recovery time | TBD | TBD | ⏳ Pending |
| Align the other environment with the same approach and stop baking CA files into images | TBD | TBD | ⏳ Pending |
| Monitor expiry of self-generated Elasticsearch certificates | TBD | TBD | ⏳ Pending |
| Make the health check verify the Elasticsearch connection so TLS failures show up at deploy time | TBD | TBD | ⏳ Pending |

## Lessons Learned

1. Baking a CA file into a container image ties the image to one environment and breaks silently when the certificate is regenerated. Mounting the CA from the cluster keeps it in sync.
2. `NODE_EXTRA_CA_CERTS` has no effect on clients that pass their own `tls.ca`. Check how the client is constructed before reaching for environment variables.
3. When two environments behave differently with the same chart, compare their pipelines and built images, not only the chart values.
4. An in-pod test with and without the CA quickly separates "the CA is wrong" from "the application is not using the CA".
5. Manual changes made directly on the cluster are overwritten by the next chart deployment, so every fix must also land in the chart and values.