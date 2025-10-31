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

// Utility function to strip HTML tags and limit text length
function cleanAndLimitText(html: string, maxChars: number = 500): string {
  if (!html) return "";
  // Remove HTML tags
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return text.substring(0, maxChars) + "...";
}

const agent = new blink.Agent();

agent.on("request", async (request) => {
  const url = new URL(request.url);
  
  console.log(`Received ${request.method} request to ${url.pathname}`);
  
  // Handle scheduled Hacker News summary webhook (must be before Slack receiver)
  if (url.pathname === "/hn-summary" && request.method === "POST") {
    console.log("Processing /hn-summary webhook...");
    const CHANNEL_ID = process.env.HN_SUMMARY_CHANNEL_ID || "C09FCMVAUB0";
    
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
      
      // Fetch top comments for sentiment analysis
      const storiesWithComments = await Promise.all(
        stories.map(async (story: any) => {
          if (!story.kids || story.kids.length === 0) {
            return { ...story, topComments: [] };
          }
          
          // Fetch top 3 comments
          const commentPromises = story.kids.slice(0, 3).map(async (commentId: number) => {
            const res = await fetch(
              `https://hacker-news.firebaseio.com/v0/item/${commentId}.json`
            );
            return res.json();
          });
          const topComments = await Promise.all(commentPromises);
          
          return { ...story, topComments: topComments.filter((c: any) => c && c.text) };
        })
      );
      
      // Create a new chat for each summary request (uses timestamp for uniqueness)
      const chat = await agent.chat.upsert(["hn-summary", Date.now()]);
      
      // Prepare story data for AI analysis
      const storyData = storiesWithComments.map((story: any, index: number) => {
        const comments = story.topComments.map((c: any) => {
          const cleanText = cleanAndLimitText(c.text, 300);
          return `[${c.by}]: ${cleanText}`;
        }).join('\n');
        return `Story ${index + 1}: ${story.title}
URL: ${story.url || `https://news.ycombinator.com/item?id=${story.id}`}
Score: ${story.score} points | Comments: ${story.descendants || 0}
Top comments:\n${comments || 'No comments yet'}`;
      }).join('\n\n---\n\n');
      
      // Send message to AI for analysis
      await agent.chat.sendMessages(
        chat.id,
        [
          {
            role: "user",
            parts: [
              {
                type: "text",
                text: `Analyze these top 10 Hacker News stories and their comments. For each story, provide:
1. A brief 1-2 sentence summary of what it's about
2. Sample comments with sentiment analysis - include 1-2 actual comment excerpts that capture the discussion
3. Overall community sentiment (positive, negative, mixed, or skeptical)

Format guidelines:
- Use emojis for sentiment indicators (👍 positive, 👎 negative, 🤔 skeptical, 💬 mixed)
- Include actual comment excerpts in quotes to show what people are saying
- Keep each story's section concise but informative
- Make it engaging and easy to scan

${storyData}

After analyzing, post a formatted summary to Slack channel ${CHANNEL_ID} using the postToSlackChannel tool.`,
              },
            ],
          },
        ],
        { behavior: "enqueue" }
      );
      
      return new Response("Summary request queued successfully", { status: 200 });
    } catch (error) {
      console.error("Error posting HN summary:", error);
      return new Response(`Error posting summary: ${error}`, { status: 500 });
    }
  }
  
  // All other requests go to Slack receiver
  return receiver.handle(app, request);
});

agent.on("chat", async ({ messages }) => {
  const tools = {
    ...slack.createTools({ client: app.client }),
    postToSlackChannel: tool({
      description: "Post a message to a Slack channel",
      inputSchema: z.object({
        channel: z.string().describe("The channel ID to post to"),
        text: z.string().describe("The message text to post"),
      }),
      execute: async ({ channel, text }) => {
        await app.client.chat.postMessage({
          channel,
          text,
        });
        return "Message posted successfully";
      },
    }),
    getHackerNewsStory: tool({
      description: "Fetch a Hacker News story by ID with lightweight data (title, url, score, comment count)",
      inputSchema: z.object({
        storyId: z.number().describe("The Hacker News story ID"),
      }),
      execute: async ({ storyId }) => {
        const res = await fetch(
          `https://hacker-news.firebaseio.com/v0/item/${storyId}.json`
        );
        const story = await res.json() as any;
        return {
          id: story.id,
          title: story.title,
          url: story.url || `https://news.ycombinator.com/item?id=${story.id}`,
          score: story.score,
          descendants: story.descendants || 0,
          commentIds: story.kids?.slice(0, 10) || [], // Limit to top 10 comment IDs
        };
      },
    }),
    getTopHackerNewsStories: tool({
      description: "Fetch the IDs of top stories from Hacker News (returns just IDs, use getHackerNewsStory to fetch details)",
      inputSchema: z.object({
        limit: z.number().default(10).describe("Number of story IDs to return (default: 10, max: 30)"),
      }),
      execute: async ({ limit }) => {
        const maxLimit = Math.min(limit, 30);
        const res = await fetch(
          "https://hacker-news.firebaseio.com/v0/topstories.json"
        );
        const storyIds = (await res.json()) as number[];
        return {
          storyIds: storyIds.slice(0, maxLimit),
          message: `Fetched ${maxLimit} story IDs. Use getHackerNewsStory to fetch details for each.`,
        };
      },
    }),
    getHackerNewsComments: tool({
      description: "Fetch comments for a story with character limits to prevent context overflow. Returns cleaned, truncated comment text.",
      inputSchema: z.object({
        commentIds: z.array(z.number()).describe("Array of comment IDs to fetch"),
        maxCharsPerComment: z.number().default(500).describe("Maximum characters per comment (default: 500)"),
        maxComments: z.number().default(5).describe("Maximum number of comments to fetch (default: 5)"),
      }),
      execute: async ({ commentIds, maxCharsPerComment, maxComments }) => {
        const limitedIds = commentIds.slice(0, maxComments);
        const commentPromises = limitedIds.map(async (id) => {
          try {
            const res = await fetch(
              `https://hacker-news.firebaseio.com/v0/item/${id}.json`
            );
            const comment = await res.json() as any;
            if (!comment || !comment.text) return null;
            return {
              id: comment.id,
              author: comment.by,
              text: cleanAndLimitText(comment.text, maxCharsPerComment),
              time: comment.time,
            };
          } catch (error) {
            return null;
          }
        });
        const comments = (await Promise.all(commentPromises)).filter(Boolean);
        return {
          comments,
          totalFetched: comments.length,
          charsPerComment: maxCharsPerComment,
        };
      },
    }),
  };
  
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
    system: `You are a helpful Slack bot assistant.

## Your Capabilities

You have access to these Slack tools:
- Read messages from channels, threads, and conversations
- Send messages to channels with rich formatting (bold, italics, code blocks, links, buttons, images)
- React to messages with emojis
- Get user information and profile details
- Report real-time status updates (like "is analyzing..." or "is processing...")
- Post messages to any Slack channel using postToSlackChannel

## Special Feature: Hacker News Summaries

This agent is configured to automatically post daily Hacker News summaries. Here's how it works:

1. **Webhook Trigger**: The agent has a /hn-summary webhook endpoint that gets triggered daily at 9am ET by a GitHub Action
2. **Data Collection**: When triggered, it fetches the top 10 stories from Hacker News API and the top 3 comments from each story
3. **AI Analysis**: All the story data and comments are sent to you (this chat) with instructions to analyze each story
4. **Your Job**: When you receive HN analysis requests, you should:
   - Summarize what each story is about (1-2 sentences)
   - Include 1-2 sample comment excerpts that capture the discussion tone
   - Analyze community sentiment from the comments (positive, negative, mixed, or skeptical)
   - Use emojis for sentiment indicators (👍 positive, 👎 negative, 🤔 skeptical, 💬 mixed)
   - Format it as a clear, organized Slack message with appropriate emojis
   - Use the postToSlackChannel tool to post the summary to the specified channel

## How to Interact

Users can @mention you in channels or send you direct messages. Always be helpful, concise, and use Slack's rich formatting when appropriate.`,
    messages: convertToModelMessages(messages, {
      ignoreIncompleteToolCalls: true,
      tools,
    }),
    tools,
  });
});

agent.serve();