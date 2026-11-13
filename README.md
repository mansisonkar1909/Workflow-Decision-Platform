# Configurable Workflow Decision Platform (MERN)

Express + MongoDB (Mongoose) backend, React (Vite) UI, JSON-configured workflow engine.

## Run
```
cd server && npm i && npm test                 # 8 tests, no DB needed
MONGO_URI=mongodb://localhost:27017/wdp npm start   # omit MONGO_URI => in-memory repo
cd client && npm i && npm run dev              # UI on :5173, proxies /api to :4000
```
## API
| Method | Path | Purpose |
|---|---|---|
| POST | /api/workflows/:id/requests (header `Idempotency-Key` optional) | intake; 201 new, 200 duplicate, 422 invalid |
| GET | /api/requests/:id, /audit, /explain | state, full audit log, decision explanation |
| POST | /api/requests/:id/retry | resume a PENDING_RETRY request |
| POST | /api/requests/:id/review `{decision,reviewer,note}` | resolve MANUAL_REVIEW |
| POST | /api/workflows/reload | hot-load new workflow JSON/versions |

## Architecture
```
React UI -> Express routes (app.js) -> WorkflowService (intake, idempotency, retry, review, explain)
                                         -> Executor (stage state machine) -> Conditions (rule evaluator)
                                         -> Services (simulated creditBureau) / Registry (versioned JSON configs)
                                         -> Repo interface: MongoRepo | MemoryRepo   (requests + append-only audit)
```
Separation: **config** (what), **engine** (how, domain-agnostic), **repo** (persistence), **transport** (HTTP).
Nothing in `engine/` knows about loans; a new use case = a new JSON file under `config/workflows/`.

### Configuration model
Workflow = `{id, version, schema, start, stages}`. Stage types: `rules` (list of `{id, when, onFail: reject|manual_review|continue}`),
`dependency` (service, input mapping, retry policy, `onExhausted: pending|manual_review`, `store`), `branch` (first matching `when` -> goto, else default),
`outcome` (approved|rejected|manual_review). Conditions: `{field,op,value|valueFrom+factor}` composable with `all`/`any`;
ops: eq ne gt gte lt lte in exists. Fields address `payload.*` or stored dependency results (e.g. `credit.score`).

### Data flow
intake -> schema validate (422, nothing stored) -> idempotency lookup -> insert (unique index) -> execute stages, checkpoint after each
-> terminal state (APPROVED / REJECTED / MANUAL_REVIEW) or PENDING_RETRY. Every step appends an audit event.

### Robustness decisions
- **Idempotency**: key = header or SHA-256(workflow + canonical payload). Unique index `(workflowId, idempotencyKey)` makes races safe; the loser of a race returns the winner's record.
- **Dependency failure**: bounded in-stage retries with exponential backoff; on exhaustion the request parks as `PENDING_RETRY` at that stage (or goes to manual review if configured). Retry resumes from the checkpoint; earlier rules are not re-evaluated (tested).
- **Partial save failure**: state is checkpointed after each stage; if a write fails the request stays at its last checkpoint and `retry` re-runs only the unsaved stage. Stages are pure over (payload, context), so replay is safe. The audit event precedes the state write, so audit may over-report but never under-report.
- **Requirement changes**: each request is pinned to the workflow version at intake; new versions affect only new requests (tested).
- **Audit/explain**: per-rule events carry expected vs actual values (data reference). `/explain` returns input, external data, rules with pass/fail and values, outcome, and state history.

### Trade-offs / assumptions
- Declarative JSON DSL over embedded scripts: safe and inspectable, but not Turing-complete; escape hatch is adding an operator or a registered service.
- Synchronous execution in the request for simplicity; the executor is queue-agnostic.
- Mongo without multi-document transactions: single-document request updates + append-only audit; ordering favors audit completeness.
- Manual retry only (no scheduler). Auth, RBAC and config schema validation are out of scope.

### Scaling
Stateless API nodes behind a load balancer; move `execute` to a queue (BullMQ/SQS) with workers, with PENDING_RETRY driven by a delayed-job scheduler;
shard by `workflowId`/request id; audit to a separate collection with TTL/archival to cold storage; cache the registry and invalidate on reload;
circuit breaker around dependencies; optimistic versioning (`__v`) on requests to guard concurrent workers.

## Decision explanation example (`GET /api/requests/:id/explain`, amount 900000, income 100000)
```
input: {age:30, income:100000, amount:900000, pan:"OKAY1"}   externalData: {credit:{score:700}}
rules: R1_age_18_plus PASS (30>=18) | R2_min_credit_score PASS (700>=600) | R3_amount_within_3x_income FAIL (900000<=300000)
outcome: MANUAL_REVIEW - "R3_amount_within_3x_income failed: Amount exceeds 3x income"
```
Other scenarios (age 17 -> REJECTED by R1; score 800 -> branch skips R4; bureau outage -> PENDING_RETRY) are asserted in `server/test/workflow.test.js`.
