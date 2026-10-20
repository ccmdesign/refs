export type RefAuto = {
  tags?: string[];
  description?: string;
  model?: string;
  at?: string;
};

export type RefData = {
  id: string;
  /** Absent on images and links. */
  kind?: "video";
  file?: string;
  /** Video refs only: one frame as a JPEG, relative to the library. */
  poster?: string;
  /** Video refs only, in seconds. */
  duration?: number;
  url?: string;
  title?: string;
  source?: string;
  note?: string;
  tags?: string[];
  auto?: RefAuto;
  width?: number;
  height?: number;
  added?: string;
};

export type BoardRefEntry = {
  id: string;
  note?: string;
  key?: boolean;
  added: string;
};

export type BoardData = {
  brief?: string;
  refs: BoardRefEntry[];
};

export type ParentBriefEntry = {
  board: string;
  brief: string;
};

export type OutputRefEntry = {
  id: string;
  type?: "video";
  file?: string;
  poster?: string;
  duration?: number;
  url?: string;
  key?: boolean;
  note?: string;
  board_note?: string;
  tags?: string[];
  machine_tags?: string[];
  description?: string;
  source?: string;
};

export type OutputRefsYaml = {
  board: string;
  brief?: string;
  /** Root board brief first, nearest parent last */
  parent_briefs?: ParentBriefEntry[];
  refs: OutputRefEntry[];
};

export const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "avif",
  "svg",
]);

export const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v"]);
