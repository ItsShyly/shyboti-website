// >>> shared between TwitchView.vue and ChannelPointActionsEditor.vue
export type ActionType =
  | "run_command"
  | "create_command"
  | "timeout_self"
  | "timeout_input_user";

export interface RewardAction {
  type: ActionType;
  command: string;
  args: string;
  name: string;
  response: string;
  seconds: number;
}

export function blankAction(): RewardAction {
  return {
    type: "run_command",
    command: "",
    args: "",
    name: "{user}",
    response: "{input}",
    seconds: 600,
  };
}

// >>> these action types read the viewer's typed input - useless without it
export function actionNeedsInput(a: RewardAction): boolean {
  if (a.type === "timeout_input_user") return true;
  if (a.type === "run_command") return a.args.includes("{input}");
  if (a.type === "create_command") return a.response.includes("{input}");
  return false;
}

// >>> "+shoutout @user" style preview - {user}/{input}/{display} shown as example values
export function previewCommand(a: RewardAction, channelPrefix: string): string {
  if (!a.command.trim()) return "";
  const args = a.args
    .split("{input}")
    .join("hello there")
    .split("{user}")
    .join("@user")
    .split("{display}")
    .join("DisplayName");
  return `${channelPrefix}${a.command.trim().replace(/^\+/, "")}${args ? " " + args : ""}`;
}
