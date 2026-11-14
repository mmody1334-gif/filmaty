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
}

export class TelegramClient {
  private apiUrl: string;

  constructor(private token: string) {
    this.apiUrl = `https://api.telegram.org/bot${token}`;
  }

  async sendMessage(
    chatId: number,
    text: string,
    opts: SendMessageOptions = {},
  ): Promise<any> {
    return this.callApi("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: opts.parse_mode || "HTML",
      reply_markup: opts.reply_markup,
      disable_web_page_preview: opts.disable_web_page_preview ?? false,
    });
  }

  async editMessageText(
    chatId: number,
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

  async sendPhoto(
    chatId: number,
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

  async deleteMessage(chatId: number, messageId: number): Promise<any> {
    return this.callApi("deleteMessage", {
      chat_id: chatId,
      message_id: messageId,
    });
  }

  private async callApi(method: string, body: Record<string, any>): Promise<any> {
    const res = await fetch(`${this.apiUrl}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return data;
  }
}
