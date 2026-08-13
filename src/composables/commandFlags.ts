// >>> static reference of -flag args per built-in command (mirrors backend lib/core/chatFlags.ts), for CommandEditPanel's Flags field - flags are hardcoded per command file, keep this in sync by hand
export interface FlagItem {
  flag: string;
  desc: string;
}

const NUKE_FLAGS: FlagItem[] = [
  { flag: "-r=<mins>", desc: "radiation - keep actioning new matches for this long" },
  { flag: "-c=<n>", desc: "cap - action at most n users/messages per firing" },
  { flag: "-l", desc: "log - post the created & fired confirmation to chat" },
];
const COMMAND_CMD_FLAGS: FlagItem[] = [
  { flag: "-gc=<secs>", desc: "global cooldown" },
  { flag: "-uc=<secs>", desc: "per-user cooldown" },
  { flag: "-m", desc: "mod-only" },
  { flag: "-b", desc: "broadcaster-only" },
  { flag: "-a=<alias>", desc: "alias to another custom command" },
];
const TIMER_FLAGS: FlagItem[] = [
  { flag: "-c=<n>", desc: "minimum chat messages between posts" },
];
const BAN_FLAGS: FlagItem[] = [
  { flag: "-l", desc: "log - post the ban confirmation to chat" },
];
const TIMEOUT_TO_FLAGS: FlagItem[] = [
  { flag: "-l", desc: "log - post the timeout confirmation to chat" },
];
const DELETE_FLAGS: FlagItem[] = [
  { flag: "-l", desc: "log - post the delete confirmation to chat" },
];

// >>> cmd/to are aliases of command/timeout and share their flags
export const COMMAND_FLAGS: Record<string, FlagItem[]> = {
  nuke: NUKE_FLAGS,
  command: COMMAND_CMD_FLAGS,
  cmd: COMMAND_CMD_FLAGS,
  timer: TIMER_FLAGS,
  ban: BAN_FLAGS,
  timeout: TIMEOUT_TO_FLAGS,
  to: TIMEOUT_TO_FLAGS,
  delete: DELETE_FLAGS,
};
