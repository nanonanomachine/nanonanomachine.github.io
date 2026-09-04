---
title: "My Overnight Loop Kept Destroying Its Own Audit Trail"
date: 2026-08-27
---

When I started running my overnight loop (a coding agent that works on our repository at night, with a human reviewing every change before it merges), the target repo had both loop-generated changes and human-generated changes. For auditing the loop-generated changes, we needed audit trails. But the loop itself destroyed them.

This article is about how I fixed that, and how the fix ended up becoming an operations tool.

This is the follow up article of [Auditing 22 Days of an Overnight Coding-Agent Loop](https://yoheinakamura.dev/night-loop-audit/).

---

## TL;DR

- The loop recorded its attribution in the PR description. The loop erased it
- Moved it to commit trailers and append-only PR comments
- `attest.sh` reads them back. The loop itself started using it
- The remaining weaknesses are structural. They come from renting the runtime instead of owning it

## Context

When the loop finishes the coding work (called an `Attempt` in [the previous post](https://yoheinakamura.dev/night-loop-audit/#1-what-i-built)), it submits a PR to GitHub with an audit trail in the PR description.
After a PR lands, an AI review bot is triggered. The bot scores the PR, and until the score clears the threshold, the loop adds a fix commit, updates the description, and replies to the review comments. After that, a human reviews the PR.

![The attribution flow: the loop writes code and opens a PR, then bot-review rounds repeat — each rewriting the description — until the score clears and a human reviews](/night-loop-attest-flow.svg)

The problem is that both the loop and the review bot overwrite the PR description on update. The "loop attribution" note kept getting removed by those updates. **The loop keeps updating the deliverable, and it destroys the audit trail.**

Once the note was gone, it was hard to tell whether a PR came from the loop or a human. Reconstructing it afterwards topped out at 80% recall with 31 false positives, across the 56 loop PRs of the audit period ([previous post, §7](https://yoheinakamura.dev/night-loop-audit/#7-what-was-not-recorded)). Stopping the rewrites was not an option. The description is the loop's status board and is meant to be rewritten. The mistake was storing history in a place built for current state. I needed another mechanism to track the attribution.

---

## 1. Solution

**Constraints**

The overnight loop runs on Claude's subscription. Our company is small, I was the only one running the loop at the time, and we were still establishing the loop system. So running it on a server or relying on enterprise audit features of third-party services was out of scope.

**Options**

| No. | Option                                          | Pros                                                                                                                                                                                                                 | Cons                                                                                                                                                                     |
| --- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Git commit trailer                              | Rides on the commit itself, so the loop can't overwrite it afterwards; survives rebase; per-commit granularity tells loop commits from human rescue commits inside the same PR; same convention as `Co-authored-by:` | Squash merge drops it from main's history as a trailer — it stays readable only through GitHub's copy of the PR commits; merge commits can't carry one                   |
| 2   | [Git notes](https://git-scm.com/docs/git-notes) | Attaches metadata to a commit without changing its SHA; can annotate after the fact; stored in git itself                                                                                                            | Not pushed or fetched by default, so clones don't see them; GitHub UI doesn't display them; mutable and easy to lose on history rewrite                                  |
| 3   | PR label                                        | One API call, visible and filterable in the GitHub UI. Good for signalling live state. Add/remove events are kept in the PR timeline. Append-only and actor-stamped, not editable afterwards                         | Current state is mutable by anyone with triage access, so reading labels alone proves nothing — history requires the events API                                          |
| 4   | Log file in the repository                      | Survives squash merge (tree content, not commit-message metadata); lives in every clone, independent of GitHub's PR data                                                                                             | Merge conflict happens frequently. It records only merged work. A later commit can silently rewrite past entries                                                         |
| 5   | Append-only PR comment                          | A separate timeline object — the loop's own body rewrites can't touch it                                                                                                                                             | Append-only is a discipline, not an enforcement — a comment body can still be edited or deleted afterwards (label events can't); lives only in GitHub, not in git at all |

None of the options is perfect, so I combined two of them to fill each other's gaps:

- No.1 Git commit trailer for **what the loop wrote**
  - Two trailer lines per commit — the run id and the round. Hard to overwrite, per-commit granularity, but squash merge drops them from main's history
- No.5 Append-only PR comment for **what the loop did**
  - Some loop actions produce no commit at all: opening, rebasing, and rebutting leave no commit to carry a trailer, but the comment still records them
  - Also covers unmerged and abandoned PRs, though a comment itself can still be edited or deleted

Example:

No.1 (Git commit)

```
[ENG-1111] fix: ...

...

Night-Loop-Run: 2026-08-20_030704
Night-Loop-Round: 1
```

No.5 (GitHub comment)

```
<!-- night-loop-attest {"run":"2026-08-20_030704","event":"round","round":1} -->
🤖 night-loop attestation — run 2026-08-20_030704, review round 1.
Machine marker, append-only: later rounds add new comments, nothing edits this one.
```

---

## 2. `attest.sh`

Now I can track the loop attribution, but understanding a PR's situation by hand is still tedious: not only do I have to check every commit and PR comment, but human commits can be mixed in, so "human attribution" has to be counted as well.

I created a simple shell script called `attest.sh` which outputs the attribution information per PR.

Example outputs:

```
PR #1234
  created          2026-08-18
  commits marked   3/3
  runs             2026-08-19_030705
  trailer rounds   0 1
  attestations:
    {"run":"2026-08-19_030705","event":"open","ticket":"ENG-1111","round":0}
    {"run":"2026-08-19_030705","event":"round","ticket":"ENG-1111","round":1}
  verdict          LOOP (all commits carry both trailers)
```

```
PR #5678
  created          2026-08-05
  commits marked   5/11
  runs             2026-08-06_030705 2026-08-08_030705
  trailer rounds   0 1 2
  attestations:
    {"run":"2026-08-06_030705","event":"open","ticket":"ENG-2222","round":0}
    {"run":"2026-08-08_030705","event":"round","ticket":"ENG-2222","round":1}
    {"run":"2026-08-08_030705","event":"round","ticket":"ENG-2222","round":2}
    {"run":"2026-08-15_030705","event":"reconcile","ticket":"ENG-2222","round":2}
  verdict          MIXED (5/11 commits marked)
```

The former example shows a PR done entirely by the loop, including one review-fix round (round 1). In the latter, humans intervened: 5 of 11 commits carry the loop's trailer, and the 6 unmarked ones are human rescue commits added after the loop's last attestation.

How to read `commits marked M/T`

- `N/N`: every commit carries the trailer, which means they're written entirely by the loop
- `0/N`: no markers: either a human wrote it, or the loop wrote it before the scheme existed. The two are indistinguishable, which is what the epoch guard below is for
- in between: mixed, marked commits are the loop's, unmarked ones are human (rescue commits, merge commits)

Counting markers naively (substring search) does not work well because the same string can appear by coincidence. So markers only count in the trailer position (last paragraph, start of line, with a valid value), and attestation comments only count when the PR's author wrote them.

Attestation event types

| Event       | When it is written                                             | Payload                          |
| ----------- | -------------------------------------------------------------- | -------------------------------- |
| `open`      | The run opens the PR (still draft)                             | run id, ticket, `round: 0`       |
| `round`     | Before each review-round fix push                              | run id, ticket, `round: N`       |
| `reconcile` | A later run rebases a stale open PR onto the moved main branch | run id, ticket, last known round |

NOTE: the table above lists `reconcile` as if it were designed in. It was not. The scheme defined only `open` and `round`. The first time a run had to rebase a stale PR, the loop invented `reconcile` on the spot and wrote it into an attestation — and since nothing validates event names, the new name just went through. Good and bad at once: the loop can record a new kind of action without a code change, and a different name for the same action would go through the same way.

Verdict types

| Verdict           | Meaning                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------- |
| `LOOP`            | Every commit is done by the loop                                                             |
| `LOOP-INCOMPLETE` | Attribution is loop, but the round history has gaps (run id present, round missing)          |
| `MIXED`           | Loop commits and human commits inside the same PR                                            |
| `HUMAN`           | No markers on a PR created after the scheme's epoch                                          |
| `PRE-SCHEME`      | Created before the scheme existed. It means unattestable — absence of markers proves nothing |

NOTE: epoch: 2026-08-06, the day the scheme started writing markers. A PR created before that carries no markers even if the loop wrote it. So on those PRs, absence of markers proves nothing. 
Markers found on an old PR still count — the epoch only guards the inference from absence. That is why PR #5678, created a day before the epoch, still gets a verdict: its five marked commits are positive evidence, and its six unmarked commits were added after the epoch, so reading their absence as human is safe too.

The epoch was added because `attest.sh` misjudged the loop attribution as human attribution.

Before:

```
PR #9012
  commits marked   0/5
  attestations     (none)
  verdict          HUMAN (no loop markers)
```

After:

```
PR #9012
  created          2026-08-02
  commits marked   0/5
  attestations     (none)
  verdict          PRE-SCHEME (created 2026-08-02, before the 2026-08-06 attribution scheme — unattestable; absence of markers proves nothing)
```

My takeaway: **the verdict is also a claim** (same as [6. Finding 4 — "The claim outran its evidence" recurs across layers](https://yoheinakamura.dev/night-loop-audit/#6-finding-4-the-claim-outran-its-evidence-recurs-across-layers))

---

## 3. Audit tool became an operations tool

`attest.sh` started as an audit tool. I built it to answer "who wrote this PR" after the fact. Then the loop itself started to use the script:

**a. Recovering abandoned PRs (start of every run)**
A loop's run can die halfway. That is what happened to PR #5678 — the MIXED example from section 2: the run opened the PR, then crashed before writing its own bookkeeping. So the PR existed on GitHub, but no record on our side said it was in flight. An orphan.

The next run ran `attest.sh` on it. Nothing on the PR page says which run opened a PR or when it died. The commit trailer does: the run id inside it names the exact run, date and time, that authored the commits. That was enough to adopt the orphan and finish the work.

Since then, attesting every open PR the loop has opened is a standard step at the start of every run, before it selects any new work.

**b. Release gate (before hand-off)**
Before a PR leaves draft, the run attests it, and the verdict must be `LOOP`. If it comes back `MIXED` or `LOOP-INCOMPLETE`, the loop's own commits are missing markers. At that point the history is still private to the branch, so the fix is to amend the commits and re-attach the markers. The loop's instruction file states the rule explicitly: **"fix the loop's commits, never the verifier."**

**c. Morning digest**
`report.sh` posts a summary to Slack every morning, running `attest.sh` per PR and attaching the verdict. When attest itself fails, the digest shows "(attest failed)" instead of guessing.

This routine also surfaced a blind spot: "ready for review" does not mean "able to merge". The loop considers a PR finished when it hands it off to review, and finished PRs were exempt from that sweep. The same PR #5678 had already passed the review threshold, yet sat unmergeable (CONFLICTING) for nine days. Two runs saw it, and both correctly concluded, in effect, "not my problem". The exemption was designed to avoid touching finished work; it also created a hole in the watch.

The same script runs twice in one night with two different jobs: at the start of a run it checks what earlier runs left behind, and at release it checks the run's own work before handing it off.

---

## 4. Weakness of the current solution

The solution is not perfect:

**a. Verdict is just a snapshot**
After the loop opened the PR, humans may add changes later. A verdict from `attest.sh` is just a snapshot taken at that moment: a property of a point in time, not of the PR.
The same PR #5678 again: its verdict was `3/3 LOOP` on 2026-08-08, before the human rescue commits landed. Now it's `5/11 MIXED`. A verdict quoted in a document can silently go stale.

**b. It's durable against accidents but powerless against forgery**
The git commit trailer and the append-only PR comment protect against accidents: PR body overwrites, rebases, and loss of information over time. However, the loop runs as my own GitHub account, so the operator can forge in both directions:

- Add a git commit trailer to a human-made commit
- Remove a git commit trailer from a loop-made commit and push

Attribution is 100% mechanical as long as nobody lies. Preventing forgery would need a separate identity for the loop (its own account or signing key). That is outside the current threat model, and an acceptable gap for a solo operation. A bot account alone would not close it either: it can say "a bot committed this," but not which run or round, and with its credentials on the same machine, it is no harder to forge. The same goes for a dedicated signing key.

**c. Source of truth is on GitHub, not git itself**
After a squash merge, both markers survive only in GitHub's database, not in your clone. `attest.sh` reads the PR's original commit list, which GitHub keeps but a clone of main does not have. The append-only comments are GitHub objects to begin with.

So the design achieved "a place the loop cannot rewrite," but that is not the same as "a place that cannot be lost". If I lose the GitHub repository, the audit trail goes with it. The next iteration writes the verdicts down inside the repository too: the nightly sweep already computes them, so appending them to a file is one more output of an existing job, not a new system.

There is a structural reason behind all three weaknesses. This loop rents everything: the model is a subscription, the code is on GitHub. And the loop itself is just a script. No part of this setup is a pipe I own where every action passes through. So I can only do forensics: reconstruct what happened later from whatever the loop left behind.

Some systems avoid the problem entirely because they own the runtime. [Cloudflare's agent platform](https://blog.cloudflare.com/how-we-use-ai-with-cloudflare-os/) records every agent action at its own gateway. [Apache Maka](https://github.com/apache/maka) writes every agent action to a local append-only log first, and the UI just renders that log. [pi](https://github.com/earendil-works/pi), an agent harness library, lets you subscribe to a run as an event stream.

So far, renting has been the right call. It is what makes an overnight loop affordable for a small company. Whether that stays true is an open question: some model vendors now allow subscription auth from third-party harnesses (coding-agent clients other than the vendor's own), which would put a loggable runtime on flat-rate economics. I am looking into it.

---

## 5. Summary

My overnight loop destroyed its own audit trail by rewriting its PR descriptions. I moved the attribution to places the loop's own updates do not touch:

- Commit trailers for what it wrote
- Append-only comments for what it did

I packaged the reading side as `attest.sh`. The surprise was that the audit tool turned into an operations tool:
- The loop now uses it to recover abandoned PRs
- The loop checks its own discipline before handing a PR off

[The previous article](https://yoheinakamura.dev/night-loop-audit/) audited the whole loop; this one was about the smallest part that makes such an audit possible.

This is probably not just my problem. If agents commit to your repository, some changes end up with no record of who (or what) wrote them.

None of this required owning any infrastructure, and that is also its limit. If you own the runtime, you can log. If you rent it, forensics is all you have.
