// Ambient declarations for markdown-it plugins that ship no types.
declare module "markdown-it-emoji" {
  import type { PluginSimple } from "markdown-it";
  export const full: PluginSimple;
  export const light: PluginSimple;
  export const bare: PluginSimple;
}

declare module "markdown-it-footnote" {
  import type { PluginSimple } from "markdown-it";
  const footnote: PluginSimple;
  export default footnote;
}

declare module "markdown-it-task-lists" {
  import type { PluginWithOptions } from "markdown-it";
  const taskLists: PluginWithOptions<{ enabled?: boolean; label?: boolean; labelAfter?: boolean }>;
  export default taskLists;
}
