import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir, platform, arch, release, type } from "os";
import { dirname, join } from "path";

import { DURATIONS } from "../constants";
import type { ParagraphUsage } from "../paragraphs";

const APP_NAME = "ntypo";
const SCHEMA_VERSION = 1;
const DURATION_KEYS = DURATIONS.map((duration) => String(duration));

type BestWpmByDuration = Record<string, number>;

type UserStats = {
  bestOverallWpm: number;
  bestWpmByDuration: BestWpmByDuration;
  lastWpm: number | null;
  lastAccuracy: number | null;
  lastErrors: number | null;
  lastDurationSec: number | null;
};

export type UserConfig = {
  schemaVersion: number;
  userId: string;
  createdAt: string;
  lastOpenedAt: string;
  metadata: {
    platform: string;
    os: string;
    arch: string;
    release: string;
  };
  stats: UserStats;
  paragraphs: {
    usedIds: number[];
  };
};

export type ResultSnapshot = {
  wpm: number;
  accuracy: number;
  errors: number;
  durationSec: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeBestWpmByDuration(value: unknown): BestWpmByDuration {
  const normalized: BestWpmByDuration = {};
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (typeof entry === "number") {
        normalized[key] = entry;
      }
    }
  }
  for (const key of DURATION_KEYS) {
    if (typeof normalized[key] !== "number") {
      normalized[key] = 0;
    }
  }
  return normalized;
}

function buildDefaultStats(): UserStats {
  return {
    bestOverallWpm: 0,
    bestWpmByDuration: normalizeBestWpmByDuration({}),
    lastWpm: null,
    lastAccuracy: null,
    lastErrors: null,
    lastDurationSec: null,
  };
}

function getConfigDir(): string {
  const home = homedir();
  if (process.platform === "win32") {
    const base =
      process.env.APPDATA ??
      process.env.LOCALAPPDATA ??
      join(home, "AppData", "Roaming");
    return join(base, APP_NAME);
  }
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", APP_NAME);
  }
  const xdg = process.env.XDG_CONFIG_HOME ?? join(home, ".config");
  return join(xdg, APP_NAME);
}

function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

function buildDefaultConfig(): UserConfig {
  const createdAt = nowIso();
  return {
    schemaVersion: SCHEMA_VERSION,
    userId: randomUUID(),
    createdAt,
    lastOpenedAt: createdAt,
    metadata: {
      platform: platform(),
      os: type(),
      arch: arch(),
      release: release(),
    },
    stats: buildDefaultStats(),
    paragraphs: {
      usedIds: [],
    },
  };
}

function readConfig(path: string): UserConfig | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as UserConfig;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (!parsed.userId || typeof parsed.userId !== "string") {
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn("Failed to read config.json:", error);
    return null;
  }
}

function migrateConfig(parsed: UserConfig | null): UserConfig {
  if (!parsed) {
    return buildDefaultConfig();
  }

  const metadataDefaults = {
    platform: platform(),
    os: type(),
    arch: arch(),
    release: release(),
  };

  const rawStats = (parsed as { stats?: Record<string, unknown> }).stats;
  const legacyBestWpm =
    typeof rawStats?.bestWpm === "number" ? rawStats.bestWpm : 0;
  const bestOverallWpm =
    typeof rawStats?.bestOverallWpm === "number"
      ? rawStats.bestOverallWpm
      : legacyBestWpm;
  const bestWpmByDuration = normalizeBestWpmByDuration(
    rawStats?.bestWpmByDuration,
  );

  const lastWpm =
    typeof rawStats?.lastWpm === "number" ? rawStats.lastWpm : null;
  const lastAccuracy =
    typeof rawStats?.lastAccuracy === "number" ? rawStats.lastAccuracy : null;
  const lastErrors =
    typeof rawStats?.lastErrors === "number" ? rawStats.lastErrors : null;
  const lastDurationSec =
    typeof rawStats?.lastDurationSec === "number"
      ? rawStats.lastDurationSec
      : null;

  const rawMetadata = parsed.metadata as Record<string, unknown> | undefined;
  const metadata = {
    platform:
      typeof rawMetadata?.platform === "string"
        ? rawMetadata.platform
        : metadataDefaults.platform,
    os:
      typeof rawMetadata?.os === "string"
        ? rawMetadata.os
        : metadataDefaults.os,
    arch:
      typeof rawMetadata?.arch === "string"
        ? rawMetadata.arch
        : metadataDefaults.arch,
    release:
      typeof rawMetadata?.release === "string"
        ? rawMetadata.release
        : metadataDefaults.release,
  };

  const usedIds = Array.isArray(parsed.paragraphs?.usedIds)
    ? parsed.paragraphs.usedIds.filter((id) => typeof id === "number")
    : [];

  return {
    schemaVersion: SCHEMA_VERSION,
    userId: parsed.userId,
    createdAt:
      typeof parsed.createdAt === "string" ? parsed.createdAt : nowIso(),
    lastOpenedAt:
      typeof parsed.lastOpenedAt === "string" ? parsed.lastOpenedAt : nowIso(),
    metadata,
    stats: {
      bestOverallWpm,
      bestWpmByDuration,
      lastWpm,
      lastAccuracy,
      lastErrors,
      lastDurationSec,
    },
    paragraphs: {
      usedIds,
    },
  };
}

export class UserConfigStore {
  private configPath: string;
  private data: UserConfig;
  private usedIds: Set<number>;

  constructor() {
    this.configPath = getConfigPath();
    this.data = migrateConfig(readConfig(this.configPath));
    this.usedIds = new Set(this.data.paragraphs.usedIds ?? []);
    this.data.paragraphs.usedIds = Array.from(this.usedIds);
    this.data.lastOpenedAt = nowIso();
    this.ensureDir();
    this.save();
  }

  getConfigPath(): string {
    return this.configPath;
  }

  getUserId(): string {
    return this.data.userId;
  }

  getBestWpm(durationSec?: number): number {
    if (typeof durationSec === "number") {
      const key = String(durationSec);
      return this.data.stats.bestWpmByDuration[key] ?? 0;
    }
    return this.data.stats.bestOverallWpm;
  }

  getUsedParagraphIds(): Set<number> {
    return this.usedIds;
  }

  getParagraphUsage(): ParagraphUsage {
    return {
      usedIds: this.usedIds,
      markUsedIds: (ids: number[]) => this.markParagraphsUsed(ids),
      resetUsedIds: () => this.resetUsedParagraphs(),
      replaceUsedIds: (ids: number[]) => this.replaceUsedParagraphIds(ids),
    };
  }

  markParagraphsUsed(ids: number[]): void {
    if (ids.length === 0) {
      return;
    }
    let changed = false;
    for (const id of ids) {
      if (!this.usedIds.has(id)) {
        this.usedIds.add(id);
        changed = true;
      }
    }
    if (changed) {
      this.save();
    }
  }

  replaceUsedParagraphIds(ids: number[]): void {
    this.usedIds.clear();
    for (const id of ids) {
      this.usedIds.add(id);
    }
    this.save();
  }

  resetUsedParagraphs(): void {
    if (this.usedIds.size === 0) {
      return;
    }
    this.usedIds.clear();
    this.save();
  }

  recordResult(result: ResultSnapshot): number {
    let changed = false;
    this.data.stats.lastWpm = result.wpm;
    this.data.stats.lastAccuracy = result.accuracy;
    this.data.stats.lastErrors = result.errors;
    this.data.stats.lastDurationSec = result.durationSec;
    changed = true;
    const durationKey = String(result.durationSec);
    const bestForDuration = this.data.stats.bestWpmByDuration[durationKey] ?? 0;
    if (result.wpm > bestForDuration) {
      this.data.stats.bestWpmByDuration[durationKey] = result.wpm;
      changed = true;
    }
    if (result.wpm > this.data.stats.bestOverallWpm) {
      this.data.stats.bestOverallWpm = result.wpm;
      changed = true;
    }
    if (changed) {
      this.save();
    }
    return this.data.stats.bestOverallWpm;
  }

  private ensureDir(): void {
    const dir = dirname(this.configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private save(): void {
    try {
      this.data.paragraphs.usedIds = Array.from(this.usedIds).sort(
        (a, b) => a - b,
      );
      writeFileSync(
        this.configPath,
        JSON.stringify(this.data, null, 2),
        "utf-8",
      );
    } catch (error) {
      console.warn("Failed to write config.json:", error);
    }
  }
}
