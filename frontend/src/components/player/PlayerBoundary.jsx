import React from "react";
import { TriangleAlert } from "lucide-react";
import { reportError } from "@/lib/errors";

// A player that crashes while drawing (a provider changed its API, an unexpected answer) must not take the room with
// it: chat, people and the video panel stay usable, and the picture area offers a retry. A new video (resetKey)
// starts clean; the player is not remounted for it, so fullscreen and the rest of the stage survive a video change.
// Texts come in as props: hooks are not available in a class component.
export class PlayerBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false, attempt: 0 };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(prev) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }));
  }

  componentDidCatch(error, info) {
    const stack = `${(error && error.stack) || ""}\n--- component stack ---${(info && info.componentStack) || ""}`;
    reportError({ message: (error && error.message) || String(error), stack }, "player");
  }

  render() {
    const { failed, attempt } = this.state;
    const { title, retry, children } = this.props;
    if (!failed) return <React.Fragment key={attempt}>{children}</React.Fragment>;
    return (
      <div className="stage" data-testid="video-stage">
        <div className="fatal" data-testid="player-crash">
          <TriangleAlert size={28} />
          <b>{title}</b>
          <button className="btn" onClick={() => this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }))} data-testid="player-crash-retry">{retry}</button>
        </div>
      </div>
    );
  }
}
