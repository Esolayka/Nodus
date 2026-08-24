import { registerMediaElement, unregisterMediaElement } from "./singlePlaybackRegistry";
import i18next from "../i18n";

const PLAY_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 2.5v11l10-5.5z"/></svg>';
const PAUSE_ICON =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="3.5" y="2.5" width="3" height="11"/><rect x="9.5" y="2.5" width="3" height="11"/></svg>';
const FULLSCREEN_ICON =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/></svg>';

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export interface MediaPlayer {
  element: HTMLElement;
  mediaEl: HTMLMediaElement;
  destroy: () => void;
}

/** Builds a themed audio/video player — native `<audio>`/`<video>` for
 * actual playback, but with our own play/pause button, seek bar, and time
 * display rather than the browser's un-themeable native controls. */
export function buildMediaPlayer(kind: "audio" | "video", src: string, startTime: number | null): MediaPlayer {
  const container = document.createElement("div");
  container.className = `nodus-media-player nodus-media-${kind}`;

  const mediaEl = document.createElement(kind) as HTMLMediaElement;
  mediaEl.src = src;
  mediaEl.preload = "metadata";
  mediaEl.className = "nodus-media-element";
  container.appendChild(mediaEl);

  if (startTime != null) {
    mediaEl.addEventListener(
      "loadedmetadata",
      () => {
        mediaEl.currentTime = startTime;
      },
      { once: true },
    );
  }

  registerMediaElement(mediaEl);

  const controls = document.createElement("div");
  controls.className = "nodus-media-controls";

  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "nodus-media-play-btn";
  playBtn.setAttribute("aria-label", i18next.t("media.play"));
  playBtn.title = i18next.t("media.play");
  playBtn.innerHTML = PLAY_ICON;
  playBtn.addEventListener("click", () => {
    if (mediaEl.paused) void mediaEl.play();
    else mediaEl.pause();
  });
  mediaEl.addEventListener("play", () => {
    playBtn.innerHTML = PAUSE_ICON;
    playBtn.setAttribute("aria-label", i18next.t("media.pause"));
    playBtn.title = i18next.t("media.pause");
  });
  mediaEl.addEventListener("pause", () => {
    playBtn.innerHTML = PLAY_ICON;
    playBtn.setAttribute("aria-label", i18next.t("media.play"));
    playBtn.title = i18next.t("media.play");
  });
  controls.appendChild(playBtn);

  const seek = document.createElement("input");
  seek.type = "range";
  seek.min = "0";
  seek.max = "1000";
  seek.value = "0";
  seek.className = "nodus-media-seek";
  let seeking = false;
  seek.addEventListener("input", () => {
    seeking = true;
    if (mediaEl.duration) mediaEl.currentTime = (Number(seek.value) / 1000) * mediaEl.duration;
  });
  seek.addEventListener("change", () => {
    seeking = false;
  });
  controls.appendChild(seek);

  const timeLabel = document.createElement("span");
  timeLabel.className = "nodus-media-time";
  timeLabel.textContent = "0:00 / 0:00";
  controls.appendChild(timeLabel);

  const onTimeUpdate = () => {
    if (!seeking && mediaEl.duration) seek.value = String((mediaEl.currentTime / mediaEl.duration) * 1000);
    timeLabel.textContent = `${formatTime(mediaEl.currentTime)} / ${formatTime(mediaEl.duration || 0)}`;
  };
  mediaEl.addEventListener("timeupdate", onTimeUpdate);
  mediaEl.addEventListener("loadedmetadata", onTimeUpdate);

  if (kind === "video") {
    const fsBtn = document.createElement("button");
    fsBtn.type = "button";
    fsBtn.className = "nodus-media-fullscreen-btn";
    fsBtn.setAttribute("aria-label", i18next.t("media.fullscreen"));
    fsBtn.title = i18next.t("media.fullscreen");
    fsBtn.innerHTML = FULLSCREEN_ICON;
    fsBtn.addEventListener("click", () => void mediaEl.requestFullscreen());
    controls.appendChild(fsBtn);
  }

  container.appendChild(controls);

  return {
    element: container,
    mediaEl,
    destroy: () => {
      mediaEl.pause();
      unregisterMediaElement(mediaEl);
    },
  };
}
