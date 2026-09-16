# Issue tracker: GitHub

Issues and PRDs live in GitHub Issues for
`invariantengineering/lexlatam-voice-agent`. Use the `gh` CLI, with an explicit
`--repo invariantengineering/lexlatam-voice-agent` argument for issue operations.

## Conventions

- Publishing to the issue tracker means creating a GitHub issue.
- Read the relevant issue, its labels and comments before updating it.
- Check existing issues before publication to avoid duplicate work.
- Save complete issue bodies as repository-local Markdown first. Use
  `--body-file` for creation and updates to preserve multiline text.
- Keep planning artifacts in the existing ignored `.scratch/prds/` directory.
  Confirm the path is ignored before writing. Do not stage or commit these
  artifacts without an explicit request.
- Apply the labels defined in [triage-labels.md](triage-labels.md).
- Treat approval to plan or publish a PRD separately from approval to implement,
  commit, push, merge or deploy.

Use `gh issue view` to fetch a ticket, `gh issue list` to find related work,
`gh issue create` to publish, and `gh issue edit` to update a body or labels.
Commenting and closing issues require authorization within the current task.
