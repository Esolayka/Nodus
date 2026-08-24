import * as api from "../api/vault";
import i18next from "../i18n";
import { attachBytes } from "./attachments";
import { appendToDailyNote, dailyNotePath } from "./dailyNotes";

// The bot's one job per the spec: any message sent to it — text, a
// forwarded message, a link (with its page title), a photo, a voice
// note, or a file — lands in today's daily note. It must work without
// opening the app, which is why this runs as a plain long-poll against
// Telegram's Bot API directly from the renderer (CSP is unrestricted —
// tauri.conf.json's csp is null) rather than needing a native backend
// process: the desktop app already has to be running for local-mode
// Telegram to work at all, per the spec's own degradation story.
//
// `/start` is the one message that's *not* content to save — it gets a
// welcome reply with a button that opens the Mini App (a `web_app`
// inline-keyboard button needs no BotFather-side setup to work, unlike a
// persistent menu button), or an explanation if there's no reachable
// address yet.

interface TgUser {
  id: number;
  username?: string;
  first_name?: string;
}

interface TgChat {
  id: number;
  title?: string;
}

interface TgPhotoSize {
  file_id: string;
  width: number;
  height: number;
}

interface TgMessageEntity {
  type: string;
  offset: number;
  length: number;
  url?: string;
}

interface TgForwardOrigin {
  type: string;
  sender_user?: TgUser;
  sender_user_name?: string;
  chat?: TgChat;
}

interface TgMessage {
  message_id: number;
  chat: TgChat;
  text?: string;
  caption?: string;
  entities?: TgMessageEntity[];
  caption_entities?: TgMessageEntity[];
  voice?: { file_id: string };
  photo?: TgPhotoSize[];
  document?: { file_id: string; file_name?: string };
  // `forward_origin` is the current Bot API shape; `forward_from`/
  // `forward_from_chat` are what older clients (and some libraries still
  // in the wild) send — both are handled since either could arrive.
  forward_origin?: TgForwardOrigin;
  forward_from?: TgUser;
  forward_from_chat?: TgChat;
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

function apiBase(token: string): string {
  return `https://api.telegram.org/bot${token}`;
}

function withTimeout(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

async function callTelegramApi<T>(token: string, method: string, params?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${apiBase(token)}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: params ? JSON.stringify(params) : undefined,
    signal: withTimeout(15_000),
  });
  const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!data.ok) throw new Error(data.description ?? `Telegram API call to ${method} failed`);
  return data.result as T;
}

/** For the Settings screen: a `t.me` deep link that opens a chat with this
 * bot and sends `/start <code>` automatically — the bot's own `/start`
 * handling (below) then turns that into a one-tap "finish linking"
 * button, so nothing has to be typed on the phone at all. `null` if the
 * token doesn't resolve to a real bot (not configured yet, or wrong). */
export async function fetchTelegramStartLink(token: string, code: string): Promise<string | null> {
  try {
    const me = await callTelegramApi<{ username?: string }>(token, "getMe");
    return me.username ? `https://t.me/${me.username}?start=${code}` : null;
  } catch {
    return null;
  }
}

async function getUpdates(token: string, offset: number | undefined, signal: AbortSignal): Promise<TgUpdate[]> {
  const res = await fetch(`${apiBase(token)}/getUpdates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offset, timeout: 25, allowed_updates: ["message"] }),
    signal,
  });
  const data = (await res.json()) as { ok: boolean; result?: TgUpdate[]; description?: string };
  if (!data.ok) throw new Error(data.description ?? "getUpdates failed");
  return data.result ?? [];
}

async function downloadTelegramFile(token: string, fileId: string): Promise<{ bytes: Uint8Array; fileName: string }> {
  const info = await callTelegramApi<{ file_path: string }>(token, "getFile", { file_id: fileId });
  const url = `https://api.telegram.org/file/bot${token}/${info.file_path}`;
  const res = await fetch(url, { signal: withTimeout(60_000) });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const fileName = info.file_path.split("/").pop() || `${fileId}.bin`;
  return { bytes, fileName };
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'");
}

/** Best-effort — a link whose page can't be fetched (timeout, non-HTML
 * response, no <title>) is just kept as a plain URL. */
async function fetchLinkTitle(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: withTimeout(6_000) });
    const html = await res.text();
    const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
    const title = match?.[1] ? decodeHtmlEntities(match[1]).trim() : "";
    return title || null;
  } catch {
    return null;
  }
}

function extractLinks(text: string, entities: TgMessageEntity[] | undefined): string[] {
  if (!entities) return [];
  const links: string[] = [];
  for (const entity of entities) {
    if (entity.type === "url") links.push(text.slice(entity.offset, entity.offset + entity.length));
    else if (entity.type === "text_link" && entity.url) links.push(entity.url);
  }
  return links;
}

function forwardHeader(msg: TgMessage): string | null {
  const origin = msg.forward_origin;
  if (origin?.sender_user) {
    return i18next.t("telegramBot.forwardedFromUser", {
      name: origin.sender_user.first_name ?? origin.sender_user.username ?? origin.sender_user.id,
    });
  }
  if (origin?.chat) {
    return i18next.t("telegramBot.forwardedFromChat", { name: origin.chat.title ?? origin.chat.id });
  }
  if (origin?.sender_user_name) {
    return i18next.t("telegramBot.forwardedFromUser", { name: origin.sender_user_name });
  }
  if (msg.forward_from) {
    return i18next.t("telegramBot.forwardedFromUser", {
      name: msg.forward_from.first_name ?? msg.forward_from.username ?? msg.forward_from.id,
    });
  }
  if (msg.forward_from_chat) {
    return i18next.t("telegramBot.forwardedFromChat", { name: msg.forward_from_chat.title ?? msg.forward_from_chat.id });
  }
  return null;
}

async function attachToDailyNote(token: string, fileId: string, fallbackName: string): Promise<string> {
  const { bytes, fileName } = await downloadTelegramFile(token, fileId);
  const name = fileName.includes(".") ? fileName : fallbackName;
  return attachBytes(dailyNotePath(new Date()), name, bytes);
}

/** Turns one incoming message into the Markdown that gets appended to
 * today's daily note — text (with any links resolved to their page
 * title), a forwarded-message header, and/or a downloaded attachment
 * embed for voice/photo/file messages. */
async function renderMessage(token: string, msg: TgMessage): Promise<string> {
  const lines: string[] = [];

  const fwd = forwardHeader(msg);
  if (fwd) lines.push(`> ${fwd}`);

  const text = msg.text ?? msg.caption;
  if (text) {
    const links = extractLinks(text, msg.entities ?? msg.caption_entities);
    let body = text;
    for (const link of links) {
      const title = await fetchLinkTitle(link);
      if (title) body = body.split(link).join(`[${title}](${link})`);
    }
    lines.push(body);
  }

  if (msg.voice) lines.push(await attachToDailyNote(token, msg.voice.file_id, "voice-message.oga"));
  if (msg.photo && msg.photo.length > 0) {
    const largest = msg.photo[msg.photo.length - 1];
    lines.push(await attachToDailyNote(token, largest.file_id, "photo.jpg"));
  }
  if (msg.document) {
    lines.push(await attachToDailyNote(token, msg.document.file_id, msg.document.file_name ?? "file"));
  }

  return lines.length > 0 ? lines.join("\n") : i18next.t("telegramBot.emptyMessage");
}

const OFFSET_STORAGE_PREFIX = "nodus:telegram-bot-offset:";
const OFFSET_STORAGE_V2_PREFIX = `${OFFSET_STORAGE_PREFIX}v2:`;

function tokenFingerprint(token: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < token.length; index += 1) {
    const code = token.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function offsetStorageKey(token: string): string {
  return `${OFFSET_STORAGE_V2_PREFIX}${tokenFingerprint(token)}`;
}

function removeLegacyOffsetKeys(): void {
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(OFFSET_STORAGE_PREFIX) && !key.startsWith(OFFSET_STORAGE_V2_PREFIX)) {
      localStorage.removeItem(key);
    }
  }
}

function loadOffset(token: string): number | undefined {
  removeLegacyOffsetKeys();
  const raw = localStorage.getItem(offsetStorageKey(token));
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function saveOffset(token: string, offset: number): void {
  localStorage.setItem(offsetStorageKey(token), String(offset));
}

let activeToken: string | null = null;
let stopRequested = false;
let pollAbort: AbortController | null = null;

/** Starts (or is a no-op if already running for this exact token) the
 * long-poll loop. Runs until `stopTelegramBotPolling` is called — meant to
 * track "Telegram enabled, local placement, a bot token set, a vault
 * open" for as long as all of those hold. */
export function startTelegramBotPolling(token: string): void {
  if (activeToken === token) return;
  stopTelegramBotPolling();
  activeToken = token;
  stopRequested = false;
  void runPollingLoop(token);
}

export function stopTelegramBotPolling(): void {
  stopRequested = true;
  pollAbort?.abort();
  pollAbort = null;
  activeToken = null;
}

const START_COMMAND_RE = /^\/start(?:@\S+)?(?:\s+(\S+))?\s*$/;

/** The linking code's own alphabet (see `generate_linking_token` in
 * telegram_link/mod.rs) — used to tell "/start <code>" apart from some
 * other deep-link payload a future feature might send. */
const LINK_CODE_RE = /^[A-Z0-9]{8}$/;

/** Telegram sends "/start" as typed, but a deep link (`t.me/bot?start=X`)
 * arrives as "/start X" and a group chat sends "/start@YourBotName" —
 * `payload` is the linking code when present and shaped like one. */
function parseStartCommand(text: string | undefined): { isStart: boolean; payload?: string } {
  if (!text) return { isStart: false };
  const match = START_COMMAND_RE.exec(text.trim());
  if (!match) return { isStart: false };
  const raw = match[1]?.toUpperCase();
  return { isStart: true, payload: raw && LINK_CODE_RE.test(raw) ? raw : undefined };
}

async function handleStartCommand(token: string, chatId: number, linkCode: string | undefined): Promise<void> {
  const status = await api.telegramStatus().catch(() => null);
  const address = status?.publicAddress;

  if (!address) {
    await callTelegramApi(token, "sendMessage", {
      chat_id: chatId,
      text: i18next.t("telegramBot.startNoAddress"),
    }).catch(() => {});
    return;
  }

  const base = address.replace(/\/+$/, "");
  const miniAppUrl = linkCode ? `${base}/miniapp.html?code=${linkCode}` : `${base}/miniapp.html`;
  await callTelegramApi(token, "sendMessage", {
    chat_id: chatId,
    text: linkCode ? i18next.t("telegramBot.startLinking") : i18next.t("telegramBot.startWelcome"),
    reply_markup: {
      inline_keyboard: [[{ text: i18next.t("telegramBot.openMiniApp"), web_app: { url: miniAppUrl } }]],
    },
  }).catch(() => {});
}

async function runPollingLoop(token: string): Promise<void> {
  let offset = loadOffset(token);

  while (!stopRequested && activeToken === token) {
    pollAbort = new AbortController();
    let updates: TgUpdate[];
    try {
      updates = await getUpdates(token, offset, pollAbort.signal);
    } catch (error) {
      if (stopRequested || activeToken !== token) return;
      console.error("[telegram-bot] getUpdates failed:", error);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      continue;
    }

    for (const update of updates) {
      offset = update.update_id + 1;
      saveOffset(token, offset);
      const msg = update.message;
      if (!msg) continue;

      const start = parseStartCommand(msg.text);
      if (start.isStart) {
        await handleStartCommand(token, msg.chat.id, start.payload);
        continue;
      }

      try {
        const content = await renderMessage(token, msg);
        await appendToDailyNote(content);
        await callTelegramApi(token, "sendMessage", {
          chat_id: msg.chat.id,
          text: i18next.t("telegramBot.savedConfirmation"),
          reply_to_message_id: msg.message_id,
        }).catch(() => {});
      } catch (error) {
        console.error("[telegram-bot] failed to process message:", error);
        await callTelegramApi(token, "sendMessage", {
          chat_id: msg.chat.id,
          text: i18next.t("telegramBot.saveFailed"),
          reply_to_message_id: msg.message_id,
        }).catch(() => {});
      }
    }
  }
}
