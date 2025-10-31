import { convertToModelMessages, streamText } from "ai";
import * as blink from "blink";
import * as slack from "@blink-sdk/slack";
import { App } from "@slack/bolt";
import { tool } from "ai";
import { z } from "zod";

const receiver = new slack.Receiver();
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  receiver,
});

// Handle messages in channels (only when @mentioned)
app.event("app_mention", async ({ event }) => {
  const chat = await agent.chat.upsert([
    "slack",
    event.channel,
    event.thread_ts ?? event.ts,
  ]);
  const { message } = await slack.createMessageFromEvent({
    client: app.client,
    event,
  });
  await agent.chat.sendMessages(chat.id, [message]);
  await app.client.assistant.threads.setStatus({
    channel_id: event.channel,
    status: "is typing...",
    thread_ts: event.thread_ts ?? event.ts,
  });
});

// Handle direct messages (always respond)
app.event("message", async ({ event }) => {
  // Ignore bot messages and message changes
  if (event.subtype || event.bot_id) {
    return;
  }
  // Only handle DMs (channel type is 'im')
  const channelInfo = await app.client.conversations.info({
    channel: event.channel,
  });
  if (!channelInfo.channel?.is_im) {
    return;
  }
  const chat = await agent.chat.upsert(["slack", event.channel]);
  const { message } = await slack.createMessageFromEvent({
    client: app.client,
    event,
  });
  await agent.chat.sendMessages(chat.id, [message]);
  await app.client.assistant.threads.setStatus({
    channel_id: event.channel,
    status: "is typing...",
    thread_ts: event.thread_ts ?? event.ts,
  });
});

const agent = new blink.Agent();

agent.on("request", async (request) => {
  const url = new URL(request.url);
  
  // Handle scheduled Hacker News summary webhook
  if (url.pathname === "/hn-summary" && request.method === "POST") {
    const CHANNEL_ID = "C09FCMVAUB0";
    
    try {
      // Fetch top stories from Hacker News
      const topStoriesRes = await fetch(
        "https://hacker-news.firebaseio.com/v0/topstories.json"
      );
      const topStoryIds = (await topStoriesRes.json()) as number[];
      
      // Fetch details for top 10 stories
      const storyPromises = topStoryIds.slice(0, 10).map(async (id) => {
        const res = await fetch(
          `https://hacker-news.firebaseio.com/v0/item/${id}.json`
        );
        return res.json();
      });
      const stories = await Promise.all(storyPromises);
      
      // Format summary message
      const blocks: any[] = [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "🔥 Top 10 Hacker News Stories",
            emoji: true,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `Good morning! Here are today's top stories from Hacker News:`,
          },
        },
        {
          type: "divider",
        },
      ];
      
      stories.forEach((story: any, index: number) => {
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${index + 1}. <${story.url || `https://news.ycombinator.com/item?id=${story.id}`}|${story.title}>*\n👍 ${story.score} points | 💬 ${story.descendants || 0} comments | by ${story.by}`,
          },
        });
      });
      
      blocks.push(
        {
          type: "divider",
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `<https://news.ycombinator.com/|View more on Hacker News>`,
            },
          ],
        }
      );
      
      // Post to Slack channel
      await app.client.chat.postMessage({
        channel: CHANNEL_ID,
        blocks,
        text: "Top 10 Hacker News Stories",
      });
      
      return new Response("Summary posted successfully", { status: 200 });
    } catch (error) {
      console.error("Error posting HN summary:", error);
      return new Response("Error posting summary", { status: 500 });
    }
  }
  
  return receiver.handle(app, request);
});

agent.on("chat", async ({ messages }) => {
  const tools = slack.createTools({ client: app.client });
  const lastMessage = messages[messages.length - 1];
  const threadInfo = lastMessage?.metadata as
    | { channel?: string; thread_ts?: string }
    | undefined;

  // Add instruction to clear status after completion
  if (threadInfo?.channel && threadInfo?.thread_ts) {
    const clonedMessages = structuredClone(messages);
    const lastClonedMessage = clonedMessages[clonedMessages.length - 1];
    if (lastClonedMessage) {
      lastClonedMessage.parts.push({
        type: "text",
        text: `*INTERNAL INSTRUCTION*: Clear the status of this thread after you finish: channel=${threadInfo.channel} thread_ts=${threadInfo.thread_ts}`,
      });
    }
    messages = clonedMessages;
  }

  return streamText({
    model: "anthropic/claude-sonnet-4.5",
    system: "You are a helpful Slack bot assistant.",
    messages: convertToModelMessages(messages, {
      ignoreIncompleteToolCalls: true,
      tools,
    }),
    tools,
  });
});

agent.serve();