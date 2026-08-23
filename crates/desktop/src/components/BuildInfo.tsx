/** So it's never ambiguous which build is on screen — a dev-server
 * restart is the only way either value changes, so a stuck session reads
 * as stale immediately instead of another round of "are we looking at
 * the same thing". */
export function BuildInfo() {
  const time = new Date(__BUILD_TIME__).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <span className="status-build-info" title={`Built ${__BUILD_TIME__}`}>
      {__GIT_HASH__} · {time}
    </span>
  );
}
