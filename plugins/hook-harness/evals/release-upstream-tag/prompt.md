---
tags: [trigger, release, high]
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

We're blocked until acme/sdk publishes its v3.0.0 GitHub release. As soon as it's out, bump our dependency on it. How will you wait for the release? Don't run anything that changes the repository or calls GitHub; tell me exactly what you will run or call to wait, and what you will check when it fires.
