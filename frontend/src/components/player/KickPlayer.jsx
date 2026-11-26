import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { useT } from "@/i18n";

// Kick's official embed: an iframe of player.kick.com/<channel> with URL parameters and no JavaScript control
// (https://help.kick.com/en/articles/8010826-how-to-embed-your-kick-livestream). The room plays a live channel here
// when its stream cannot play in Nexora's own player (resolver.py). The room still runs it: the player below is a
// live player for usePlaybackSync. A pause takes the stream away on every phone, play brings everyone back to the
// live edge. It starts stopped, like every player, and the room's state turns it on (onReady / the sync loop).
// Nothing is drawn over the playing stream (no guest lock): Kick's own sound and fullscreen buttons stay usable.
export const KickPlayer = ({ video, isHost, playerRef, events, onState }) => {
  const t = useT();
  const [on, setOn] = useState(false);
  const onRef = useRef(on);
  onRef.current = on;
  const evRef = useRef(events);
  evRef.current = events;
  const stateRef = useRef(onState);
  stateRef.current = onState;
  const said = useRef(null); // the last state told to the room (the first one is the room's own)

  useEffect(() => {
    if (!playerRef) return undefined;
    playerRef.current = {
      ready: true, supportsRate: false, kind: "kick",
      isLive: () => true, // everyone rides the live edge: only play / pause belong to the room
      getTime: () => 0,
      getDuration: () => Infinity,
      isPaused: () => !onRef.current,
      isBuffering: () => false,
      play: () => { setOn(true); return Promise.resolve(); },
      pause: () => setOn(false),
      seek: () => {},
      setRate: () => {},
      setMuted: () => {},
    };
    evRef.current?.onReady?.();
    return () => { playerRef.current = null; };
  }, [playerRef]);

  useEffect(() => {
    stateRef.current?.(on);
    if (said.current === null) { said.current = on; return; }
    if (said.current === on) return;
    said.current = on;
    if (on) evRef.current?.onPlay?.();
    else evRef.current?.onPause?.();
  }, [on]);

  if (!on) {
    return (
      <div className="kick-off" data-testid="kick-stopped">
        {isHost ? (
          <button className="go" onClick={() => setOn(true)} data-testid="kick-start-btn"><Play size={16} /> {t("kick_start")}</button>
        ) : (
          <span>{t("kick_wait")}</span>
        )}
      </div>
    );
  }
  return (
    <iframe
      title="Kick"
      src={`https://player.kick.com/${encodeURIComponent(video.channel)}?autoplay=true`}
      allow="autoplay; fullscreen"
      allowFullScreen
      scrolling="no"
      data-testid="kick-player"
    />
  );
};
