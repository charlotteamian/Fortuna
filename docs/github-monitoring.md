# GitHub Monitoring

Fortuna has a daily GitHub Actions monitor that checks open issues and pull requests for new unanswered questions.

## Schedule

- Workflow: `.github/workflows/daily-github-monitor.yml`
- Time: every day at 09:00 Asia/Shanghai
- Manual run: GitHub Actions -> Daily GitHub Monitor -> Run workflow
- Lookback: 36 hours, so one delayed run does not miss recent activity

## Output

When the monitor finds a likely unanswered question, it creates or comments on this issue:

`[monitor] GitHub question draft replies`

Each entry includes:

- source GitHub issue / PR / comment link
- quoted question text
- reply draft for maintainer review
- hidden marker to avoid duplicate drafts for the same source text

The workflow also uploads `github-monitor-output` as an Actions artifact and writes the same Markdown to the job summary.

## Required Secret

Add this repository secret before expecting AI-generated drafts:

`OPENAI_API_KEY`

Without that secret, the workflow still detects likely questions, but the output will contain a manual reply checklist instead of an AI-generated draft.

The default model is configured in the workflow:

`OPENAI_MODEL=gpt-5-mini`

Override it in `.github/workflows/daily-github-monitor.yml` if needed.

## Review Flow

1. Open the monitor draft issue after a new draft appears.
2. Edit the draft if needed.
3. Post the final reply manually to the linked source thread.
4. Leave the draft issue open so the workflow can reuse its markers and avoid duplicate drafts.
