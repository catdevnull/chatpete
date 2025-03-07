import { Bot, Context, GrammyError, HttpError } from "grammy";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { type CoreMessage, generateText } from "ai";
import { google } from "@ai-sdk/google";

import * as fs from "fs";
import * as path from "path";
import { escape } from "./md2tgmd";

type Message = {
  id: number;
  inReplyToId: number | null;
  chatMessage: string;
  timestamp: number;
} & (
  | {
      username: string;
      wasSearch: boolean;
      isBot: false;
    }
  | { isBot: true }
);

class MessageStore {
  private messages: Map<number, Message> = new Map();

  addMessage(message: Message): void {
    console.log("Adding message:", message);
    this.messages.set(message.id, message);
  }

  getMessageChain(messageId: number): Message[] {
    const chain: Message[] = [];
    let currentId: number | null = messageId;

    while (currentId !== null) {
      const message = this.messages.get(currentId);
      console.log(currentId, message);
      if (!message) break;

      chain.unshift(message);
      currentId = message.inReplyToId;
    }

    return chain;
  }
}

const messageStore = new MessageStore();

const requiredEnvVars = ["BOT_TOKEN", "OPENROUTER_API_KEY"];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`${envVar} is not set in environment variables`);
  }
}

const DATA_DIR = process.env["DATA_DIR"] || ".";
const ALLOWED_USERS_FILE = path.join(DATA_DIR, "allowed_users.json");

function loadAllowedUsers(): number[] {
  try {
    if (!fs.existsSync(ALLOWED_USERS_FILE)) {
      fs.writeFileSync(ALLOWED_USERS_FILE, JSON.stringify([], null, 2));
      return [];
    }
    const data = fs.readFileSync(ALLOWED_USERS_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error loading allowed users:", error);
    return [];
  }
}
function saveAllowedUsers(users: number[]): void {
  fs.writeFileSync(ALLOWED_USERS_FILE, JSON.stringify(users, null, 2));
}

let ALLOWED_IDS = [
  ...(process.env["ALLOWED_IDS"]
    ?.split(",")
    .map(Number)
    .filter((id) => !isNaN(id)) || []),
  ...loadAllowedUsers(),
];

const bot = new Bot(process.env["BOT_TOKEN"]!);
const openrouter = createOpenRouter({
  apiKey: process.env["OPENROUTER_API_KEY"],
});

bot.on("message", async (ctx: Context) => {
  if (!ALLOWED_IDS.includes(ctx.from?.id!)) {
    console.log("Unauthorized user:", ctx.from?.id);
    return;
  }

  if (ctx.message?.text?.startsWith("/allow_user")) {
    const repliedMessage = ctx.message?.reply_to_message;
    if (!repliedMessage?.from?.id) {
      await ctx.reply(
        "Please reply to a message from the user you want to allow."
      );
      return;
    }

    const userToAllow = repliedMessage.from.id;
    if (ALLOWED_IDS.includes(userToAllow)) {
      await ctx.reply("This user is already allowed.");
      return;
    }

    ALLOWED_IDS.push(userToAllow);
    saveAllowedUsers(ALLOWED_IDS);
    await ctx.reply(`User ${userToAllow} has been added to allowed users.`);
    return;
  }

  try {
    const messageText = ctx.message?.text;
    if (!messageText) {
      console.log("No message text:", ctx.message);
      return;
    }

    const isBotMentioned =
      messageText.startsWith("/chat") ||
      messageText.startsWith("/buscar") ||
      ctx.chat?.type === "private" ||
      ctx.message.reply_to_message?.from?.id === bot.botInfo.id;
    if (!isBotMentioned) {
      console.log("Bot not mentioned:", ctx.message?.text);
      return;
    }

    const query = messageText
      .trim()
      .replace(/^\/(chat|buscar)\s+/, "")
      .trim();
    if (!query) {
      await ctx.reply("Please provide a query with your mention!");
      return;
    }

    await ctx.replyWithChatAction("typing", {
      message_thread_id: ctx.message?.message_thread_id,
    });

    // Get conversation context if this is a reply
    let conversationContext: Message[] | undefined;
    const repliedToMessage = ctx.message?.reply_to_message?.message_id;
    if (repliedToMessage) {
      conversationContext = messageStore.getMessageChain(repliedToMessage);
    }

    const search =
      messageText.includes("/buscar") ||
      (conversationContext &&
        conversationContext.length > 0 &&
        conversationContext.findLast(
          (msg): msg is Message & { wasSearch: boolean } => !("isBot" in msg)
        )?.wasSearch) ||
      false;
    // const model = search
    //   ? openrouter.chat("google/gemini-2.0-flash-001", {
    //       extraBody: {
    //         plugins: [{ id: "web", max_results: 5 }],
    //       },
    //     })
    //   : openrouter.chat("google/gemini-2.0-flash-001");
    const model = google("gemini-2.0-flash", {
      useSearchGrounding: search,
    });

    const systemPrompt =
      "Sos ChatPT, un asistente argentino que puede responder preguntas boludas. Mantené las respuestas concisas y directas al punto. Responde siempre en castellano argento, pero no sobreexageres.";
    const messages: CoreMessage[] = [
      { role: "system" as const, content: systemPrompt },
      ...(conversationContext
        ? conversationContext.map((msg) =>
            msg.isBot
              ? {
                  role: "assistant" as const,
                  content: msg.chatMessage,
                }
              : {
                  role: "user" as const,
                  content: `${msg.chatMessage}`,
                }
          )
        : []),
      {
        role: "user" as const,
        content: `${query}`,
      },
    ];
    console.log(messages);

    const completion = await generateText({
      model,
      messages,
    });

    const responseText =
      escape(completion.text) || "Disculpa, no puedo generar una respuesta.";
    console.log({ responseText });

    messageStore.addMessage({
      id: ctx.message.message_id,
      inReplyToId: repliedToMessage || null,
      chatMessage: query,
      timestamp: Date.now(),
      username: ctx.from?.first_name || ctx.from?.username || "User",
      wasSearch: search,
      isBot: false,
    });

    let response;
    try {
      response = await ctx.reply(responseText, {
        reply_to_message_id: ctx.message.message_id,
        parse_mode: "MarkdownV2",
      });
    } catch (error: unknown) {
      if (error instanceof GrammyError && error.error_code === 400) {
        response = await ctx.reply(responseText, {
          reply_to_message_id: ctx.message.message_id,
        });
      } else throw error;
    }

    messageStore.addMessage({
      id: response.message_id,
      inReplyToId: ctx.message.message_id,
      chatMessage: responseText,
      timestamp: Date.now(),
      isBot: true,
    });
  } catch (error: unknown) {
    console.error("Error in message handler:", error);
    if (error instanceof GrammyError) {
      console.error("Error in request:", error.description);
    } else if (error instanceof HttpError) {
      console.error("Could not contact Telegram:", error);
    } else {
      console.error("Unknown error:", error);
    }

    try {
      await ctx.reply("Disculpa, me salió un error al procesar tu solicitud.");
    } catch (e) {
      console.error("Error sending error message:", e);
    }
  }
});

bot.catch((err: Error) => {
  console.error("Error in bot:", err);
});
console.log("Starting bot...");
bot.start();
