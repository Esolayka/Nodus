import { create } from "zustand";
import { persist } from "zustand/middleware";
import { detectLanguage, type SupportedLanguage } from "../i18n";
import type { CustomTheme } from "../theme/customThemes";

export type ThemePreference = "light" | "dark" | "system";

export type SyncMechanism = "none" | "git" | "server" | "cloud";
export type GitAutocommit = "off" | "manual" | "scheduled";
export type ServerAutoSync = "off" | "manual" | "scheduled";
export type TelegramPlacement = "local" | "server";

export interface GraphColors {
  /** Empty string means "use the theme default". */
  background: string;
  link: string;
  node: string;
  accent: string;
}

export interface GraphGroup {
  id: string;
  query: string;
  color: string;
}

export interface AppSettings {
  theme: ThemePreference;
  general: {
    reopenLastVault: boolean;
    confirmFileDeletion: boolean;
    openLinksInNewTab: boolean;
  };
  appearance: {
    activeCustomThemeId: string | null;
    customThemes: CustomTheme[];
    interfaceFont: string;
    monospaceFont: string;
  };
  language: SupportedLanguage;
  editor: {
    fontSize: number;
  };
  graph: {
    showLabels: boolean;
    showArrows: boolean;
    showTags: boolean;
    showAttachments: boolean;
    existingFilesOnly: boolean;
    showOrphans: boolean;
    textFadeThreshold: number;
    nodeSize: number;
    linkThickness: number;
    centerStrength: number;
    linkDistance: number;
    repulsion: number;
    linkStrength: number;
    localDepth: number;
    groups: GraphGroup[];
    colors: GraphColors;
  };
  /** User overrides only, commandId -> normalized key combo; anything not
   * present here falls back to the built-in default binding. */
  hotkeys: Record<string, string>;
  dailyNotes: {
    /** Vault-relative folder daily notes live in; "" means the vault root. */
    folder: string;
    /** Moment-style tokens (`YYYY`, `MM`, `DD`, ...); see `lib/dateFormat.ts`. */
    filenameFormat: string;
    /** Vault-relative path to a template file, or "" for a blank note. */
    templatePath: string;
    openOnStartup: boolean;
  };
  templates: {
    /** Vault-relative folder templates live in. */
    folder: string;
  };
  tasks: {
    /** Append a `✅ <today>` completion date when a task is checked off. */
    autoCompletionDate: boolean;
  };
  history: {
    enabled: boolean;
    maxVersionsPerNote: number;
    maxAgeDays: number;
    maxTotalSizeMb: number;
  };
  attachments: {
    /** "vaultFolder": a single fixed folder under the vault root (default
     * `assets`). "nextToNote": dropped right beside whichever note it was
     * added to. "subfolder": a named subfolder inside the note's own
     * folder. */
    mode: "vaultFolder" | "nextToNote" | "subfolder";
    vaultFolderName: string;
    subfolderName: string;
    loadExternalImages: boolean;
  };
  sync: {
    mechanism: SyncMechanism;
    git: {
      remoteName: string;
      remoteUrl: string;
      branch: string;
      authorName: string;
      authorEmail: string;
      autocommit: GitAutocommit;
      autocommitIntervalMinutes: number;
      autopullOnStartup: boolean;
      /** `%date%` is substituted with the current date/time. */
      commitMessageTemplate: string;
    };
    server: {
      /** Address of a `nodus-sync-server` instance, e.g. `https://sync.example.com`. */
      baseUrl: string;
      /** Device token from pairing. Kept in memory only so renderer storage
       * never contains a reusable credential. */
      token: string;
      deviceName: string;
      autoSync: ServerAutoSync;
      autoSyncIntervalMinutes: number;
    };
  };
  telegram: {
    enabled: boolean;
    /** "local": this app itself serves the Mini App through a tunnel while
     * it's running. "server": a `nodus-sync-server` instance (started with
     * its own `--telegram-bot-token`) serves it instead, around the clock —
     * nothing here to configure beyond picking this mode. */
    placement: TelegramPlacement;
    /** Only meaningful for "local" placement. Kept in memory only. */
    botToken: string;
    /** Fallback address for the Mini App to reach this device at, if the
     * automatic tunnel or discovery service isn't available. */
    manualAddress: string;
  };
  plugins: {
    /** Overrides a plugin's own `defaultEnabled` once the user has touched
     * its toggle; a plugin id absent here just uses its default. */
    enabled: Record<string, boolean>;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  general: {
    reopenLastVault: true,
    confirmFileDeletion: true,
    openLinksInNewTab: false,
  },
  appearance: {
    activeCustomThemeId: null,
    customThemes: [],
    interfaceFont: "",
    monospaceFont: "",
  },
  language: detectLanguage(),
  editor: {
    fontSize: 16,
  },
  graph: {
    showLabels: true,
    showArrows: false,
    showTags: false,
    showAttachments: false,
    existingFilesOnly: false,
    showOrphans: true,
    textFadeThreshold: 0,
    nodeSize: 1,
    linkThickness: 1,
    centerStrength: 0.52,
    linkDistance: 250,
    repulsion: 10,
    linkStrength: 1,
    localDepth: 1,
    groups: [],
    colors: {
      background: "",
      link: "",
      node: "",
      accent: "#7a52cc",
    },
  },
  hotkeys: {},
  dailyNotes: {
    folder: "Daily Notes",
    filenameFormat: "YYYY-MM-DD",
    templatePath: "",
    openOnStartup: false,
  },
  templates: {
    folder: "Templates",
  },
  tasks: {
    autoCompletionDate: true,
  },
  history: {
    enabled: true,
    maxVersionsPerNote: 50,
    maxAgeDays: 90,
    maxTotalSizeMb: 100,
  },
  attachments: {
    mode: "vaultFolder",
    vaultFolderName: "assets",
    subfolderName: "attachments",
    loadExternalImages: true,
  },
  sync: {
    mechanism: "none",
    git: {
      remoteName: "origin",
      remoteUrl: "",
      branch: "main",
      authorName: "",
      authorEmail: "",
      autocommit: "manual",
      autocommitIntervalMinutes: 30,
      autopullOnStartup: false,
      commitMessageTemplate: "Nodus sync: %date%",
    },
    server: {
      baseUrl: "",
      token: "",
      deviceName: "",
      autoSync: "manual",
      autoSyncIntervalMinutes: 15,
    },
  },
  telegram: {
    enabled: false,
    placement: "local",
    botToken: "",
    manualAddress: "",
  },
  plugins: {
    enabled: {},
  },
};

interface SettingsState {
  settings: AppSettings;
  setSettings: (partial: Partial<AppSettings>) => void;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A settings blob persisted before some later stage added a new field
 * (a whole section, like `telegram`, or a field inside an existing one)
 * must not leave that field `undefined` after rehydration — zustand's
 * default merge only replaces `settings` as a whole, so anything the old
 * blob didn't have would otherwise stay missing forever and crash the
 * first read. Recursively fills every gap from `DEFAULT_SETTINGS` instead. */
function deepMerge<T>(base: T, incoming: unknown): T {
  if (incoming === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(incoming)) {
    return incoming as T;
  }
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(incoming)) {
    result[key] = deepMerge((base as Record<string, unknown>)[key], incoming[key]);
  }
  return result as T;
}

/** Credentials must never be serialized into the WebView's localStorage.
 * This also strips values left by versions that persisted the whole store. */
function withoutPersistedCredentials(settings: AppSettings): AppSettings {
  return {
    ...settings,
    sync: {
      ...settings.sync,
      server: { ...settings.sync.server, token: "" },
    },
    telegram: { ...settings.telegram, botToken: "" },
  };
}

function sanitizePersistedState(persisted: unknown): unknown {
  if (!isPlainObject(persisted) || !isPlainObject(persisted.settings)) return persisted;
  const settings = deepMerge(DEFAULT_SETTINGS, persisted.settings);
  return { ...persisted, settings: withoutPersistedCredentials(settings) };
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      setSettings: (partial) =>
        set((s) => ({ settings: { ...s.settings, ...partial } })),
    }),
    {
      name: "nodus:settings",
      version: 3,
      migrate: (persisted, version) => {
        let migrated = persisted;
        if (version < 2 && isPlainObject(persisted)) {
          const settings = persisted.settings;
          if (isPlainObject(settings) && isPlainObject(settings.graph)) {
            const graph = settings.graph;
            const oldNodeSize = typeof graph.nodeSize === "number" ? graph.nodeSize : 6;
            const oldLinkDistance = typeof graph.linkDistance === "number" ? graph.linkDistance : 45;
            migrated = {
              ...persisted,
              settings: {
                ...settings,
                graph: {
                  ...graph,
                  nodeSize: Math.min(5, Math.max(0.1, oldNodeSize / 6)),
                  linkDistance: Math.min(500, Math.max(30, oldLinkDistance * (250 / 45))),
                  repulsion: 10,
                },
              },
            };
          }
        }
        return sanitizePersistedState(migrated);
      },
      partialize: (s) => ({ settings: withoutPersistedCredentials(s.settings) }),
      merge: (persisted, current) => ({
        ...current,
        settings: deepMerge(
          current.settings,
          (sanitizePersistedState(persisted) as Partial<SettingsState> | undefined)?.settings,
        ),
      }),
    },
  ),
);

export function useSetting<T>(selector: (settings: AppSettings) => T): T {
  return useSettingsStore((s) => selector(s.settings));
}
