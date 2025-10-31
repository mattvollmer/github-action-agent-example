# Hacker News Slack Bot

A Blink agent that posts daily Hacker News summaries to Slack and responds to mentions.
<img width="1229" height="875" alt="image" src="https://github.com/user-attachments/assets/0e20e7cc-d66e-4f52-a32d-fc09bdc903f1" />


## Features

- **Daily HN Summaries**: Automatically posts top 10 Hacker News stories every morning at 10am ET
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

1. **Environment Variables** (`.env.local` and `.env.production`):
   ```
   SLACK_BOT_TOKEN=xoxb-...
   SLACK_SIGNING_SECRET=...
   HN_SUMMARY_CHANNEL_ID=C09FCMVAUB0  # Replace with your channel ID
   ```

2. **Add Bot to Slack Channel**:
   - In Slack, go to the channel where you want daily summaries
   - Right-click the channel name → View channel details → Integrations
   - Click "Add apps" and add your bot

3. **Find Your Slack Channel ID**:
   
   **Method 1 - From Channel URL:**
   - Open the Slack channel in your browser or desktop app
   - Look at the URL: `https://app.slack.com/client/T123ABC/C09FCMVAUB0`
   - The last part (`C09FCMVAUB0`) is your channel ID
   
   **Method 2 - From Channel Details:**
   - Right-click the channel name → View channel details
   - Scroll to the bottom of the "About" tab
   - Copy the Channel ID shown there
   
   **Method 3 - Ask Your Bot:**
   - Send a DM to your bot: "What channel am I in?"
   - The bot can use Slack tools to tell you the channel ID
   
   - Update `HN_SUMMARY_CHANNEL_ID` in your `.env.local` and `.env.production` files

4. **Deploy the Agent**:
   ```bash
   blink deploy
   ```
   
   After deployment, copy your production URL (e.g., `https://your-agent.blink.host`)

5. **Configure GitHub Action Webhook**:
   
   The GitHub Action needs to know where to send the webhook. Add the webhook URL as a repository secret:
   
   **Step-by-step:**
   1. Push this repository to GitHub
   2. Go to your repository on GitHub
   3. Click **Settings** → **Secrets and variables** → **Actions**
   4. Click **New repository secret**
   5. Name: `AGENT_WEBHOOK_URL`
   6. Value: `https://your_webhook_id.blink.host` (no trailing slash)
   7. Click **Add secret**
   
   The GitHub Action (`.github/workflows/hn-summary.yml`) will automatically run daily at 9am ET and POST to this webhook URL.

6. **Manual Testing**:
   ```bash
   curl -X POST https://your_webhook_id.blink.host/hn-summary
   ```

## Development

```bash
blink dev
```

Test the webhook locally:
```bash
curl -X POST https://your_webhook_id.blink.host/hn-summary
```
