import { Bot, Context, GrammyError, HttpError } from "grammy";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";

const requiredEnvVars = ["BOT_TOKEN", "OPENROUTER_API_KEY"];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`${envVar} is not set in environment variables`);
  }
}
const ALLOWED_IDS = process.env.ALLOWED_IDS?.split(",").map(Number) || [];

const bot = new Bot(process.env.BOT_TOKEN!);
const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

bot.on("message", async (ctx: Context) => {
  if (!ALLOWED_IDS.includes(ctx.from?.id!)) {
    console.log("Unauthorized user:", ctx.from?.id);
    return;
  }

  try {
    const messageText = ctx.message?.text;
    if (!messageText) {
      console.log("No message text:", ctx.message);
      return;
    }

    const isBotMentioned =
      messageText.startsWith("/chat") || ctx.chat?.type === "private";
    if (!isBotMentioned) {
      console.log("Bot not mentioned:", ctx.message?.text);
      return;
    }

    const query = messageText.trim();
    if (!query) {
      await ctx.reply("Please provide a query with your mention!");
      return;
    }

    await ctx.replyWithChatAction("typing", {
      message_thread_id: ctx.message?.message_thread_id,
    });

    const model = messageText.startsWith("/chatg")
      ? openrouter.chat("google/gemini-2.0-flash-001", {
          extraBody: {
            plugins: [{ id: "web", max_results: 2 }],
          },
        })
      : openrouter.chat("meta-llama/llama-3.3-70b-instruct:nitro");

    const completion = await generateText({
      model,
      system:
        "Eres ChatPT, un asistente útil que puede responder preguntas y ayudar con tareas. Mantén las respuestas concisas y directas al punto. Responde siempre en español.",
      messages: [{ role: "user", content: query }],
    });

    const response =
      completion.text || "Sorry, I couldn't generate a response.";

    try {
      await ctx.reply(response, {
        reply_to_message_id: ctx.message.message_id,
        parse_mode: "MarkdownV2",
      });
    } catch (error: unknown) {
      if (error instanceof GrammyError && error.error_code === 400) {
        await ctx.reply(response, {
          reply_to_message_id: ctx.message.message_id,
        });
      } else throw error;
    }
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
      await ctx.reply(
        "Sorry, I encountered an error while processing your request."
      );
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
