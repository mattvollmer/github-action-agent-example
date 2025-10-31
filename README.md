# Hacker News Slack Bot

A Blink agent that posts daily Hacker News summaries to Slack and responds to mentions.

## Features

- **Daily HN Summaries**: Automatically posts top 10 Hacker News stories every morning at 9am ET
- **Interactive Bot**: Responds to @mentions in channels and direct messages
- **GitHub Action Scheduling**: Uses GitHub Actions to trigger daily summaries via webhook

## How It Works

### Slack Bot Functionality

The agent handles two types of Slack interactions:

1. **@mentions in channels**: When mentioned, the bot responds in a thread
2. **Direct messages**: Automatically responds to DMs without requiring mentions

### Daily Hacker News Summary

The agent exposes a `/hn-summary` webhook endpoint that:
1. Fetches the top 10 stories from Hacker News API
2. Formats them with scores, comment counts, and authors
3. Posts to Slack channel `C09FCMVAUB0`

### GitHub Action

The workflow (`.github/workflows/hn-summary.yml`) runs daily at 9am ET and triggers the webhook:

```yaml
schedule:
  - cron: '0 14 * * *'  # 9am ET (14:00 UTC)
```

## Setup

1. **Environment Variables** (`.env.local`):
   ```
   SLACK_BOT_TOKEN=xoxb-...
   SLACK_SIGNING_SECRET=...
   ```

2. **Deploy the Agent**:
   ```bash
   blink deploy
   ```

3. **Configure GitHub**:
   - Push this repository to GitHub
   - Add repository secret: `AGENT_WEBHOOK_URL` (your production agent URL)
   - The action will automatically run daily

4. **Manual Testing**:
   ```bash
   curl -X POST https://your-agent-url.blink.host/hn-summary
   ```

## Development

```bash
blink dev
```

Test the webhook locally:
```bash
curl -X POST https://your-dev-url.blink.host/hn-summary
```
