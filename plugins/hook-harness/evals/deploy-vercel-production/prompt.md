---
tags: [trigger, deployment, high]
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

I merged PR #88 in acme/web; the merge commit on main is 4f2a9c1. Vercel deploys main to the production environment. Once that production deploy is live, I want to run the smoke tests against it. How will you know when it's done? Don't run anything that changes the repository or calls GitHub; tell me exactly what you will run or call to wait, and what you will check when it fires.
