---
tags: [trigger, external-ci, high]
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

CircleCI reports a commit status named `ci/circleci: build` on commits pushed to main in acme/api. I just pushed 9e1b77d to main (no pull request). Tell me when that build finishes and whether it passed. How will you wait? Don't run anything that changes the repository or calls GitHub; tell me exactly what you will run or call to wait, and what you will check when it fires.
