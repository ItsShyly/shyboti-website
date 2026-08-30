<script setup lang="ts">
import {
  ref,
  computed,
  onMounted,
  onUnmounted,
  watch,
  nextTick,
  inject,
  type Ref,
} from "vue";
import { API } from "../api";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { iconSvg as iconSvgFor } from "../composables/icons";
import CommandEditPanel from "./CommandEditPanel.vue";
import ObsCommandEditPanel from "./ObsCommandEditPanel.vue";
import type { ObsSceneBind, ObsSourceBind, ObsArgEntry } from "./ObsCommandEditPanel.vue";
import RowKebabMenu, { type KebabMenuItem } from "./shared/RowKebabMenu.vue";

const { session, channelRole, adminMode } = useAuth();
const { t } = useI18n();

// >>> a site admin browsing in admin mode bypasses whatever role they'd
// >>> otherwise resolve to in this channel (e.g. an unrelated VIP grant there)
const isAdminBypass = computed(() => !!(session.value?.isAdmin && adminMode.value));
const canView = computed(
  () => (channelRole.value?.permissions.commands_view ?? false) || isAdminBypass.value,
);
// >>> avoids a false needs-bot flash before load
const botPresent = computed(() => channelRole.value?.botPresent ?? true);
const canToggle = computed(
  () =>
    ((channelRole.value?.permissions.commands_toggle ?? false) || isAdminBypass.value) &&
    botPresent.value,
);
const canEdit = computed(
  () =>
    (channelRole.value?.permissions.commands_edit ?? false) &&
    botPresent.value,
);
const canDelete = computed(
  () =>
    (channelRole.value?.permissions.commands_delete ?? false) &&
    botPresent.value,
);
const canViewObs = computed(
  () => channelRole.value?.permissions?.obs_view ?? false,
);

interface Command {
  name: string;
  isActive: boolean;
  cooldown: number;
  userCooldown: number;
  modOnly: boolean;
  broadcasterOnly: boolean;
  renamedTo: string | null;
  description: string;
  argVariants: {
    usage: string;
    desc: string;
    argKey: string;
    access: "everyone" | "mod" | "broadcaster";
  }[];
}

interface CustomCommand {
  name: string;
  response: string;
  rule: string;
  alias: string;
  enabled_when: string;
  required_game: string;
  regex1: string;
  regex2: string;
  text1: string;
  text2: string;
  isActive: boolean;
  cooldown: number;
  userCooldown: number;
  modOnly: boolean;
  broadcasterOnly: boolean;
  description: string;
  arg_descs: { usage: string; desc: string }[];
  flags: string[];
}

const commands = ref<Command[]>([]);
const customCommands = ref<CustomCommand[]>([]);
const prefix = ref("+");
const loading = ref(true);
const customLoading = ref(false);
const search = ref("");
const saving = ref<string | null>(null);

// >>> true for hardcoded commands, false for custom
const editOpen = ref(false);
const editingCmd = ref("");
const editIsBuiltIn = ref(true);
const editInitialTab = ref<"response" | "args" | "flags" | "behavior">("response");

// >>> new command name input state
const creatingNew = ref(false);
const newCmdName = ref("");
const newCmdError = ref("");
const newCmdInput = ref<HTMLInputElement | null>(null);

function openEdit(
  name: string,
  builtIn: boolean,
  initialTab?: "response" | "args" | "flags" | "behavior",
) {
  editingCmd.value = name;
  editIsBuiltIn.value = builtIn;
  editInitialTab.value = initialTab ?? "response";
  editOpen.value = true;
}

// >>> opens edit panel when search selects a command
const searchOpenEdit = inject<Ref<{ name: string; builtIn: boolean } | null>>(
  "searchOpenEdit",
  ref(null),
);
watch(searchOpenEdit, (val) => {
  if (!val) return;
  nextTick(() => {
    openEdit(val.name, val.builtIn);
    searchOpenEdit.value = null;
  });
});

function onEditSaved(name: string) {
  editingCmd.value = name;
  fetchCommands();
  fetchCustomCommands();
  loadKeywordTags();
  loadAliasTags();
}

function startCreate() {
  // >>> opens edit panel with an empty name
  openEdit('', false);
}

// >>> tab state
const activeTab = ref<"Default" | "Custom" | "Extras" | "Obs">("Default");
watch(activeTab, (tab) => {
  if (tab === "Obs" && !obsFetched.value) fetchObsCommands();
});

// >>> extras / feature flags
const mentionEnabled = ref(false);
const replyAllEnabled = ref(false);
const mentionOnlyOffline = ref(false);
const botOnlineOnly = ref(false);
const has7tvSet = ref(false);
const extrasLoading = ref(false);
const extrasSaving = ref(false);
const extrasSaved = ref(false);

async function fetchExtras() {
  if (!session.value) return;
  const ch = session.value.channel;
  extrasLoading.value = true;
  try {
    const res = await fetch(`${API}/settings/${ch}`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (!res.ok) return;
    const data = (await res.json()) as {
      mention_enabled: boolean;
      reply_all_enabled: boolean;
      mention_only_offline: boolean;
      bot_online_only: boolean;
      has_7tv_set: boolean;
    };
    if (session.value?.channel !== ch) return;
    mentionEnabled.value = data.mention_enabled;
    replyAllEnabled.value = data.reply_all_enabled;
    mentionOnlyOffline.value = data.mention_only_offline;
    botOnlineOnly.value = data.bot_online_only;
    has7tvSet.value = data.has_7tv_set ?? false;
  } catch {
  } finally {
    if (session.value?.channel === ch) extrasLoading.value = false;
  }
}

// >>> command name -> its keyword patterns, for the row-list keyword tags
const keywordsByCommand = ref<Record<string, string[]>>({});
async function loadKeywordTags() {
  if (!session.value) return;
  const ch = session.value.channel;
  try {
    const res = await fetch(`${API}/triggers/${ch}`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (!res.ok) return;
    const data = (await res.json()) as { triggers: any[] };
    if (session.value?.channel !== ch) return;
    const map: Record<string, string[]> = {};
    for (const tr of data.triggers ?? []) {
      if (tr.linked_command) {
        (map[tr.linked_command] ??= []).push(tr.match_pattern || tr.name);
      }
    }
    keywordsByCommand.value = map;
  } catch {
    if (session.value?.channel === ch) keywordsByCommand.value = {};
  }
}
onMounted(loadKeywordTags);
watch(() => session.value?.channel, loadKeywordTags);

// >>> real Twitch badges for the access button, same pattern as
// RolesView.vue's loadTwitchBadges - reuses the existing backend proxy
const modBadgeUrl = ref("");
const bcBadgeUrl = ref("");
async function loadAccessBadges() {
  if (!session.value) return;
  const ch = session.value.channel;
  try {
    const res = await fetch(`${API}/twitch/badges/${encodeURIComponent(ch)}`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (!res.ok) return;
    const d = (await res.json()) as any;
    if (session.value?.channel !== ch) return;
    const badgeMap = d?.badgeMap ?? {};
    modBadgeUrl.value = String(badgeMap["moderator/1"]?.image_url_2x ?? badgeMap["moderator/1"]?.image_url_1x ?? "");
    bcBadgeUrl.value = String(badgeMap["broadcaster/1"]?.image_url_2x ?? badgeMap["broadcaster/1"]?.image_url_1x ?? "");
  } catch { }
}
onMounted(loadAccessBadges);
watch(() => session.value?.channel, loadAccessBadges);

// >>> command name -> its aliases (channel-created + global), for row-list tags
const aliasesByCommand = ref<Record<string, string[]>>({});
// >>> built-ins that had a default alias removed - shows the same "customized"
// >>> hint as a rename, since it's silently no longer shipping with defaults
const commandsWithRemovedDefaultAlias = ref<Set<string>>(new Set());
async function loadAliasTags() {
  if (!session.value) return;
  const ch = session.value.channel;
  try {
    const res = await fetch(`${API}/command-aliases/${ch}`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (!res.ok) return;
    const data = (await res.json()) as {
      aliases: Record<string, string[]>;
      removedDefaults?: string[];
    };
    if (session.value?.channel !== ch) return;
    aliasesByCommand.value = data.aliases ?? {};
    commandsWithRemovedDefaultAlias.value = new Set(data.removedDefaults ?? []);
  } catch {
    if (session.value?.channel === ch) {
      aliasesByCommand.value = {};
      commandsWithRemovedDefaultAlias.value = new Set();
    }
  }
}
onMounted(loadAliasTags);
watch(() => session.value?.channel, loadAliasTags);

async function saveExtras() {
  if (!session.value) return;
  extrasSaving.value = true;
  try {
    await fetch(`${API}/settings/${session.value.channel}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.value.token}`,
      },
      body: JSON.stringify({
        mention_enabled: mentionEnabled.value,
        reply_all_enabled: replyAllEnabled.value,
        mention_only_offline: mentionOnlyOffline.value,
        bot_online_only: botOnlineOnly.value,
      }),
    });
    extrasSaved.value = true;
    setTimeout(() => (extrasSaved.value = false), 2000);
  } catch { }
  extrasSaving.value = false;
}

// >>> obs command state
const obsPaired = ref(false);
const obsLoading = ref(false);
const obsSceneBindings = ref<ObsSceneBind[]>([]);
const obsSourceBindings = ref<ObsSourceBind[]>([]);
const obsArgCommands = ref<Record<string, ObsArgEntry>>({});
const obsFetched = ref(false);

const OBS_ACTION_LABEL: Record<string, string> = {
  scene: "switch scene",
  show: "show source",
  hide: "hide source",
  toggle: "toggle visibility",
  mute: "mute",
  unmute: "unmute",
  mutetoggle: "toggle mute",
  volume: "set volume",
};

function obsAccessLabel(access?: string): string {
  return access === "broadcaster"
    ? t("cmd.access.bc")
    : access === "mod"
      ? t("cmd.access.mod")
      : t("cmd.access.everyone");
}

async function fetchObsCommands() {
  if (!session.value || !canViewObs.value) return;
  const ch = session.value.channel;
  obsLoading.value = true;
  try {
    const res = await fetch(`${API}/obs/${ch}`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (res.ok) {
      const d = (await res.json()) as {
        paired: boolean;
        scene_bindings?: ObsSceneBind[];
        source_bindings?: ObsSourceBind[];
        arg_commands?: Record<string, ObsArgEntry>;
      };
      if (session.value?.channel !== ch) return;
      obsPaired.value = !!d.paired;
      obsSceneBindings.value = d.scene_bindings ?? [];
      obsSourceBindings.value = d.source_bindings ?? [];
      obsArgCommands.value = d.arg_commands ?? {};
    }
  } catch { }
  if (session.value?.channel === ch) {
    obsFetched.value = true;
    obsLoading.value = false;
  }
}

function obsArgCommand(entry: ObsArgEntry): string {
  return typeof entry === "string" ? entry : entry.command;
}
function obsArgAccess(entry: ObsArgEntry): string | undefined {
  return typeof entry === "string" ? undefined : entry.access;
}
function obsArgUsage(action: string): string {
  if (action === "scene") return "<scene>";
  if (action === "volume") return "<source> <vol>";
  return "<source>";
}

const obsCommandCount = computed(
  () =>
    obsSceneBindings.value.length +
    obsSourceBindings.value.length +
    Object.keys(obsArgCommands.value).length,
);

// >>> obs edit panel
const obsEditOpen = ref(false);
const obsEditTarget = ref<{
  kind: "scene" | "source" | "arg";
  command: string;
} | null>(null);
const obsKnownScenes = ref<string[]>([]);
const obsKnownSources = ref<string[]>([]);

function openObsEdit(target: typeof obsEditTarget.value) {
  obsEditTarget.value = target;
  obsEditOpen.value = true;
  if (
    session.value &&
    (!obsKnownScenes.value.length || !obsKnownSources.value.length)
  ) {
    fetchObsSceneSourceLists();
  }
}

async function fetchObsSceneSourceLists() {
  if (!session.value) return;
  try {
    const r = await fetch(`${API}/obs/${session.value.channel}/scenes`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (r.ok) {
      const d = (await r.json()) as { scenes: { sceneName: string }[] };
      obsKnownScenes.value = d.scenes.map((s) => s.sceneName);
      if (d.scenes[0]) {
        const sr = await fetch(
          `${API}/obs/${session.value.channel}/sources?scene=${encodeURIComponent(d.scenes[0].sceneName)}`,
          { headers: { Authorization: `Bearer ${session.value.token}` } },
        );
        if (sr.ok) {
          const sd = (await sr.json()) as {
            sources: { sourceName: string }[];
          };
          obsKnownSources.value = sd.sources.map((s) => s.sourceName);
        }
      }
    }
  } catch { }
}

function onObsSaved() {
  fetchObsCommands();
}

async function saveObsBindings() {
  if (!session.value) return;
  await fetch(`${API}/obs/${session.value.channel}/bindings`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.value.token}`,
    },
    body: JSON.stringify({
      scene_bindings: obsSceneBindings.value,
      source_bindings: obsSourceBindings.value,
      arg_commands: obsArgCommands.value,
    }),
  });
}

// >>> obs delete
const obsDeleteConfirm = ref<string | null>(null);

function deleteObsBinding(kind: "scene" | "source" | "arg", key: string) {
  const id = `${kind}:${key}`;
  if (obsDeleteConfirm.value === id) {
    doDeleteObsBinding(kind, key);
  } else {
    obsDeleteConfirm.value = id;
    setTimeout(() => {
      if (obsDeleteConfirm.value === id) obsDeleteConfirm.value = null;
    }, 3000);
  }
}

async function doDeleteObsBinding(kind: "scene" | "source" | "arg", key: string) {
  if (!session.value) return;
  obsDeleteConfirm.value = null;
  if (kind === "scene") {
    obsSceneBindings.value = obsSceneBindings.value.filter((b) => b.command !== key);
  } else if (kind === "source") {
    obsSourceBindings.value = obsSourceBindings.value.filter((b) => b.command !== key);
  } else {
    const next = { ...obsArgCommands.value };
    delete next[key];
    obsArgCommands.value = next;
  }
  await saveObsBindings();
}

// >>> separate expand-sets for default vs custom
const expandedDefault = ref<Set<string>>(new Set());
const expandedCustom = ref<Set<string>>(new Set());

function toggleExpandDefault(name: string) {
  const s = new Set(expandedDefault.value);
  s.has(name) ? s.delete(name) : s.add(name);
  expandedDefault.value = s;
}
function toggleExpandCustom(name: string) {
  const s = new Set(expandedCustom.value);
  s.has(name) ? s.delete(name) : s.add(name);
  expandedCustom.value = s;
}

function customHasArgs(cmd: CustomCommand): boolean {
  if (cmd.arg_descs?.length) return true;
  return /\$args|\$\d\b|\{args\}|\$args\./i.test(
    (cmd.response || "") + " " + (cmd.rule || ""),
  );
}

function getCustomArgVariants(
  cmd: CustomCommand,
): { usage: string; desc: string }[] {
  if (cmd.arg_descs?.length) return cmd.arg_descs;
  const src = (cmd.response || "") + " " + (cmd.rule || "");
  const argNums = new Set<number>();
  for (const m of src.matchAll(/\$args\.(\d+)|\$(\d+)\b/g)) {
    const n = parseInt(m[1] ?? m[2] ?? "");
    if (!isNaN(n)) argNums.add(n);
  }
  if (argNums.size > 0) {
    const max = Math.max(...argNums);
    return [
      {
        usage: Array.from({ length: max }, (_, i) => `<arg${i + 1}>`).join(" "),
        desc: "",
      },
    ];
  }
  if (/\{args\}|\$args\b/i.test(src)) return [{ usage: "<args>", desc: "" }];
  return [];
}

// >>> excludes $if/$foreach/etc (Control Flow) - only real variable/data tokens
const SCRIPT_CONTROL_FLOW = new Set(["if", "else", "foreach", "repeat", "define", "index"]);
function scriptVarsUsed(cmd: CustomCommand): string[] {
  const src = `${cmd.response || ""} ${cmd.rule || ""} ${cmd.text1 || ""} ${cmd.text2 || ""}`;
  const found = new Set<string>();
  for (const m of src.matchAll(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g)) {
    const word = m[1]!.toLowerCase();
    if (SCRIPT_CONTROL_FLOW.has(word)) continue;
    found.add("$" + word);
  }
  return [...found];
}

const sortField = ref<"name" | "cooldown" | "isActive">("name");
const sortDir = ref<"asc" | "desc">("asc");
function setSort(field: typeof sortField.value) {
  if (sortField.value === field)
    sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
  else {
    sortField.value = field;
    sortDir.value = "asc";
  }
}

const BLOCKED = ["join", "leave", "pm2", "refresh", "whitelist", "git"];

function inferCategory(name: string): string {
  const utility = [
    "ping",
    "commands",
    "join",
    "leave",
    "pm2",
    "refresh",
    "say",
    "to",
    "user",
    "whitelist",
    "git",
    "cmd",
    "command",
    "message",
    "timeout",
    "ban",
    "delete",
  ];
  const chat = [
    "ask",
    "song",
    "gpt",
    "7tv",
    "talk",
    "verify",
    "shyboti",
    "say",
  ];
  const games = ["66", "ssp", "sw", "bottle"];
  if (utility.includes(name)) return "utility";
  if (chat.includes(name)) return "chat";
  if (games.includes(name)) return "games";
  return "fun";
}

const CAT_COLOR: Record<string, string> = {
  utility: "#7c83ff",
  chat: "#4ec9b0",
  fun: "#f9a84d",
  games: "#e06c75",
};

function sortByField<T extends Record<string, any>>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    let av: any = a[sortField.value],
      bv: any = b[sortField.value];
    if (typeof av === "boolean") av = av ? 1 : 0;
    if (typeof bv === "boolean") bv = bv ? 1 : 0;
    if (av < bv) return sortDir.value === "asc" ? -1 : 1;
    if (av > bv) return sortDir.value === "asc" ? 1 : -1;
    return 0;
  });
}

function filtered() {
  let list = commands.value.filter((c) => !BLOCKED.includes(c.name));
  if (search.value.trim())
    list = list.filter((c) => c.name.includes(search.value.toLowerCase()));
  return sortByField(list);
}

function filteredCustom() {
  let list = customCommands.value;
  if (search.value.trim())
    list = list.filter((c) => c.name.includes(search.value.toLowerCase()));
  return sortByField(list);
}

async function fetchCustomCommands() {
  if (!session.value) return;
  const ch = session.value.channel;
  customLoading.value = true;
  try {
    const res = await fetch(`${API}/custom-commands/${ch}`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (!res.ok) throw new Error();
    const data = (await res.json()) as { commands: CustomCommand[] };
    if (session.value?.channel !== ch) return;
    customCommands.value = data.commands.map((c) => ({
      ...c,
      isActive: !!c.isActive,
      modOnly: !!c.modOnly,
      broadcasterOnly: !!c.broadcasterOnly,
    }));
  } catch {
    if (session.value?.channel === ch) customCommands.value = [];
  } finally {
    if (session.value?.channel === ch) customLoading.value = false;
  }
}

async function fetchCommands() {
  if (!session.value) return;
  const ch = session.value.channel;
  loading.value = true;
  try {
    const res = await fetch(`${API}/commands/${ch}`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    if (!res.ok) throw new Error();
    const data = (await res.json()) as { commands: Command[]; prefix: string };
    if (session.value?.channel !== ch) return;
    commands.value = data.commands;
    prefix.value = data.prefix;
  } catch {
    if (session.value?.channel === ch) commands.value = [];
  } finally {
    if (session.value?.channel === ch) loading.value = false;
  }
}

async function updateCommand(cmd: Command) {
  if (!session.value) return;
  saving.value = cmd.name;
  try {
    await fetch(`${API}/commands/${session.value.channel}/${cmd.name}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.value.token}`,
      },
      body: JSON.stringify({
        isActive: cmd.isActive,
        cooldown: cmd.cooldown,
        userCooldown: cmd.userCooldown,
        modOnly: cmd.modOnly,
        broadcasterOnly: cmd.broadcasterOnly,
      }),
    });
  } finally {
    saving.value = null;
  }
}

function toggle(
  cmd: Command | CustomCommand,
  field: "isActive" | "modOnly" | "broadcasterOnly",
) {
  if (field === "isActive" && !canToggle.value) return;
  if (field !== "isActive" && !canEdit.value) return;
  (cmd as any)[field] = !(cmd as any)[field];
  if (customCommands.value.includes(cmd as CustomCommand))
    updateCustomActive(cmd as CustomCommand);
  else updateCommand(cmd as Command);
}

// >>> cycles everyone -> mod -> broadcaster -> everyone, click-in-place same
// as before it briefly moved to panel-only - backend already enforces
// per-command minimum access server-side, no need to duplicate that here
function cycleAccess(cmd: Command | CustomCommand) {
  if (!canToggle.value) return;
  const c = cmd as any;
  if (!c.modOnly && !c.broadcasterOnly) {
    c.modOnly = true;
    c.broadcasterOnly = false;
  } else if (c.modOnly) {
    c.modOnly = false;
    c.broadcasterOnly = true;
  } else {
    c.modOnly = false;
    c.broadcasterOnly = false;
  }
  if (customCommands.value.includes(cmd as CustomCommand))
    updateCustomActive(cmd as CustomCommand);
  else updateCommand(cmd as Command);
}

// >>> per-subcommand access override, independent of the command's own access
async function cycleArgAccess(
  cmd: Command,
  variant: Command["argVariants"][number],
) {
  if (!canEdit.value || !session.value) return;
  const order: Array<"everyone" | "mod" | "broadcaster"> = [
    "everyone",
    "mod",
    "broadcaster",
  ];
  const next = order[(order.indexOf(variant.access) + 1) % order.length]!;
  variant.access = next;
  try {
    await fetch(
      `${API}/commands/${session.value.channel}/${cmd.name}/arg-access`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.value.token}`,
        },
        body: JSON.stringify({ argKey: variant.argKey, access: next }),
      },
    );
  } catch { }
}

function restrictionLabel(cmd: {
  modOnly: boolean;
  broadcasterOnly: boolean;
}): string {
  if (cmd.broadcasterOnly) return t("cmd.access.bc");
  if (cmd.modOnly) return t("cmd.access.mod");
  return t("cmd.access.everyone");
}

// >>> mobile kebab menu items, desktop keeps the inline row buttons
function builtInKebabItems(cmd: Command): KebabMenuItem[] {
  return [
    {
      key: "edit",
      label: BLOCKED.includes(cmd.name)
        ? t("cmd.blocked")
        : canEdit.value
          ? t("cmd.edit")
          : t("cmd.no_access"),
      icon: "edit",
      disabled: !canEdit.value || BLOCKED.includes(cmd.name),
      onClick: () => openEdit(cmd.name, true),
    },
  ];
}

function customKebabItems(cmd: CustomCommand): KebabMenuItem[] {
  const items: KebabMenuItem[] = [
    {
      key: "edit",
      label: canEdit.value ? t("cmd.edit") : t("cmd.view"),
      icon: "edit",
      onClick: () => openEdit(cmd.name, false),
    },
    {
      key: "share",
      label: t("cmd.share_icon"),
      icon: "corner-up-right",
      onClick: () => openShare(cmd.name),
    },
  ];
  if (canDelete.value) {
    items.push({
      key: "delete",
      label: deleteConfirmName.value === cmd.name ? t("cmd.delete_sure") : t("cmd.delete"),
      icon: "trash",
      danger: true,
      onClick: () => deleteCustom(cmd.name),
    });
  }
  return items;
}

function obsBindingKebabItems(
  kind: "scene" | "source" | "arg",
  command: string,
  deleteKey: string,
): KebabMenuItem[] {
  return [
    {
      key: "edit",
      label: t("cmd.edit"),
      icon: "edit",
      onClick: () => openObsEdit({ kind, command }),
    },
    {
      key: "delete",
      label:
        obsDeleteConfirm.value === `${kind}:${deleteKey}`
          ? t("cmd.delete_sure")
          : t("cmd.delete"),
      icon: "trash",
      danger: true,
      onClick: () => deleteObsBinding(kind, deleteKey),
    },
  ];
}

function argAccessLabel(access: string): string {
  if (access === "broadcaster") return t("cmd.access.bc");
  if (access === "mod") return t("cmd.access.mod");
  return t("cmd.access.everyone");
}

// >>> mirrors backend applyPrefix()
function applyPrefix(text: string): string {
  return text.replace(/\+(?=[a-zA-Z])/g, prefix.value);
}

function cmdDesc(cmd: Command): string {
  const key = `cmddesc.${cmd.name}`;
  const translated = t(key);
  if (translated !== key) return applyPrefix(translated);
  return cmd.description ? applyPrefix(cmd.description) : "-";
}

const deletingName = ref<string | null>(null);
const deleteConfirmName = ref<string | null>(null);

function deleteCustom(name: string) {
  if (deleteConfirmName.value === name) {
    doDeleteCustom(name);
  } else {
    deleteConfirmName.value = name;
    setTimeout(() => {
      if (deleteConfirmName.value === name) deleteConfirmName.value = null;
    }, 3000);
  }
}

async function doDeleteCustom(name: string) {
  if (!session.value) return;
  deletingName.value = name;
  deleteConfirmName.value = null;
  try {
    await fetch(`${API}/custom-commands/${session.value.channel}/${name}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    await fetchCustomCommands();
  } catch { }
  deletingName.value = null;
}

async function updateCustomActive(cmd: CustomCommand) {
  if (!session.value) return;
  await fetch(`${API}/custom-commands/${session.value.channel}/${cmd.name}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.value.token}`,
    },
    body: JSON.stringify({ ...cmd, isActive: cmd.isActive }),
  });
}

// >>> share
const shareOpen = ref(false);
const shareCmd = ref("");
const shareTarget = ref("");
const shareSaving = ref(false);
const shareSuccess = ref("");
const shareError = ref("");

function openShare(name: string) {
  shareCmd.value = name;
  shareTarget.value = "";
  shareSuccess.value = "";
  shareError.value = "";
  shareOpen.value = true;
}

async function doShare() {
  if (!session.value || !shareTarget.value) return;
  shareSaving.value = true;
  shareError.value = "";
  try {
    const res = await fetch(
      `${API}/custom-commands/${session.value.channel}/${shareCmd.value}/share`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.value.token}`,
        },
        body: JSON.stringify({ target_channel: shareTarget.value }),
      },
    );
    if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
    shareSuccess.value = `Copied to #${shareTarget.value}!`;
    setTimeout(() => {
      shareOpen.value = false;
    }, 1500);
  } catch (e: any) {
    shareError.value = e.message ?? "Share failed";
  }
  shareSaving.value = false;
}

// >>> sync
const syncConf = ref<{
  sync_from: string;
  is_active: number;
  last_synced: number;
} | null>(null);
const syncOpen = ref(false);
const syncMode = ref<"ongoing" | "import">("ongoing");
const syncFrom = ref("");
const syncSaving = ref(false);
const syncRunning = ref(false);
const syncImporting = ref(false);
const syncMsg = ref("");

async function runImport() {
  if (!session.value || !syncFrom.value) return;
  syncImporting.value = true;
  syncMsg.value = "";
  try {
    const res = await fetch(
      `${API}/command-sync/${session.value.channel}/import`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.value.token}`,
        },
        body: JSON.stringify({ from: syncFrom.value }),
      },
    );
    const data = (await res.json()) as { count?: number; error?: string };
    if (!res.ok) throw new Error(data.error);
    syncMsg.value = `Imported ${data.count} commands from #${syncFrom.value}.`;
    await fetchCustomCommands();
  } catch (e: any) {
    syncMsg.value = e.message ?? "Import failed";
  }
  syncImporting.value = false;
}

async function fetchSync() {
  if (!session.value) return;
  const ch = session.value.channel;
  try {
    const res = await fetch(`${API}/command-sync/${ch}`, {
      headers: { Authorization: `Bearer ${session.value.token}` },
    });
    const data = (await res.json()) as { sync: any };
    if (session.value?.channel !== ch) return;
    syncConf.value = data.sync;
    syncFrom.value = data.sync?.sync_from ?? "";
  } catch { }
}

async function saveSync() {
  if (!session.value || !syncFrom.value) return;
  syncSaving.value = true;
  try {
    await fetch(`${API}/command-sync/${session.value.channel}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.value.token}`,
      },
      body: JSON.stringify({ sync_from: syncFrom.value, is_active: true }),
    });
    await fetchSync();
    syncMsg.value = "Sync config saved.";
  } catch {
    syncMsg.value = t("cmd.sync.error_save");
  }
  syncSaving.value = false;
}

async function stopSync() {
  if (!session.value || !syncConf.value) return;
  syncSaving.value = true;
  try {
    await fetch(`${API}/command-sync/${session.value.channel}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.value.token}`,
      },
      body: JSON.stringify({
        sync_from: syncConf.value.sync_from,
        is_active: false,
      }),
    });
    syncConf.value = { ...syncConf.value, is_active: 0 };
    syncMsg.value = t("cmd.sync.stopped");
  } catch {
    syncMsg.value = t("cmd.sync.error_stop");
  }
  syncSaving.value = false;
}

async function runSync() {
  if (!session.value) return;
  syncRunning.value = true;
  syncMsg.value = "";
  try {
    const res = await fetch(
      `${API}/command-sync/${session.value.channel}/run`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${session.value.token}` },
      },
    );
    const data = (await res.json()) as { count?: number; error?: string };
    if (!res.ok) throw new Error(data.error);
    syncMsg.value = `Synced ${data.count} commands from #${syncConf.value?.sync_from}.`;
    await fetchCustomCommands();
  } catch (e: any) {
    syncMsg.value = e.message ?? "Sync failed";
  }
  syncRunning.value = false;
}

const { availableChannels } = useAuth();

const reloading = ref(false);
async function reloadAll() {
  reloading.value = true;
  await Promise.all([
    fetchCommands(),
    fetchCustomCommands(),
    fetchSync(),
    fetchExtras(),
    ...(activeTab.value === "Obs" ? [fetchObsCommands()] : []),
  ]);
  reloading.value = false;
}

let _sseSource: EventSource | null = null;
// >>> guards the fetch's post-await callback firing after unmount
let _sseDisposed = false;
function startCommandSSE() {
  _sseSource?.close();
  if (!session.value?.token) return;
  fetch(`${API}/activity/sse-ticket`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.value.token}` },
  })
    .then((r) =>
      r.ok ? (r.json() as Promise<{ ticket: string }>) : Promise.reject(),
    )
    .then(({ ticket }) => {
      if (_sseDisposed) return;
      const ch = session.value?.channel ?? "";
      const es = new EventSource(
        `${API}/activity/stream?ticket=${ticket}&channel=${ch}`,
      );
      _sseSource = es;
      es.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data) as { type: string };
          if (ev.type?.startsWith("cmd_")) {
            fetchCommands();
            fetchCustomCommands();
          }
        } catch { }
      };
      es.onerror = () => {
        es.close();
        if (!_sseDisposed) setTimeout(startCommandSSE, 10_000);
      };
    })
    .catch(() => { });
}

onMounted(() => {
  fetchCommands();
  fetchCustomCommands();
  fetchSync();
  fetchExtras();
  startCommandSSE();
});
watch(
  () => session.value?.channel,
  () => {
    fetchCommands();
    fetchCustomCommands();
    fetchSync();
    fetchExtras();
    obsFetched.value = false;
    if (activeTab.value === "Obs") fetchObsCommands();
    startCommandSSE();
  },
);
onUnmounted(() => {
  _sseDisposed = true;
  _sseSource?.close();
});
</script>

<template>
  <div class="cmd-root ep-view">

    <div class="ep-view-header">
      <div>
        <div class="ep-view-title">{{ t("cmd.title") }}</div>
        <div class="ep-view-sub">
          <template v-if="activeTab === 'Default'">{{ filtered().length }} {{ t('cmd.count_plural') }}</template>
          <template v-else-if="activeTab === 'Custom'">{{ customCommands.length }} {{ customCommands.length !== 1 ?
            t('cmd.count_plural') : t('cmd.count') }}</template>
          <template v-else-if="activeTab === 'Obs' && obsPaired">{{ obsCommandCount }} OBS {{ t('cmd.count_plural')
            }}</template>
          <template v-else>&mdash;</template>
        </div>
      </div>
      <div class="ep-view-header-right">
        <!-- >>> custom tab only -->
        <div v-if="botPresent" class="ep-sync-wrap">
          <button v-if="activeTab === 'Custom' && syncConf?.is_active" class="ep-sync-indicator"
            @click="syncOpen = !syncOpen" :title="`${t('cmd.sync.active')} #${syncConf.sync_from}`">
            <span class="ep-sync-dot"></span>{{ t('cmd.sync.active') }} #{{ syncConf.sync_from }}<span
              class="ep-sync-chevron" :class="{ open: syncOpen }"></span>
          </button>
          <button v-else-if="activeTab === 'Custom'" class="ep-sync-config-btn" @click="syncOpen = !syncOpen">
            {{ t('cmd.sync.config') }}<span class="ep-sync-chevron" :class="{ open: syncOpen }"></span>
          </button>
          <div v-if="syncOpen && activeTab === 'Custom'" class="ep-sync-panel">
            <div class="ep-sync-modes">
              <button class="ep-sync-mode-btn" :class="{ active: syncMode === 'ongoing' }"
                @click="syncMode = 'ongoing'">Sync
                (ongoing)</button>
              <button class="ep-sync-mode-btn" :class="{ active: syncMode === 'import' }"
                @click="syncMode = 'import'">Import
                (one-time)</button>
            </div>
            <div class="ep-sync-row">
              <select v-model="syncFrom" class="ep-field-select-sm">
                <option value="">{{ syncMode === 'import' ? t("cmd.sync.select") : (syncConf?.is_active ?
                  t("cmd.sync.change") : t("cmd.sync.select")) }}</option>
                <option v-for="ch in availableChannels.filter((c) => c !== session?.channel)" :key="ch" :value="ch">#{{
                  ch }}
                </option>
              </select>
              <button v-if="syncMode === 'import'" class="ep-sync-save-btn" @click="runImport"
                :disabled="syncImporting || !syncFrom">
                {{ syncImporting ? '…' : 'Import' }}
              </button>
              <button v-else class="ep-sync-save-btn" @click="saveSync" :disabled="syncSaving || !syncFrom">
                {{ syncSaving ? '…' : syncConf?.is_active ? t('cmd.sync.update') : t('cmd.sync.enable') }}
              </button>
            </div>
            <div v-if="syncMode === 'ongoing'" class="ep-sync-row">
              <button v-if="syncConf?.is_active" class="ep-sync-run-btn" @click="runSync" :disabled="syncRunning">{{
                syncRunning
                  ? '…' : t('cmd.sync.pull') }}</button>
              <button v-if="syncConf?.is_active" class="ep-sync-stop-btn" @click="stopSync">{{ t('cmd.sync.stop')
                }}</button>
            </div>
            <div v-if="syncMode === 'ongoing' && syncConf?.last_synced" class="ep-sync-last">{{ t('cmd.sync.last') }}
              {{ new Date(syncConf.last_synced).toLocaleString() }}</div>
            <div v-if="syncMsg" class="ep-sync-msg"
              :class="{ err: syncMsg.includes('fail') || syncMsg.includes('Error') }">{{
                syncMsg }}</div>
          </div>
        </div>
        <button class="ep-btn-reload" @click="reloadAll" :disabled="reloading" :title="t('cmd.reload')">
          <template v-if="reloading">…</template>
          <span v-else v-html="iconSvgFor('refresh-cw')"></span>
        </button>
        <button v-if="activeTab === 'Custom'" class="ep-btn-new" :disabled="!canEdit"
          @click="canEdit && startCreate()">+ {{
            t('cmd.new') }}</button>
        <button v-else-if="activeTab === 'Obs' && obsPaired" class="ep-btn-new" @click="openObsEdit(null)">+ {{
          t('cmd.new')
          }}</button>
      </div>
    </div>

    <div class="ep-tabs">
      <button class="ep-tab" :class="{ active: activeTab === 'Default' }" @click="activeTab = 'Default'">
        {{ t("cmd.title_default") }}
      </button>
      <button class="ep-tab" :class="{ active: activeTab === 'Custom' }" @click="activeTab = 'Custom'">
        {{ t("cmd.title_custom") }}
      </button>
      <button v-if="canView" class="ep-tab" :class="{ active: activeTab === 'Extras' }" @click="activeTab = 'Extras'">
        {{ t("cmd.title_extras") }}
      </button>
      <button v-if="canViewObs" class="ep-tab" :class="{ active: activeTab === 'Obs' }" @click="activeTab = 'Obs'">
        OBS
      </button>
    </div>

    <div class="cmd-body">
      <!-- vvv default tab vvv -->
      <template v-if="activeTab === 'Default'">
        <div v-if="!loading && !botPresent" class="state-msg">{{ t("cmd.no_bot") }}</div>
        <div v-else-if="!loading && commands.length === 0" class="state-msg">
          {{ t("cmd.none") }} #{{ session?.channel }}
        </div>
        <template v-else>
          <div class="ep-row-header cmd-default-row">
            <div class="sort-col" @click="setSort('name')">{{ t("cmd.header.name") }}<span class="sort-arrow"
                v-html="sortField === 'name' ? iconSvgFor(sortDir === 'asc' ? 'chevron-up' : 'chevron-down') : iconSvgFor('chevrons-up-down')"></span>
            </div>
            <div>{{ t("cmd.header.desc") }}</div>
            <div>{{ t("cmd.header.tags") }}</div>
            <div class="sort-col" @click="setSort('cooldown')">{{ t("cmd.header.cooldowns") }}<span class="sort-arrow"
                v-html="sortField === 'cooldown' ? iconSvgFor(sortDir === 'asc' ? 'chevron-up' : 'chevron-down') : iconSvgFor('chevrons-up-down')"></span>
            </div>
            <div>{{ t("cmd.header.access") }}</div>
            <div>{{ t("cmd.sort.actions") }}</div>
            <div></div>
          </div>
          <div v-if="loading" class="rows">
            <div class="ep-row-grid cmd-default-row" v-for="i in 8" :key="i">
              <div>
                <div class="ep-skeleton-block" style="height:11px;width:80%;"></div>
              </div>
              <div>
                <div class="ep-skeleton-block" style="height:9px;width:70%;"></div>
              </div>
              <div>
                <div class="ep-skeleton-block" style="height:9px;width:50%;"></div>
              </div>
              <div>
                <div class="ep-skeleton-block" style="height:9px;width:50%;"></div>
              </div>
              <div>
                <div class="ep-skeleton-block ep-skeleton-btn icon"></div>
              </div>
              <div>
                <div class="ep-skeleton-block ep-skeleton-btn icon"></div>
              </div>
              <div>
                <div class="ep-skeleton-block ep-skeleton-square"></div>
              </div>
            </div>
          </div>
          <div v-else class="rows">
            <template v-for="cmd in filtered()" :key="cmd.name">
              <div class="ep-row-grid cmd-default-row" :class="{
                saving: saving === cmd.name,
                expanded: expandedDefault.has(cmd.name),
              }">
                <div class="ep-cell-name" :class="{ 'ep-row-cell-hover': cmd.argVariants?.length }"
                  @click="cmd.argVariants?.length && toggleExpandDefault(cmd.name)">
                  <span class="row-chevron-cell">
                    <button v-if="cmd.argVariants?.length" class="ep-row-expander"
                      :class="{ open: expandedDefault.has(cmd.name) }" :title="t('cmd.show_arg_variants')"
                      v-html="iconSvgFor('chevron-down')">
                    </button>
                  </span>
                  <span class="cmd-cat-dot" :style="{ background: CAT_COLOR[inferCategory(cmd.name)] }"></span>
                  <span class="cmd-name-text">{{ prefix }}{{ cmd.renamedTo || cmd.name }}</span>
                  <span v-if="cmd.renamedTo" class="cmd-renamed-hint" :title="`Default: ${prefix}${cmd.name}`">↺</span>
                  <span v-if="commandsWithRemovedDefaultAlias.has(cmd.name)" class="cmd-renamed-hint"
                    :title="t('cmd.default_alias_changed_hint')">↺</span>
                </div>
                <div class="ep-cell-text ep-row-cell-hover"
                  @click="canEdit && !BLOCKED.includes(cmd.name) && openEdit(cmd.name, true)">
                  <span class="cmd-desc-text">{{ cmdDesc(cmd) }}</span>
                </div>
                <div class="ep-cell-tags ep-row-cell-hover"
                  @click="canEdit && !BLOCKED.includes(cmd.name) && openEdit(cmd.name, true, 'args')">
                  <span v-for="al in (aliasesByCommand[cmd.name] ?? []).slice(0, 3)" :key="al" class="ep-tag keyword">{{
                    prefix }}{{ al }}</span>
                  <span v-if="(aliasesByCommand[cmd.name]?.length ?? 0) > 3" class="ep-tag keyword">
                    +{{ aliasesByCommand[cmd.name]!.length - 3 }}
                  </span>
                  <span v-for="kw in (keywordsByCommand[cmd.name] ?? []).slice(0, 3)" :key="kw" class="ep-tag arg"><span
                      v-html="iconSvgFor('link')"></span> {{ kw }}</span>
                  <span v-if="(keywordsByCommand[cmd.name]?.length ?? 0) > 3" class="ep-tag arg">
                    +{{ keywordsByCommand[cmd.name]!.length - 3 }}
                  </span>
                </div>
                <div class="ep-cell-tags ep-row-cell-hover"
                  @click="canEdit && !BLOCKED.includes(cmd.name) && openEdit(cmd.name, true, 'behavior')">
                  <span class="ep-tag cooldown">{{ t("cmd.header.gcd") }}: {{ cmd.cooldown }}s</span>
                  <span class="ep-tag cooldown user">{{ t("cmd.header.ucd") }}: {{ cmd.userCooldown }}s</span>
                </div>
                <div class="ep-row-cell-center">
                  <button class="ep-btn-action access"
                    :class="{ 'access-mod': cmd.modOnly, 'access-bc': cmd.broadcasterOnly }"
                    :title="restrictionLabel(cmd)" @click="cycleAccess(cmd)">
                    <img v-if="cmd.broadcasterOnly && bcBadgeUrl" :src="bcBadgeUrl" class="access-badge-icon" alt="" />
                    <img v-else-if="cmd.modOnly && modBadgeUrl" :src="modBadgeUrl" class="access-badge-icon" alt="" />
                    <template v-else>{{ restrictionLabel(cmd) }}</template>
                  </button>
                </div>
                <div class="ep-row-cell-center">
                  <button class="ep-btn-action edit" :class="{ disabled: BLOCKED.includes(cmd.name) || !canEdit }"
                    @click.stop="
                      canEdit &&
                      !BLOCKED.includes(cmd.name) &&
                      openEdit(cmd.name, true)
                      ">
                    {{
                      BLOCKED.includes(cmd.name)
                        ? t("cmd.blocked")
                        : !canEdit
                          ? t("cmd.no_access")
                          : t("cmd.edit")
                    }}
                  </button>
                </div>
                <div class="ep-row-cell-center">
                  <div class="ep-switch" :class="[
                    cmd.isActive ? 'on' : 'off',
                    { disabled: !canToggle },
                  ]" @click.stop="toggle(cmd, 'isActive')"><span class="ep-switch-knob"></span></div>
                </div>
                <RowKebabMenu :items="builtInKebabItems(cmd)" @click.stop />
              </div>
              <template v-if="expandedDefault.has(cmd.name) && cmd.argVariants?.length">
                <div v-for="(v, vi) in cmd.argVariants" :key="vi" class="arg-variant-row cmd-default-row">
                  <div class="arg-variant-indent"></div>
                  <div class="arg-variant-usage arg-variant-usage-wide">
                    <span class="arg-prefix">{{ prefix }}{{ cmd.name }}</span><span class="arg-args">{{
                      v.usage.replace(/^<(\$[^>]+)>$/, "[$1]")
                    }}</span>
                  </div>
                  <button class="ep-btn-action access arg-access-btn" :class="{
                    'access-mod': v.access === 'mod',
                    'access-bc': v.access === 'broadcaster',
                  }" :title="t('cmd.arg_access_title') + ': ' + argAccessLabel(v.access)"
                    @click="cycleArgAccess(cmd, v)">
                    <img v-if="v.access === 'broadcaster' && bcBadgeUrl" :src="bcBadgeUrl" class="access-badge-icon"
                      alt="" />
                    <img v-else-if="v.access === 'mod' && modBadgeUrl" :src="modBadgeUrl" class="access-badge-icon"
                      alt="" />
                    <template v-else>{{ argAccessLabel(v.access) }}</template>
                  </button>
                </div>
              </template>
            </template>
          </div>
        </template>
      </template>
      <!-- ^^^ default tab ^^^ -->

      <!-- vvv custom tab vvv -->
      <template v-if="activeTab === 'Custom'">

        <div v-if="customLoading || filteredCustom().length > 0" class="ep-row-header cmd-custom-row">
          <div class="sort-col" @click="setSort('name')">{{ t("cmd.sort.name") }}<span class="sort-arrow"
              v-html="sortField === 'name' ? iconSvgFor(sortDir === 'asc' ? 'chevron-up' : 'chevron-down') : iconSvgFor('chevrons-up-down')"></span>
          </div>
          <div>{{ t("cmd.header.desc") }}</div>
          <div>{{ t("cmd.header.tags") }}</div>
          <div class="sort-col" @click="setSort('cooldown')">{{ t("cmd.header.cooldowns") }}<span class="sort-arrow"
              v-html="sortField === 'cooldown' ? iconSvgFor(sortDir === 'asc' ? 'chevron-up' : 'chevron-down') : iconSvgFor('chevrons-up-down')"></span>
          </div>
          <div>{{ t("cmd.sort.access") }}</div>
          <div>{{ t("cmd.sort.actions") }}</div>
          <div></div>
        </div>

        <div v-if="customLoading" class="rows">
          <div class="ep-row-grid cmd-custom-row" v-for="i in 8" :key="i">
            <div>
              <div class="ep-skeleton-block" style="height:11px;width:80%;"></div>
            </div>
            <div>
              <div class="ep-skeleton-block" style="height:9px;width:70%;"></div>
            </div>
            <div>
              <div class="ep-skeleton-block" style="height:9px;width:50%;"></div>
            </div>
            <div>
              <div class="ep-skeleton-block" style="height:9px;width:50%;"></div>
            </div>
            <div>
              <div class="ep-skeleton-block ep-skeleton-btn icon"></div>
            </div>
            <div>
              <div class="ep-skeleton-block ep-skeleton-btn icon"></div>
            </div>
            <div>
              <div class="ep-skeleton-block ep-skeleton-square"></div>
            </div>
          </div>
        </div>
        <div v-else-if="filteredCustom().length === 0" class="custom-empty">
          <div class="empty-icon" v-html="iconSvgFor('star')"></div>
          <div class="empty-title">{{ t("cmd.empty.title") }}</div>
          <div class="empty-sub">{{ t("cmd.empty.sub") }}</div>
        </div>

        <template v-else>
          <div class="rows">
            <template v-for="cmd in filteredCustom()" :key="cmd.name">
              <div class="ep-row-grid cmd-custom-row" :class="{ expanded: expandedCustom.has(cmd.name) }">
                <div class="ep-cell-name" :class="{ 'ep-row-cell-hover': customHasArgs(cmd) }"
                  @click="customHasArgs(cmd) && toggleExpandCustom(cmd.name)">
                  <span class="row-chevron-cell">
                    <button v-if="customHasArgs(cmd)" class="ep-row-expander"
                      :class="{ open: expandedCustom.has(cmd.name) }" :title="t('cmd.show_arg_variants')"
                      v-html="iconSvgFor('chevron-down')">
                    </button>
                  </span>
                  <span class="cmd-cat-dot" style="background: #9d6cff"></span>
                  <span class="cmd-name-text">{{ prefix }}{{ cmd.name }}</span>
                </div>
                <div class="ep-cell-text ep-row-cell-hover" @click="canEdit && openEdit(cmd.name, false)">
                  <span class="cmd-desc-text">{{ cmd.description }}</span>
                </div>
                <div class="ep-cell-tags ep-row-cell-hover" @click="canEdit && openEdit(cmd.name, false, 'args')">
                  <span v-for="al in (aliasesByCommand[cmd.name] ?? []).slice(0, 3)" :key="al" class="ep-tag keyword">{{
                    prefix }}{{ al }}</span>
                  <span v-if="(aliasesByCommand[cmd.name]?.length ?? 0) > 3" class="ep-tag keyword">
                    +{{ aliasesByCommand[cmd.name]!.length - 3 }}
                  </span>
                  <span v-for="kw in (keywordsByCommand[cmd.name] ?? []).slice(0, 3)" :key="kw" class="ep-tag arg"><span
                      v-html="iconSvgFor('link')"></span> {{ kw }}</span>
                  <span v-if="(keywordsByCommand[cmd.name]?.length ?? 0) > 3" class="ep-tag arg">
                    +{{ keywordsByCommand[cmd.name]!.length - 3 }}
                  </span>
                  <span v-for="fl in cmd.flags ?? []" :key="fl" class="ep-tag condition">{{ fl }}</span>
                  <span v-for="vr in scriptVarsUsed(cmd).slice(0, 4)" :key="vr" class="ep-tag variable">{{ vr }}</span>
                  <span v-if="scriptVarsUsed(cmd).length > 4" class="ep-tag variable">
                    +{{ scriptVarsUsed(cmd).length - 4 }}
                  </span>
                </div>
                <div class="ep-cell-tags ep-row-cell-hover" @click="canEdit && openEdit(cmd.name, false, 'behavior')">
                  <span class="ep-tag cooldown">{{ t("cmd.header.gcd") }}: {{ cmd.cooldown }}s</span>
                  <span class="ep-tag cooldown user">{{ t("cmd.header.ucd") }}: {{ cmd.userCooldown }}s</span>
                </div>
                <div class="ep-row-cell-center">
                  <button class="ep-btn-action access"
                    :class="{ 'access-mod': cmd.modOnly, 'access-bc': cmd.broadcasterOnly }"
                    :title="restrictionLabel(cmd)" @click="cycleAccess(cmd)">
                    <img v-if="cmd.broadcasterOnly && bcBadgeUrl" :src="bcBadgeUrl" class="access-badge-icon" alt="" />
                    <img v-else-if="cmd.modOnly && modBadgeUrl" :src="modBadgeUrl" class="access-badge-icon" alt="" />
                    <template v-else>{{ restrictionLabel(cmd) }}</template>
                  </button>
                </div>
                <div class="custom-actions">
                  <button class="ep-btn-action edit" :class="{ disabled: !canEdit }"
                    @click="canEdit && openEdit(cmd.name, false)">
                    {{ canEdit ? t("cmd.edit") : t("cmd.view") }}
                  </button>
                  <button class="ep-btn-action share" @click="openShare(cmd.name)" :title="t('mod.share')"
                    v-html="iconSvgFor('corner-up-right')">
                  </button>
                  <button v-if="canDelete" class="ep-btn-action del" :class="{
                    confirm: deleteConfirmName === cmd.name,
                    deleting: deletingName === cmd.name,
                  }" @click="deleteCustom(cmd.name)" :title="deleteConfirmName === cmd.name
                    ? 'Click again to confirm'
                    : 'Delete'
                    ">
                    <template v-if="deletingName === cmd.name">…</template>
                    <template v-else-if="deleteConfirmName === cmd.name">{{ t("cmd.delete_sure") }}</template>
                    <span v-else v-html="iconSvgFor('trash')"></span>
                  </button>
                </div>
                <div class="ep-row-cell-center">
                  <div class="ep-switch" :class="[
                    cmd.isActive ? 'on' : 'off',
                    { disabled: !canToggle },
                  ]" @click="
                    cmd.isActive = !cmd.isActive;
                  updateCustomActive(cmd);
                  "><span class="ep-switch-knob"></span></div>
                </div>
                <RowKebabMenu :items="customKebabItems(cmd)" @click.stop />
              </div>
              <template v-if="expandedCustom.has(cmd.name)">
                <div v-for="(v, vi) in getCustomArgVariants(cmd)" :key="vi" class="arg-variant-row cmd-custom-row">
                  <div class="arg-variant-indent"></div>
                  <div class="arg-variant-usage">
                    <span class="arg-prefix">{{ prefix }}{{ cmd.name }}</span><span class="arg-args">{{ v.usage
                      }}</span>
                  </div>
                  <div class="arg-variant-desc">{{ v.desc || "" }}</div>
                </div>
              </template>
            </template>
          </div>
        </template>
      </template>
      <!-- ^^^ custom tab ^^^ -->

      <!-- vvv obs tab vvv -->
      <template v-if="activeTab === 'Obs'">
        <div v-if="obsLoading" class="state-msg">{{ t("cmd.loading") }}</div>

        <template v-else-if="!obsPaired">
          <div class="custom-empty">
            <div class="empty-icon" v-html="iconSvgFor('star')"></div>
            <div class="empty-title">OBS isn't set up yet</div>
            <div class="empty-sub">
              Set up the agent on the
              <router-link to="/obs-control" class="obs-cmd-link">OBS Control</router-link>
              page, then commands you add here will appear.
            </div>
          </div>
        </template>

        <template v-else>
          <!-- >>> count and new button live in the header -->

          <div v-if="obsCommandCount === 0" class="custom-empty">
            <div class="empty-icon" v-html="iconSvgFor('star')"></div>
            <div class="empty-title">No OBS commands yet</div>
            <div class="empty-sub">
              Click <strong>+ New</strong> to create your first scene or source
              command.
            </div>
          </div>

          <template v-else>
            <div class="ep-row-header cmd-obs-row">
              <div></div>
              <div>{{ t("cmd.header.name") }}</div>
              <div>{{ t("cmd.header.desc") }}</div>
              <div>{{ t("cmd.header.cooldowns") }}</div>
              <div>{{ t("cmd.header.access") }}</div>
              <div>{{ t("cmd.sort.actions") }}</div>
              <div></div>
            </div>

            <div class="rows">
              <div v-for="b in obsSceneBindings" :key="'sc' + b.command" class="ep-row-grid cmd-obs-row">
                <div class="row-chevron-cell"></div>
                <div class="ep-cell-name"><span class="cmd-cat-dot" style="background: #e5c07b"></span><span
                    class="cmd-name-text">{{ prefix }}{{ b.command }}</span></div>
                <div class="ep-cell-text"><span class="cmd-desc-text">switch scene · {{ b.scene }}</span></div>
                <div class="ep-cell-tags ep-row-cell-hover" @click="openObsEdit({ kind: 'scene', command: b.command })">
                  <span class="ep-tag cooldown">{{ t("cmd.header.gcd") }}: {{ b.cooldown ?? 0 }}s</span>
                  <span class="ep-tag cooldown user">{{ t("cmd.header.ucd") }}: {{ b.userCooldown ?? 0 }}s</span>
                </div>
                <div class="ep-row-cell-center">
                  <button class="ep-btn-action access"
                    :class="{ 'access-mod': b.access === 'mod', 'access-bc': b.access === 'broadcaster' }"
                    :title="obsAccessLabel(b.access)" @click="openObsEdit({ kind: 'scene', command: b.command })">
                    <img v-if="b.access === 'broadcaster' && bcBadgeUrl" :src="bcBadgeUrl" class="access-badge-icon"
                      alt="" />
                    <img v-else-if="b.access === 'mod' && modBadgeUrl" :src="modBadgeUrl" class="access-badge-icon"
                      alt="" />
                    <template v-else>{{ obsAccessLabel(b.access) }}</template>
                  </button>
                </div>
                <div class="custom-actions">
                  <button class="ep-btn-action edit" @click="openObsEdit({ kind: 'scene', command: b.command })">{{
                    t('cmd.edit')
                    }}</button>
                  <button class="ep-btn-action del" :class="{ confirm: obsDeleteConfirm === 'scene:' + b.command }"
                    @click="deleteObsBinding('scene', b.command)">
                    <template v-if="obsDeleteConfirm === 'scene:' + b.command">{{ t('cmd.delete_sure') }}</template>
                    <span v-else v-html="iconSvgFor('trash')"></span>
                  </button>
                </div>
                <div class="ep-row-cell-center">
                  <div class="ep-switch on"><span class="ep-switch-knob"></span></div>
                </div>
                <RowKebabMenu :items="obsBindingKebabItems('scene', b.command, b.command)" @click.stop />
              </div>

              <div v-for="b in obsSourceBindings" :key="'so' + b.command" class="ep-row-grid cmd-obs-row">
                <div class="row-chevron-cell"></div>
                <div class="ep-cell-name"><span class="cmd-cat-dot" style="background: #e5c07b"></span><span
                    class="cmd-name-text">{{
                      prefix }}{{ b.command }}</span></div>
                <div class="ep-cell-text"><span class="cmd-desc-text">{{ OBS_ACTION_LABEL[b.action] ?? b.action }} ·
                    {{ b.source }}<template v-if="b.action === 'volume' && b.value !== undefined"> @ {{ b.value
                      }}%</template></span>
                </div>
                <div class="ep-cell-tags ep-row-cell-hover" @click="openObsEdit({ kind: 'source', command: b.command })">
                  <span class="ep-tag cooldown">{{ t("cmd.header.gcd") }}: {{ b.cooldown ?? 0 }}s</span>
                  <span class="ep-tag cooldown user">{{ t("cmd.header.ucd") }}: {{ b.userCooldown ?? 0 }}s</span>
                </div>
                <div class="ep-row-cell-center">
                  <button class="ep-btn-action access"
                    :class="{ 'access-mod': b.access === 'mod', 'access-bc': b.access === 'broadcaster' }"
                    :title="obsAccessLabel(b.access)" @click="openObsEdit({ kind: 'source', command: b.command })">
                    <img v-if="b.access === 'broadcaster' && bcBadgeUrl" :src="bcBadgeUrl" class="access-badge-icon"
                      alt="" />
                    <img v-else-if="b.access === 'mod' && modBadgeUrl" :src="modBadgeUrl" class="access-badge-icon"
                      alt="" />
                    <template v-else>{{ obsAccessLabel(b.access) }}</template>
                  </button>
                </div>
                <div class="custom-actions">
                  <button class="ep-btn-action edit" @click="openObsEdit({ kind: 'source', command: b.command })">{{
                    t('cmd.edit')
                    }}</button>
                  <button class="ep-btn-action del" :class="{ confirm: obsDeleteConfirm === 'source:' + b.command }"
                    @click="deleteObsBinding('source', b.command)">
                    <template v-if="obsDeleteConfirm === 'source:' + b.command">{{ t('cmd.delete_sure') }}</template>
                    <span v-else v-html="iconSvgFor('trash')"></span>
                  </button>
                </div>
                <div class="ep-row-cell-center">
                  <div class="ep-switch on"><span class="ep-switch-knob"></span></div>
                </div>
                <RowKebabMenu :items="obsBindingKebabItems('source', b.command, b.command)" @click.stop />
              </div>

              <div v-for="(entry, action) in obsArgCommands" :key="'arg' + action" class="ep-row-grid cmd-obs-row">
                <div class="row-chevron-cell"></div>
                <div class="ep-cell-name"><span class="cmd-cat-dot" style="background: #e5c07b"></span><span
                    class="cmd-name-text">{{
                      prefix }}{{ obsArgCommand(entry) }}</span></div>
                <div class="ep-cell-text"><span class="cmd-desc-text">{{ OBS_ACTION_LABEL[action] ?? action }} ·
                    <span class="obs-arg-usage-inline">{{ obsArgUsage(action) }}</span></span></div>
                <div class="ep-cell-tags ep-row-cell-hover"
                  @click="openObsEdit({ kind: 'arg', command: obsArgCommand(entry) })">
                  <span class="ep-tag cooldown">{{ t("cmd.header.gcd") }}: {{ typeof entry === 'string' ? 0 : ((entry as
                    any).cooldown ?? 0) }}s</span>
                  <span class="ep-tag cooldown user">{{ t("cmd.header.ucd") }}: {{ typeof entry === 'string' ? 0 :
                    ((entry as any).userCooldown ?? 0) }}s</span>
                </div>
                <div class="ep-row-cell-center">
                  <button class="ep-btn-action access"
                    :class="{ 'access-mod': obsArgAccess(entry) === 'mod', 'access-bc': obsArgAccess(entry) === 'broadcaster' }"
                    :title="obsAccessLabel(obsArgAccess(entry))"
                    @click="openObsEdit({ kind: 'arg', command: obsArgCommand(entry) })">
                    <img v-if="obsArgAccess(entry) === 'broadcaster' && bcBadgeUrl" :src="bcBadgeUrl"
                      class="access-badge-icon" alt="" />
                    <img v-else-if="obsArgAccess(entry) === 'mod' && modBadgeUrl" :src="modBadgeUrl"
                      class="access-badge-icon" alt="" />
                    <template v-else>{{ obsAccessLabel(obsArgAccess(entry)) }}</template>
                  </button>
                </div>
                <div class="custom-actions">
                  <button class="ep-btn-action edit"
                    @click="openObsEdit({ kind: 'arg', command: obsArgCommand(entry) })">{{
                      t('cmd.edit') }}</button>
                  <button class="ep-btn-action del" :class="{ confirm: obsDeleteConfirm === 'arg:' + action }"
                    @click="deleteObsBinding('arg', action)">
                    <template v-if="obsDeleteConfirm === 'arg:' + action">{{ t('cmd.delete_sure') }}</template>
                    <span v-else v-html="iconSvgFor('trash')"></span>
                  </button>
                </div>
                <div class="ep-row-cell-center">
                  <div class="ep-switch on"><span class="ep-switch-knob"></span></div>
                </div>
                <RowKebabMenu :items="obsBindingKebabItems('arg', obsArgCommand(entry), String(action))" @click.stop />
              </div>
            </div>
          </template>
        </template>
      </template>
      <!-- ^^^ obs tab ^^^ -->

      <!-- vvv extras tab vvv -->
      <template v-if="activeTab === 'Extras' && canView">
        <div v-if="extrasLoading" class="state-msg">Loading…</div>
        <div v-else-if="!botPresent" class="state-msg">{{ t("cmd.no_bot") }}</div>
        <template v-else>
          <div class="extras-section">
            <div class="extras-section-title">{{ t("cmd.extras.mention_section") }}</div>
            <div class="extras-row">
              <div class="ep-switch" :class="{
                on: mentionEnabled && has7tvSet,
                disabled: !canToggle || !has7tvSet,
              }" @click="
                canToggle &&
                has7tvSet &&
                ((mentionEnabled = !mentionEnabled), saveExtras())
                "><span class="ep-switch-knob"></span></div>
              <div class="extras-info">
                <div class="extras-label">
                  {{ t("cmd.extras.mention_label") }}
                </div>
                <div class="extras-desc">{{ t("cmd.extras.mention_desc") }}</div>
                <div v-if="!has7tvSet" class="extras-gate-note">
                  {{ t("cmd.extras.mention_needs_7tv") }}
                </div>
              </div>
            </div>
            <div class="extras-row">
              <div class="ep-switch" :class="{
                on: replyAllEnabled && has7tvSet && mentionEnabled,
                disabled: !canToggle || !has7tvSet || !mentionEnabled,
              }" @click="
                canToggle &&
                has7tvSet &&
                mentionEnabled &&
                ((replyAllEnabled = !replyAllEnabled), saveExtras())
                "><span class="ep-switch-knob"></span></div>
              <div class="extras-info">
                <div class="extras-label">
                  {{ t("cmd.extras.reply_all_label") }}
                </div>
                <div class="extras-desc">{{ t("cmd.extras.reply_all_desc") }}</div>
                <div v-if="!mentionEnabled" class="extras-gate-note">
                  {{ t("cmd.extras.reply_all_needs_mention") }}
                </div>
              </div>
            </div>
            <div class="extras-row">
              <div class="ep-switch" :class="{
                on: mentionOnlyOffline && has7tvSet && mentionEnabled,
                disabled: !canToggle || !has7tvSet || !mentionEnabled,
              }" @click="
                canToggle &&
                has7tvSet &&
                mentionEnabled &&
                ((mentionOnlyOffline = !mentionOnlyOffline), saveExtras())
                "><span class="ep-switch-knob"></span></div>
              <div class="extras-info">
                <div class="extras-label">
                  {{ t("cmd.extras.only_offline_label") }}
                </div>
                <div class="extras-desc">{{ t("cmd.extras.only_offline_desc") }}</div>
                <div v-if="!mentionEnabled" class="extras-gate-note">
                  {{ t("cmd.extras.reply_all_needs_mention") }}
                </div>
              </div>
            </div>
          </div>

          <div class="extras-section">
            <div class="extras-section-title">{{ t("cmd.extras.bot_section") }}</div>
            <div class="extras-row">
              <div class="ep-switch" :class="{
                on: botOnlineOnly,
                disabled: !canToggle,
              }" @click="
                canToggle &&
                ((botOnlineOnly = !botOnlineOnly), saveExtras())
                "><span class="ep-switch-knob"></span></div>
              <div class="extras-info">
                <div class="extras-label">
                  {{ t("cmd.extras.online_only_label") }}
                </div>
                <div class="extras-desc">{{ t("cmd.extras.online_only_desc") }}</div>
              </div>
            </div>
          </div>

        </template>
      </template>
      <!-- ^^^ extras tab ^^^ -->
    </div>
  </div>

  <CommandEditPanel :cmdName="editingCmd" :channel="session?.channel ?? ''" :open="editOpen" :isBuiltIn="editIsBuiltIn"
    :initialTab="editInitialTab" :prefix="prefix" @close="editOpen = false" @saved="onEditSaved" />

  <ObsCommandEditPanel :open="obsEditOpen" :channel="session?.channel ?? ''" :sceneBindings="obsSceneBindings"
    :sourceBindings="obsSourceBindings" :argCommands="obsArgCommands" :editTarget="obsEditTarget" :prefix="prefix"
    :scenes="obsKnownScenes" :sources="obsKnownSources" @close="obsEditOpen = false" @saved="onObsSaved" />

  <!-- vvv share modal vvv -->
  <Teleport to="body">
    <div v-if="shareOpen" class="modal-overlay" @click.self="shareOpen = false">
      <div class="modal">
        <div class="modal-title">
          {{ t("cmd.share.title")
          }}<span class="modal-cmd">+{{ shareCmd }}</span>
        </div>
        <div class="modal-sub">{{ t("cmd.share.sub") }}</div>
        <select v-model="shareTarget" class="ep-field-select-sm" style="width: 100%; margin-top: 12px">
          <option value="">{{ t("cmd.share.select") }}</option>
          <option v-for="ch in availableChannels.filter(
            (c) => c !== session?.channel,
          )" :key="ch" :value="ch">
            #{{ ch }}
          </option>
        </select>
        <div v-if="shareError" class="modal-msg err">{{ shareError }}</div>
        <div v-if="shareSuccess" class="modal-msg ok">{{ shareSuccess }}</div>
        <div class="modal-footer">
          <button class="btn-cancel" @click="shareOpen = false">
            {{ t("settings.cancel") }}
          </button>
          <button class="btn-save" @click="doShare" :disabled="shareSaving || !shareTarget">
            {{ shareSaving ? t("cmd.share.copying") : t("cmd.share.btn") }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
  <!-- ^^^ share modal ^^^ -->
</template>

<style scoped>
/* >>> layout comes from shared.css */

/* >>> scrolls internally, header/tabs stay put */
.cmd-body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  scrollbar-width: none;
}

.cmd-body::-webkit-scrollbar {
  display: none;
}

.state-msg {
  color: #555;
  padding: 40px;
  text-align: center;
  font-size: 14px;
}

.table-header,
.table-row {
  display: grid;
  grid-template-columns: 28px 50px 140px 1fr 110px 90px 90px 110px;
  align-items: center;
}

/* >>> Default/Custom tabs - 7 tracks: name (expander lives inside this cell
   now, not its own column - so hover/click-to-expand reaches the true left
   edge of the row instead of starting after a separate chevron column),
   description (text only), tags (alias/keyword/flags - own section, not
   mixed into desc), cooldowns (global+user grouped), access (its own
   button, positioned next to actions), actions, switch (rightmost, after
   actions). */
.ep-row-header.cmd-default-row,
.ep-row-grid.cmd-default-row {
  grid-template-columns: 168px 1fr 160px 140px 90px 110px 50px;
}

.ep-row-header.cmd-custom-row,
.ep-row-grid.cmd-custom-row {
  grid-template-columns: 168px 1fr 160px 140px 90px 150px 50px;
}

/* >>> self-contained (indent, usage, desc), not tracking the parent's exact
   column layout - this sub-row only ever shows those 3 pieces */
.arg-variant-row.cmd-custom-row {
  grid-template-columns: 28px 1fr 1fr;
}

.ep-row-header.cmd-obs-row,
.ep-row-grid.cmd-obs-row {
  grid-template-columns: 28px 140px 1fr 140px 90px 150px 50px;
}

.ep-row-grid.saving {
  opacity: 0.6;
  pointer-events: none;
}

.ep-row-grid.expanded {
  border-bottom: none;
}

.ep-row-grid.expandable {
  cursor: pointer;
}

.custom-table-header,
.custom-row {
  grid-template-columns: 28px 50px 140px 1fr 110px 90px 90px 150px;
}

.sort-col {
  cursor: pointer;
  user-select: none;
}

.sort-col:hover {
  color: #aaa;
}

.sort-arrow {
  font-size: 9px;
  color: #555;
  margin-left: 3px;
}

.table-header {
  padding: 8px 16px;
  color: #555;
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border-bottom: 1px solid #222;
  margin-top: 12px;
}

.rows {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin-top: 2px;
}

.table-row {
  min-height: 48px;
  padding: 0 16px 0 8px;
  background: #222226;
  ;
  border-bottom: 1px solid #1e1e1e;
  transition: background 0.1s, opacity 0.2s;
}

.table-row:hover {
  background: #1c1c20;
}

.table-row.saving {
  opacity: 0.6;
  pointer-events: none;
}

.table-row.expanded {
  border-bottom: none;
}

.table-row.expandable {
  cursor: pointer;
}

/* >>> .row-chevron-cell comes from shared.css */

.arg-variant-row {
  display: grid;
  grid-template-columns: 28px 50px 140px 1fr 110px 90px 90px 110px;
  padding: 6px 16px 6px 8px;
  background: #222226;
  border-top: 1px solid #1e1e22;
  align-items: center;
  animation: slideDown 0.15s ease;
}

.arg-variant-usage {
  padding-left: 10px;
}

.arg-variant-desc {
  padding-left: 8px;
}

.arg-variant-indent {
  grid-column: 1;
}

.arg-variant-usage {
  grid-column: 2;
}

.arg-variant-desc {
  grid-column: 3;
}

/* >>> Default tab's arg-variant-row tracks the PARENT .cmd-default-row's
   exact columns, so the access button lines up directly under the parent
   row's own access button instead of using an unrelated column count. */
.arg-variant-row.cmd-default-row {
  grid-template-columns: 168px 1fr 160px 140px 90px 110px 50px;
  /* >>> matches .ep-row-grid's padding so this sub-row's columns line up
     exactly under the parent row's columns */
  padding: 6px 14px 6px 0;
}

.arg-variant-usage-wide {
  /* >>> spans name+desc+tags+cooldowns - default commands never have a
     usage desc, so usage gets all that width instead */
  grid-column: 1 / 5;
}

.arg-access-btn {
  grid-column: 5;
  justify-self: center;
}

.arg-variant-row:last-of-type {
  border-bottom: 1px solid #222;
  margin-bottom: 2px;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }

  to {
    opacity: 1;
    transform: none;
  }
}

.arg-variant-indent {
  width: 20px;
}

.arg-variant-usage {
  display: flex;
  align-items: center;
  gap: 5px;
  font-family: "Consolas", "Fira Mono", monospace;
  font-size: 12px;
}

.arg-prefix {
  color: #9d6cff;
  font-weight: 700;
}

.arg-args {
  color: #e5c07b;
}

.arg-variant-desc {
  font-size: 11px;
  color: #555;
  font-style: italic;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* >>> .ep-switch comes from shared.css */

/* >>> .ep-cell-name layout lives in shared.css now - only command-specific
   content (cat dot, name text, rename hint) stays local */
.cmd-cat-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.cmd-renamed-hint {
  color: #9d6cff;
  font-size: 11px;
  cursor: help;
}

/* >>> read-only .ep-tag access severity colors - matches the old .access-btn
   cycle-button colors, just not a button anymore (panel owns editing now) */
.ep-tag.access-mod {
  border-color: #c792ea55;
  color: #c792ea;
  background: rgba(199, 146, 234, 0.08);
}

.ep-tag.access-bc {
  border-color: #f1494955;
  color: #f14949;
  background: rgba(241, 73, 73, 0.08);
}

.custom-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid #222;
  margin-bottom: 2px;
}

.custom-count {
  font-size: 11px;
  color: #555;
}

.custom-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.custom-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px 24px;
  color: #444;
  text-align: center;
}

.empty-icon {
  font-size: 24px;
  color: #333;
  margin-bottom: 12px;
}

.empty-title {
  font-size: 14px;
  font-weight: 700;
  color: #555;
  margin-bottom: 6px;
}

.empty-sub {
  font-size: 12px;
  color: #444;
}

.custom-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* >>> .ep-cell-name/.ep-cell-text/.ep-cell-tags/.ep-btn-action.access
   (.access-mod/.access-bc) come from shared.css */

.cmd-desc-text {
  font-size: 11px;
  color: #8d8d8d;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex-shrink: 1;
}

.ep-tag.keyword,
.ep-tag.arg {
  flex-shrink: 0;
}

/* >>> shared.css's .ep-btn-action.del has no "in progress" state - add it here */
.ep-btn-action.del.deleting {
  opacity: 0.5;
  cursor: not-allowed;
}

.new-cmd-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.new-cmd-prefix {
  font-size: 14px;
  font-weight: 700;
  color: #9d6cff;
}

.new-cmd-input {
  height: 32px;
  padding: 0 10px;
  background: #111217;
  border: 1px solid #6f2bff55;
  color: #e0e0e0;
  font-family: inherit;
  font-size: 13px;
  outline: none;
  width: 160px;
}

.new-cmd-input:focus {
  border-color: #9d6cff;
}

.new-cmd-input-conflict {
  border-color: #f1494966 !important;
  background: #1c1215 !important;
}

.cancel-btn {
  height: 32px;
  width: 32px;
  border: 1px solid #333;
  background: transparent;
  color: #666;
  font-size: 12px;
  cursor: pointer;
}

.cancel-btn:hover {
  color: #e0e0e0;
  border-color: #555;
}

.new-cmd-error {
  font-size: 11px;
  color: #f14949;
}

/* >>> sync buttons come from shared.css */

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1001;
}

.modal {
  background: #1a1a1e;
  border: 1px solid #2a2a30;
  padding: 24px;
  width: 360px;
  max-width: 90vw;
}

.modal-title {
  font-size: 15px;
  font-weight: 700;
  color: #e0e0e0;
  margin-bottom: 4px;
}

.modal-cmd {
  color: #9d6cff;
}

.modal-sub {
  font-size: 11px;
  color: #555;
}

.modal-msg {
  font-size: 11px;
  margin-top: 8px;
  padding: 6px 10px;
}

.modal-msg.ok {
  color: #23d18b;
  background: rgba(35, 209, 139, 0.08);
  border-left: 2px solid #23d18b;
}

.modal-msg.err {
  color: #f14949;
  background: rgba(241, 73, 73, 0.08);
  border-left: 2px solid #f14949;
}

.modal-footer {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 16px;
}

.btn-save {
  height: 32px;
  padding: 0 16px;
  border: none;
  background: #6f2bff;
  color: #fff;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.btn-save:hover:not(:disabled) {
  background: #7f3fff;
}

.btn-save:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-cancel {
  height: 32px;
  padding: 0 12px;
  border: 1px solid #333;
  background: transparent;
  color: #888;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.btn-cancel:hover {
  border-color: #555;
  color: #e0e0e0;
}

.obs-cmd-link {
  color: #9d6cff;
  text-decoration: none;
}

.obs-cmd-link:hover {
  text-decoration: underline;
}

.obs-arg-usage-inline {
  color: #e5c07b;
  font-family: "Consolas", "Fira Mono", monospace;
}

.extras-gate-note {
  font-size: 11px;
  color: #e5c07b;
  margin-top: 5px;
  max-width: 300px;
  line-height: 1.5;
}

.extras-section {
  background: #222226;
  border: 1px solid #2a2a30;
  padding: 20px;
  margin-top: 12px;
}

.extras-section-title {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #9d6cff;
  margin-bottom: 12px;
}

.extras-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 12px 0;
  border-top: 1px solid #2a2a30;
}

.extras-row:first-of-type {
  border-top: none;
}

.extras-info {
  flex: 1;
}

.extras-label {
  font-size: 13px;
  font-weight: 600;
  color: #d0d0d0;
  margin-bottom: 4px;
}

.extras-desc {
  font-size: 11px;
  color: #555;
  line-height: 1.5;
}

.extras-readonly-note {
  font-size: 11px;
  color: #555;
  margin-top: 16px;
  text-align: center;
}

@media (max-width: 680px) {
  .ep-row-header {
    display: none;
  }

  /* >>> single line on phone: chevron, toggle, name, kebab. access/edit/share/
     delete move into the kebab, cooldowns live in the edit panel only */
  .ep-row-grid.cmd-default-row,
  .ep-row-grid.cmd-custom-row {
    display: flex;
    align-items: center;
    height: auto;
    padding: 10px 12px;
    gap: 8px;
  }

  /* >>> fixed width regardless of content - was collapsing on rows with no
     arg variants, shifting the toggle left/right row to row */
  .ep-row-grid.cmd-default-row>.row-chevron-cell,
  .ep-row-grid.cmd-custom-row>.row-chevron-cell {
    width: 20px;
    flex-shrink: 0;
  }

  .ep-row-grid.cmd-default-row>.ep-cell-name,
  .ep-row-grid.cmd-custom-row>.ep-cell-name {
    flex: 1;
    min-width: 0;
  }

  .cmd-name-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .ep-row-grid.cmd-default-row>.ep-cell-text,
  .ep-row-grid.cmd-custom-row>.ep-cell-text,
  .ep-row-grid.cmd-default-row>*:nth-child(5),
  .ep-row-grid.cmd-custom-row>*:nth-child(5),
  .ep-row-grid.cmd-default-row>*:nth-child(6),
  .ep-row-grid.cmd-custom-row>*:nth-child(6),
  .ep-row-grid.cmd-default-row>*:nth-child(7),
  .ep-row-grid.cmd-custom-row>*:nth-child(7),
  .ep-row-grid.cmd-default-row>*:nth-child(8),
  .ep-row-grid.cmd-custom-row>*:nth-child(8) {
    display: none;
  }

  .custom-header {
    flex-wrap: wrap;
    gap: 8px;
  }

  .custom-header-left {
    flex-wrap: wrap;
    gap: 6px;
  }

  .sync-row {
    flex-wrap: wrap;
  }

  .new-cmd-input {
    width: 120px;
  }
}
</style>
