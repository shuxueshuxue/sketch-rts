import type { AiScriptVersion } from "../../ai/policy";
import type { ClientNetMessage, ServerNetMessage } from "../../shared/net/types";
import type { GameCommand, GameMap, GameSetupOptions, GameSnapshot, MapId, PlayerId, RoomState } from "../../shared/types";

// @@@match-thread - A browser match runs on a Web Worker; the page only draws its snapshots and sends its commands.
// The page drives the match clock (it says what time it is each frame), so a hidden tab still pauses the match and a
// long tick on the match thread never holds a frame. The ticks a frame makes due run at the match thread's own pace,
// not one frame budget at a time. The worker builds the same game from the same setup.

export type MatchThreadInit =
  | {
      type: "local";
      room?: RoomState;
      playerId: PlayerId;
      mapId: MapId;
      options: GameSetupOptions;
      aiPlayers: PlayerId[];
      aiVersions?: Partial<Record<PlayerId, AiScriptVersion>>;
      tickMs?: number;
      now: number;
      // The port of the match's AI thread (see @@@think-thread); the AI thinks on the match thread without it.
      aiPort?: MessagePort;
    }
  | { type: "lockstep"; roomId: string; playerId: PlayerId; mapId: MapId; options: GameSetupOptions };

export type MatchThreadMessage =
  | MatchThreadInit
  | { type: "advance"; now: number }
  | { type: "command"; command: GameCommand }
  // Lockstep: what the room's server sent, and the transport opening.
  | { type: "net"; message: ServerNetMessage }
  | { type: "join" }
  | { type: "close" };

type CastCommand = Extract<GameCommand, { type: "cast" }>;

// A snapshot without the map's fixed ground (terrain, scenery). The page keeps its own copy, built from the same setup:
// its drawing caches are keyed by that object, so a fresh copy every tick would repaint the whole ground every frame.
export type MatchThreadSnapshot = Omit<GameSnapshot, "map"> & { map: Omit<GameMap, "terrain" | "landmarks"> };

export type MatchThreadEvent =
  | { type: "snapshot"; snapshot: MatchThreadSnapshot; pendingCasts?: CastCommand[] }
  | { type: "ended"; snapshot: MatchThreadSnapshot }
  // A command the live game refused although the page's latest snapshot allowed it.
  | { type: "rejected"; message: string }
  | { type: "error"; message: string }
  // Lockstep: what the match sends to the room's server.
  | { type: "net"; message: ClientNetMessage };
