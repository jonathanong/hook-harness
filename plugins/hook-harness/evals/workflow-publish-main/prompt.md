---
tags: [trigger, workflow, high]
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

I just ran `gh workflow run publish.yml -f bump=minor` on main in acme/lib (the workflow is named "Publish"). When it finishes I need to check that the new version is on npm. How will you wait for it? Don't run anything that changes the repository or calls GitHub; tell me exactly what you will run or call to wait, and what you will check when it fires.
