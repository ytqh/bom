# Review-policy Action

The standalone `review-policy/` Action asks whether a PR needs an unresolved owner decision. It is **not** a code-correctness review or a mergeability check. Keep CI, agent-review, and existing review obligations separate and unchanged. Install the bomoon-bot App first; a compatible service must also be deployed. This Action is not yet live-verified.

It shares the existing [Review Action](review-action.md) transport, but uses a separate endpoint and OIDC audience. **Only exact App conclusion `success` passes.** `neutral`, `skipped`, `action_required`, cancellation, missing results, and errors never pass. Drafts fail if the Action is invoked; the workflow below avoids invoking it for draft PR events.

## Advisory workflow

Start advisory: do not make this job required yet. Put the workflow on the default branch so comment events run trusted workflow code. Set `BOMOON_REVIEW_SERVICE_URL` to a trusted HTTPS service origin; never derive it from PR content. Replace `<ACTION_COMMIT_SHA>` with the reviewed public Action implementation commit, not a moving branch.

```yaml
name: Review policy
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review, edited]
  issue_comment:
    types: [created, edited, deleted]
permissions:
  id-token: write
  checks: read
  pull-requests: read
concurrency:
  group: review-policy-${{ github.event.pull_request.number || github.event.issue.number }}
  cancel-in-progress: true
jobs:
  review-policy-request:
    name: review-policy-request
    if: >-
      (github.event_name == 'pull_request' && !github.event.pull_request.draft) ||
      (github.event_name == 'issue_comment' && github.event.issue.pull_request &&
       (github.event.action != 'created' ||
        startsWith(github.event.comment.body, '/review-policy ')))
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: ytqh/bomoon-bot/review-policy@<ACTION_COMMIT_SHA>
        with:
          service-url: ${{ vars.BOMOON_REVIEW_SERVICE_URL }}
```

The job name deliberately differs from the App-owned **`review-policy`** check. That App check is the future required gate, not this Actions transport job. Comment workflows run on the default branch; their Actions job cannot satisfy a PR-head check. Advisory rollout and labeled evaluation must precede any deliberate branch-settings change. This implementation changes no branch settings, permissions, CODEOWNERS, automatic merge settings, or existing CI/agent-review workflow.

Use a runner supporting Node 24. There is no checkout step, and the Action never executes PR code. It supports only `pull_request` and PR `issue_comment` events, not `pull_request_target` or arbitrary PR/SHA inputs. If fork OIDC is unavailable, it fails; do not widen permissions as a workaround.

## Owner resolution

Use a top-level PR comment, with a full **40-character lowercase head SHA** and a reason:

```text
/review-policy approve aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa Contract decision accepted because ...
/review-policy revoke aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa Previous decision withdrawn because ...
```

The service, not this Action or the payload's author fields, verifies that the approval command's author is currently a human repository admin. A signed default-branch workflow can request re-evaluation even after its actor loses admin access, so withdrawal is not lost; triggering the workflow grants no approval. PR authors who are admins can resolve an owner decision this way; the command is not a GitHub code-review approval. Bots, non-admins, quoted commands, partial SHAs, and commands for other heads cannot grant approval.

The service reads trusted policy from `.github/review-policy.md` on the default branch and evaluates the exact PR head. Owner resolution applies only to a valid escalation; it cannot excuse missing policy, invalid judgment, or infrastructure errors. The service must re-read live comments and permissions before finalizing. Editing/deleting a command or moving the head must invalidate withdrawn/stale approval; conflicting admin decisions use conservative revoke-wins handling.

Both the workflow and Action forward all PR-comment edits/deletions so withdrawal is not lost when the former command body is absent. Only new comments are filtered by the command prefix; the service decides authority and relevance from live evidence. The Action does not parse a command as local approval: it only submits `{pr, head_sha}` and waits for the App verdict. Unsupported or irrelevant events fail closed if invoked directly.

## Transport and trust boundary

Inputs and outputs match the Review Action:

| Input | Meaning |
| --- | --- |
| `service-url` (required) | Trusted HTTPS origin only; no path, query, fragment, or userinfo. |
| `github-token` | Defaults to `${{ github.token }}`; sent only to `https://api.github.com` to read PRs and checks. |

Outputs are `conclusion` (exact App conclusion), `check-url`, and `head-sha`. Errors do not produce a passing result. OIDC audience is fixed to **`bomoon-bot:review-policy`**:

```http
POST /github/review-policy
Authorization: Bearer <GitHub OIDC token>
Content-Type: application/json

{"pr":7,"head_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
```

The service validates the signed workflow context, including PR merge-commit/head binding for PR events, or trusted default-branch workflow context for comment events. Human-admin authority is checked against live approval commands, not inferred from the trigger. Neither body fields nor local payload identity establish authority. The response must be HTTP 202 with exactly:

```json
{
  "check_id": 123,
  "check_url": "https://github.com/example/project/runs/123",
  "head_sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "app_id": 456
}
```

For PR events, the Action compares the event head to the live PR before requesting a check. For comment events, it fetches the live head instead of using the workflow's default-branch SHA. Both require the expected repository and an open, non-draft PR. It polls the accepted check ID, validates head/App identity, then re-reads the PR and repository before reporting any terminal conclusion. Head movement, closure, or draft conversion fails as stale. The service is responsible for final policy/approval freshness; the Action does not read or cache approvals.

Existing transport protections remain: no redirects, sanitized errors, credential masking and origin separation, a 25-minute overall deadline, 15-second request timeouts, and at most four attempts on transient network/429/5xx failures. Retried POSTs use the same body. The Action never writes checks, reviews, or comments, and never approves or merges a PR. The legacy `review/` Action keeps its existing audience, endpoint, neutral handling, and draft-skip behavior.

## Evaluation and validation

Before enforcement, select historical PRs and have the owner label them. Do not treat model verdicts as ground truth. Keep labels blank until reviewed:

| PR URL | Exact head SHA | Trusted policy commit | Owner label | Observed verdict / evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| `<PR_URL>` | `<FULL_HEAD_SHA>` | `<POLICY_COMMIT_SHA>` | | | |

Include routine fixes, unresolved owner decisions, policy changes, incomplete evidence, and approval withdrawal/head movement. Evaluate correctness and false escalations separately from CI and agent-review results.

Run the existing regression suite with `node --test review/index.test.mjs`. Those tests cover legacy transport behavior; new policy-specific acceptance tests remain outstanding. Mocked checks and local syntax validation are not live GitHub E2E proof. Deployment, signed OIDC verification, live admin permission checks, policy freshness, and comment-withdrawal behavior need separate integration validation before enforcement.
