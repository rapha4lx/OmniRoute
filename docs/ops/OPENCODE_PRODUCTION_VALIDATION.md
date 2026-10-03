---
title: OpenCode production validation
description: Native CLI request findings, compatibility fixes, and model cooldown validation.
---

# OpenCode production validation — 2026-10-03

Related: [issue #14977](https://github.com/diegosouzapw/OmniRoute/issues/14977) and
[PR #15143](https://github.com/diegosouzapw/OmniRoute/pull/15143).

## Findings and implemented changes

Native `/usr/local/bin/opencode` reported version 1.18.31. The native provider name is
`opencode`; `oc` is the OmniRoute alias. A native command using `oc/big-pickle` failed with
`ProviderModelNotFoundError` before upstream dispatch, despite the generic CLI error wrapper.

Captured native main requests carried CLI client/project/session/request identities and
streaming bodies. The title-generation prompt belonged to a separate auxiliary request;
it must not replace the main software-engineering prompt. The chat compatibility adapter
uses a generic captured main prompt and 11 tool schemas, excluding local environment,
workstation paths, dates, and skill contents.

Muse Spark 1.3 used `/zen/v1/responses`, a Muse-specific developer prompt, 11 flat tools,
`store: false`, encrypted reasoning inclusion, and streaming. The new Responses adapter
reproduces this format and preserves caller input/instructions. User-supplied tools remain
intact; synthesized tools do not grant execution capabilities to the router.

Native Muse 1.3 returned 200 and `OK`; the adapted request also returned 200. Muse 1.2 was
absent from the installed CLI catalog and failed before network dispatch. This does not
establish an upstream HTTP result for Muse 1.2. Earlier 403 probes do not prove a universal
closure of the free tier, nor that residential proxy use is mandatory; direct and residential
probes had previously failed, but the later successful native requests contradict a global
unavailability claim. No single cause for the earlier intermittent 403s was established.

Recognized OpenCode upstream/model failures now create a temporary shared provider+model
lock. They do not disable an account, open the provider breaker, or activate the optional
combo provider cooldown. Future requests skip the affected model until expiry. Timings:
2 minutes for recognized upstream 5xx, 3 minutes for thin free-tier refusal, and 30 minutes
for unavailable-model 400 (the classifier's longer value is capped by the runtime).
This is intentionally not a reclassification of every unrelated provider 5xx or 403.

## Production evidence

The production container was rebuilt from this repository and deployed with its persistent
data volume retained. Loopback host port 20130 avoids the occupied development port 20128;
Traefik routes the production domain to container dashboard port 20128. The build serves the
domain root and uses the Compose Redis service. A mounted build directory is not used.

Public dashboard API calls to `/api/v1/chat/completions` used session authentication and plain
client requests, without native CLI tools or identity headers. Credentials and raw captures
are excluded from Git.

| Request order | Model                                | Result                                                               |
| ------------- | ------------------------------------ | -------------------------------------------------------------------- |
| 1             | `oc/muse-spark-1.3-contributor-free` | HTTP 200, answer `OK`, 8228 ms                                       |
| 2             | `oc/deepseek-v4-flash-free`          | HTTP 400, upstream `Model is unavailable`, 854 ms                    |
| 3             | `oc/deepseek-v4-flash-free`          | Local HTTP 429 in 47 ms; `Retry-After: 1800`, cooldown scope `model` |
| 4             | `oc/big-pickle`                      | HTTP 200, answer `OK`, 1834 ms                                       |

The container was healthy and `/healthz` returned 200 after deployment. These results are
observations at the stated date, not a promise of future upstream model availability.

## Verification and limitations

- 730 focused OpenCode/resilience tests passed before the additional refusal and combo cases;
  the added focused cases also passed. This is not a claim that the entire Node suite is green.
- Vitest: 493 tests passed.
- Core typecheck, changed-file lint with repository suppressions, docs validation, and cycle
  checks passed in the deployed checkout.
- `tests/unit/upstream-model-combo-scope.test.ts` verifies a failing Nemotron target falls back
  to Big Pickle, a subsequent request skips Nemotron, the account remains outside provider
  cooldown, and the provider breaker remains closed with optional provider cooldown enabled.
- `tests/unit/upstream-model-cooldown.test.ts` covers lock expiry, error classification,
  sibling-model eligibility, and model-only free-tier refusal.
- `tests/unit/opencode-cli-compat.test.ts` covers both request formats and caller preservation.

The model lock is process-local; restart clears it and replicas do not synchronize it.
Native compatibility is based on the captured CLI version and may need revision if upstream
changes its contract. Native Muse 1.2 behavior could not be tested past model resolution.

## Publication branch validation

The follow-up branch `fix/opencode-cli-model-cooldown-14977` is based on the existing
PR #15143 head, rather than replacing another session's worktree. It contains the runtime
changes, production Compose configuration, and this report. The existing upstream version
sync fix (#15113) was cherry-picked, preserving its original author. The geo-rotation test
state reset from upstream commit `0816f6248b` was also ported to remove cross-case proxy
refusal state inherited from the older PR base.

Final branch checks: 732 focused Node tests passed; production Compose tests passed 2/2;
core typecheck, docs-all, frozen file-size checks, and commit hooks passed. Vitest on this
older PR-based branch produced 491 passing tests and two failures in
`open-sse/mcp-server/__tests__/audit.test.ts`: a shutdown checkpoint timeout and a missing
mock close call. These results repeated on retry; those files are outside this change.
The earlier 493/493 result above refers to the deployed checkout, not this older PR base.
The branch has not been merged upstream or into the existing PR head.
