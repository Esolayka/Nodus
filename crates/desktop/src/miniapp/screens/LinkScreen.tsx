import { useEffect, useState } from "react";
import { useLinkStore } from "../store/linkStore";
import { getInitData, isInsideTelegram } from "../telegram";

interface LinkResponse {
  telegramUserId: number;
  telegramUsername: string | null;
  syncIdentityHex: string;
  sessionToken: string;
}

/** The tunnel address is whatever this page was itself loaded from — the
 * phone already navigated here through it, so there's nothing for the
 * user to separately type in. Only relevant while genuinely running
 * inside Telegram's WebView (a plain browser tab has no better guess). */
function currentOrigin(): string {
  return window.location.origin;
}

/** A code embedded in the URL — set when the bot's "Open Nodus" button was
 * built from a `/start <code>` deep link (see telegramBot.ts's
 * handleStartCommand) — lets linking complete with nothing to type. */
function codeFromUrl(): string {
  return new URLSearchParams(window.location.search).get("code")?.toUpperCase() ?? "";
}

export function LinkScreen() {
  const setLink = useLinkStore((s) => s.setLink);
  const [code, setCode] = useState(codeFromUrl);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect(codeToUse: string) {
    const initData = getInitData();
    if (!initData) {
      setError("Open this from the Telegram app to link — the linking check needs Telegram's own signature.");
      return;
    }
    setLinking(true);
    setError(null);
    try {
      const baseUrl = currentOrigin();
      const resp = await fetch(`${baseUrl}/telegram/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: codeToUse.trim(), initData }),
      });
      if (!resp.ok) {
        const message = await resp.text().catch(() => resp.statusText);
        throw new Error(message || "Could not link this device.");
      }
      const body = (await resp.json()) as LinkResponse;
      setLink(baseUrl, body.sessionToken, body.telegramUserId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLinking(false);
    }
  }

  // A code arriving via the URL means the user tapped a link built
  // specifically to finish linking — no reason to make them press Connect
  // too, once Telegram's own signature is actually available.
  useEffect(() => {
    const fromUrl = codeFromUrl();
    if (fromUrl && getInitData()) void handleConnect(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="link-screen">
      <h1>Connect to Nodus</h1>
      <p className="link-screen-hint">
        On your computer, open Settings → Telegram, generate a linking code, and enter it below.
      </p>
      {!isInsideTelegram() && (
        <p className="link-screen-warning">
          This page isn't running inside Telegram, so linking can't be verified here — open it from the Mini App
          link Telegram gave you.
        </p>
      )}
      <label className="link-field">
        <span>Linking code</span>
        <input
          className="field"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ABCD1234"
          autoCapitalize="off"
          autoCorrect="off"
        />
      </label>
      {error && <p className="link-screen-error">{error}</p>}
      <button
        type="button"
        className="link-connect-btn"
        disabled={linking || !code.trim()}
        onClick={() => void handleConnect(code)}
      >
        {linking ? "Connecting…" : "Connect"}
      </button>
    </div>
  );
}
