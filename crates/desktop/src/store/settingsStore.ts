import { create } from "zustand";
import { persist } from "zustand/middleware";
import { detectLanguage, type SupportedLanguage } from "../i18n";

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

export interface AppSettings {
  theme: ThemePreference;
  language: SupportedLanguage;
  editor: {
    fontSize: number;
  };
  graph: {
    showLabels: boolean;
    nodeSize: number;
    linkDistance: number;
    repulsion: number;
    localDepth: number;
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
      /** Device token from pairing. Persisted like any other sync-client
       * credential our own server issues — unlike a third-party Git PAT,
       * losing it just means re-pairing this one device. */
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
    /** Only meaningful for "local" placement. Persisted — the local HTTP
     * server needs it to verify every linking attempt, session to session,
     * the same way a self-hosted server's own bot-token flag would. */
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
  language: detectLanguage(),
  editor: {
    fontSize: 16,
  },
  graph: {
    showLabels: true,
    nodeSize: 6,
    linkDistance: 45,
    repulsion: 1000,
    localDepth: 2,
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

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      setSettings: (partial) =>
        set((s) => ({ settings: { ...s.settings, ...partial } })),
    }),
    {
      name: "nodus:settings",
      version: 1,
      partialize: (s) => ({ settings: s.settings }),
      merge: (persisted, current) => ({
        ...current,
        settings: deepMerge(current.settings, (persisted as Partial<SettingsState> | undefined)?.settings),
      }),
    },
  ),
);

export function useSetting<T>(selector: (settings: AppSettings) => T): T {
  return useSettingsStore((s) => selector(s.settings));
}
