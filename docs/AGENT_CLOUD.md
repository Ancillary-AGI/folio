# Always-on agents: local runner and cloud contract

Folio runs agent design loops **locally in the browser** by default. That is
enough for a single interactive engineer or an agent working in the open tab:
every tool call drives the real canvas store, and simulation/margins/ERC run in
the same process.

Some capabilities require a **server-side runner** that this repository does not
ship. This document separates what is implemented here from what the cloud
deployment must add, and defines the wire contract so the browser side is ready.

## What works locally (no server)

| Capability | Where |
| --- | --- |
| Observe sheet as canonical snapshot + SVG | `src/lib/agents/designSnapshot.ts`, `cad.observe` |
| Add/move/remove parts, wire pins, name nets, T-tap rails | `src/lib/agents/cadTools.ts` |
| DC / transient / AC / noise / sweep / Monte Carlo simulation | `cad.simulate` |
| Declared-rating margins, thermal estimate, limiting factor | `cad.assess`, `src/lib/electronics/designMargins.ts` |
| ERC, SPICE export, firmware edit, undo | `cad.erc`, `cad.exportNetlist`, `cad.setFirmware`, `cad.undo` |
| Observe → decide → act loop with budgets and approvals | `src/lib/agents/autopilot.ts` (`runAgentLoop`) |
| Deterministic bounded knob search with restore-best | `runAutopilot` |
| Durable session timeline (localStorage) | `src/lib/agents/agentSession.ts` |
| Autopilot UI with live schematic/waveform feedback | `src/components/ecad/AgentPanel.tsx`, `src/components/ecad/agent/AutopilotWorkbench.tsx` |

Limits of the local runner: the tab must stay open, work stops when the tab is
closed or the device sleeps, simulations compete with rendering for one thread,
and there is no multi-user scheduling or server-side audit retention.

## What requires cloud infrastructure

These are **not implemented in this repository** and need a deployed backend:

1. **Always-on execution.** A job queue plus worker that keeps running after the
   browser disconnects.
2. **Headless CAD runtime per job.** A worker process running this project's
   solver and `createMemoryCadRuntime`/`registerCadTools` without a DOM.
3. **Durable design storage and audit retention.** Blob/object storage for
   winner designs and event logs; local storage is per browser and capped.
4. **Authentication and quotas.** Exchange the user's Supabase session for a
   short-lived, scoped agent-job token; enforce plan limits and rate limits.
5. **Multi-tenant isolation and sandboxing.** Each job must run in an isolated
   sandbox with CPU/memory/time limits.
6. **Observability and cancellation.** Structured logs, metrics, and a reliable
   cancel path.

No server code is included. The browser transport and protocol are implemented
and tested; a deployment must implement the endpoints below.

## Configuration

Copy `.env.example` to `.env` and set:

```dotenv
VITE_AGENT_CLOUD_URL=https://agents.example.com
VITE_AGENT_CLOUD_TOKEN=short-lived-job-token
```

Both are optional. With no `VITE_AGENT_CLOUD_URL`, the UI reports that cloud
agents are unavailable and local autopilot still works.

Security: every `VITE_*` value is compiled into the public bundle. Never put a
service credential there. `VITE_AGENT_CLOUD_TOKEN` must be short-lived and
scoped to one user/job, minted by an authenticated backend. Prefer exchanging a
Supabase access token at request time over embedding any token in the bundle.

## Protocol

Schema: `folio.agent-job/1`. Base URL: `VITE_AGENT_CLOUD_URL`.

### Submit a job

`POST /v1/agent/jobs`

```json
{
  "schema": "folio.agent-job/1",
  "clientJobId": "session-1730000000000-1",
  "title": "Ripple tuner",
  "projectId": "optional-project-id",
  "goal": {
    "description": "Minimise output ripple",
    "analysis": { "type": "transient", "stopTime": 0.004, "stepTime": 0.00001 },
    "metric": { "waveform": "V(OUT)", "statistic": "ripple", "settled": true },
    "knobs": [{ "reference": "C1", "property": "value", "from": 0.000002, "to": 0.00047, "scale": "log" }],
    "constraints": { "requireErcPass": true, "requireAllRated": true }
  },
  "design": { "components": [], "wires": [] },
  "firmware": "",
  "budget": { "maxCalls": 100, "maxWallMs": 300000 },
  "approvalMode": "auto",
  "createdAt": "2026-10-24T00:00:00.000Z"
}
```

`clientJobId` is the idempotency key: re-submitting it must not start a second
job. `approvalMode: "auto"` lets the worker apply low-risk edits without a human
gate; use `"on-write"` when a human must approve mutations.

Response: `200/201`

```json
{ "jobId": "job-9", "state": "queued" }
```

### Poll status

`GET /v1/agent/jobs/{jobId}`

```json
{
  "id": "job-9",
  "state": "running",
  "createdAt": "2026-10-24T00:00:00.000Z",
  "updatedAt": "2026-10-24T00:01:10.000Z",
  "progress": { "step": 12, "total": 40, "message": "Sweeping C1" },
  "result": {
    "achieved": true,
    "reason": "Target met: Ripple 0.0100 V (target 0.0200 ± 0.0050) at C1.value = 0.000047.",
    "fingerprint": "abc123",
    "bestIteration": 7,
    "bestMetric": 0.01,
    "metricLabel": "Ripple",
    "metricUnit": "V"
  }
}
```

States: `queued`, `running`, `succeeded`, `failed`, `cancelled`, `expired`.
The last four are terminal.

### Events

`GET /v1/agent/jobs/{jobId}/events?after={seq}`

```json
{
  "events": [
    {
      "seq": 12,
      "at": "2026-10-24T00:01:10.000Z",
      "type": "iteration",
      "message": "Best point",
      "iteration": 7,
      "phase": "sweep",
      "metric": 0.01,
      "metricLabel": "Ripple",
      "metricUnit": "V",
      "goalMet": true,
      "fingerprint": "abc123"
    }
  ]
}
```

Event types: `status`, `observation`, `tool`, `iteration`, `log`, `result`,
`error`. `after` is exclusive; return events with `seq > after`.

With `Accept: text/event-stream`, the same endpoint streams `data: {event}\n\n`
frames and ends with `data: [DONE]\n\n`. The browser client consumes both forms.

### Cancel

`POST /v1/agent/jobs/{jobId}/cancel`

Returns any 2xx status. Cancellation is cooperative: the worker must stop before
the next tool call and persist the best design found so far.

## Worker implementation checklist

A conforming worker can be built from the existing modules:

1. Reconstruct `CadDesignState` from `design` and call
   `createMemoryCadRuntime(design)`.
2. Create an `AgentHarness`, call `registerCadTools(harness, runtime)`.
3. Run `runAutopilot({ runtime, harness, goal, budget, onEvent })` or
   `runAgentLoop(...)` for open-ended work.
4. Map `onEvent` payloads to `AgentJobEvent` frames and persist them.
5. On completion, submit `result` with the fingerprint of the live design and the
   restored best iteration; store the final `components`/`wires` for the user.
6. Enforce the call and wall-time budgets in the worker as well as in the client;
   the browser budget is a convenience, not a trust boundary.
7. Sandbox: no network egress except the control plane, bounded CPU/memory, and
   a hard wall clock.

The worker must run the **same solver version** as the browser build it serves.
Persist the app version with every job; a solver change can alter results.

## Client behaviour when the cloud is unavailable

`cloudAgentTransportFromEnv()` returns an inert transport whose calls throw
`CloudAgentUnavailableError` with a reason mentioning the missing configuration.
The Agent panel shows that reason and keeps local autopilot enabled; it does not
silently retry or fabricate a job id.
