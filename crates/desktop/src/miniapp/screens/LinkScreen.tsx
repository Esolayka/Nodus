import { useState } from "react";
import { useLinkStore } from "../store/linkStore";
import { getInitData, isInsideTelegram } from "../telegram";

interface LinkResponse {
  telegramUserId: number;
  telegramUsername: string | null;
  syncIdentityHex: string;
  sessionToken: string;
}

export function LinkScreen() {
  const setLink = useLinkStore((s) => s.setLink);
  const [baseUrl, setBaseUrl] = useState("");
  const [code, setCode] = useState("");
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    const initData = getInitData();
    if (!initData) {
      setError("Open this from the Telegram app to link — the linking check needs Telegram's own signature.");
      return;
    }
    setLinking(true);
    setError(null);
    try {
      const resp = await fetch(`${baseUrl.trim().replace(/\/$/, "")}/telegram/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: code.trim(), initData }),
      });
      if (!resp.ok) {
        const message = await resp.text().catch(() => resp.statusText);
        throw new Error(message || "Could not link this device.");
      }
      const body = (await resp.json()) as LinkResponse;
      setLink(baseUrl.trim().replace(/\/$/, ""), body.sessionToken, body.telegramUserId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLinking(false);
    }
  }

  return (
    <div className="link-screen">
      <h1>Connect to Nodus</h1>
      <p className="link-screen-hint">
        On your computer, open Settings → Telegram and generate a linking code, then enter both here.
      </p>
      {!isInsideTelegram() && (
        <p className="link-screen-warning">
          This page isn't running inside Telegram, so linking can't be verified here — open it from the Mini App
          link Telegram gave you.
        </p>
      )}
      <label className="link-field">
        <span>Computer's address</span>
        <input
          className="field"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://your-tunnel.example.com"
          autoCapitalize="off"
          autoCorrect="off"
        />
      </label>
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
        disabled={linking || !baseUrl.trim() || !code.trim()}
        onClick={() => void handleConnect()}
      >
        {linking ? "Connecting…" : "Connect"}
      </button>
    </div>
  );
}
