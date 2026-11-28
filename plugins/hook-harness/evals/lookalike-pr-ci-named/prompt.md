---
tags: [no-trigger, pr, high]
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

We use hook-harness for waiting on GitHub events. CI is running on PR #12 in acme/app. Wait for the checks to finish and tell me whether they passed. How will you wait? Don't run anything that changes the repository or calls GitHub; tell me exactly what you will run or call to wait, and what you will check when it fires.
