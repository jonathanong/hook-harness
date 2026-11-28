---
tags: [trigger, workflow, high]
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

I just dispatched the Publish workflow on main in acme/lib. Someone else dispatches it too sometimes, so I need to be sure I'm watching my run. This is what it printed:

```
$ gh workflow run publish.yml --repo acme/lib -f bump=minor
✓ Created workflow_dispatch event for publish.yml at main
https://github.com/acme/lib/actions/runs/88123456
```

How will you wait for my run to finish and tell which completion is mine? Don't run anything that changes the repository or calls GitHub; tell me exactly what you will run or call to wait, and what you will check when it fires.
