export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
  web_app?: { url: string };
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface SendMessageOptions {
  parse_mode?: "HTML" | "MarkdownV2" | "Markdown";
  reply_markup?: InlineKeyboardMarkup;
  disable_web_page_preview?: boolean;
  reply_to_message_id?: number;
}

export class TelegramClient {
  private apiUrl: string;
  private token: string;

  constructor(token: string) {
    this.token = token;
    this.apiUrl = `https://api.telegram.org/bot${token}`;
  }

  async sendMessage(
    chatId: number | string,
    text: string,
    opts: SendMessageOptions = {},
  ): Promise<any> {
    return this.callApi("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: opts.parse_mode || "HTML",
      reply_markup: opts.reply_markup,
      disable_web_page_preview: opts.disable_web_page_preview ?? false,
      reply_to_message_id: opts.reply_to_message_id,
    });
  }

  async editMessageText(
    chatId: number | string,
    messageId: number,
    text: string,
    opts: SendMessageOptions = {},
  ): Promise<any> {
    return this.callApi("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: opts.parse_mode || "HTML",
      reply_markup: opts.reply_markup,
      disable_web_page_preview: opts.disable_web_page_preview ?? false,
    });
  }

  async editMessageCaption(
    chatId: number | string,
    messageId: number,
    caption: string,
    opts: SendMessageOptions = {},
  ): Promise<any> {
    return this.callApi("editMessageCaption", {
      chat_id: chatId,
      message_id: messageId,
      caption,
      parse_mode: opts.parse_mode || "HTML",
      reply_markup: opts.reply_markup,
    });
  }

  async editMessageMedia(
    chatId: number | string,
    messageId: number,
    media: { type: "photo" | "video"; media: string; caption?: string; parse_mode?: string },
    reply_markup?: InlineKeyboardMarkup,
  ): Promise<any> {
    return this.callApi("editMessageMedia", {
      chat_id: chatId,
      message_id: messageId,
      media: JSON.stringify(media),
      reply_markup,
    });
  }

  async sendPhoto(
    chatId: number | string,
    photoUrl: string,
    caption?: string,
    opts: SendMessageOptions = {},
  ): Promise<any> {
    return this.callApi("sendPhoto", {
      chat_id: chatId,
      photo: photoUrl,
      caption,
      parse_mode: opts.parse_mode || "HTML",
      reply_markup: opts.reply_markup,
      reply_to_message_id: opts.reply_to_message_id,
    });
  }

  async sendVideo(
    chatId: number | string,
    videoUrl: string,
    caption?: string,
    opts: SendMessageOptions = {},
  ): Promise<any> {
    return this.callApi("sendVideo", {
      chat_id: chatId,
      video: videoUrl,
      caption,
      parse_mode: opts.parse_mode || "HTML",
      reply_markup: opts.reply_markup,
      supports_streaming: true,
      reply_to_message_id: opts.reply_to_message_id,
    });
  }

  async sendAudio(
    chatId: number | string,
    audioUrl: string,
    caption?: string,
    title?: string,
    performer?: string,
    opts: SendMessageOptions = {},
  ): Promise<any> {
    return this.callApi("sendAudio", {
      chat_id: chatId,
      audio: audioUrl,
      caption,
      title,
      performer,
      parse_mode: opts.parse_mode || "HTML",
      reply_markup: opts.reply_markup,
      reply_to_message_id: opts.reply_to_message_id,
    });
  }

  async answerCallbackQuery(
    callbackQueryId: string,
    text?: string,
    showAlert = false,
  ): Promise<any> {
    return this.callApi("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text,
      show_alert: showAlert,
    });
  }

  async deleteMessage(chatId: number | string, messageId: number): Promise<any> {
    return this.callApi("deleteMessage", {
      chat_id: chatId,
      message_id: messageId,
    });
  }

  /**
   * Robustly edits text or caption depending on whether original message had media.
   * If messageId is missing or edit fails, falls back cleanly to sending a new message.
   */
  async safeEdit(
    chatId: number | string,
    messageId: number | undefined,
    text: string,
    opts: SendMessageOptions = {},
  ): Promise<any> {
    if (!messageId) {
      return await this.sendMessage(chatId, text, opts);
    }
    try {
      const res = await this.editMessageText(chatId, messageId, text, opts);
      if (res && (res.ok || res.message_id)) return res;
      if (res && res.description && res.description.toLowerCase().includes("there is no text in the message")) {
        const captionRes = await this.editMessageCaption(chatId, messageId, text.slice(0, 1024), opts);
        if (captionRes && (captionRes.ok || captionRes.message_id)) return captionRes;
        await this.deleteMessage(chatId, messageId).catch(() => undefined);
        return await this.sendMessage(chatId, text, opts);
      }
      if (!res?.ok && !res?.message_id) {
        return await this.sendMessage(chatId, text, opts);
      }
      return res;
    } catch {
      return await this.sendMessage(chatId, text, opts);
    }
  }

  private async callApi(method: string, body: Record<string, any>): Promise<any> {
    try {
      const res = await fetch(`${this.apiUrl}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      const data: any = await res.json();
      if (data && data.result && typeof data.result === "object") {
        return Object.assign(data.result, data);
      }
      return data;
    } catch (err: any) {
      console.error(`Telegram API error (${method}):`, err.message);
      return { ok: false, description: err.message };
    }
  }
}
