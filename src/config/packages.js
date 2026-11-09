// @ts-check
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import bundledCatalog from "../../config/packages.json" with { type: "json" };
import {
  defaultInviteEnv,
  defaultChannelEnv,
  isEnvKey,
  isValidPackageId,
  sanitizeImageUrl,
} from "../utils/validation.js";

export class PackageConfigError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "PackageConfigError";
  }
}

/**
 * @typedef {Object} PackageRecord
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} priceLabel
 * @property {number} priceStars      — integer Stars for sendInvoice
 * @property {boolean} active
 * @property {string} imageUrl
 * @property {string} inviteLinkEnv   — kept for backward compat (unused in new flow)
 * @property {string[]} channelEnvs   — env var names holding numeric channel IDs
 */

/**
 * @typedef {PackageRecord & { channelIds: string[] }} ResolvedPackage
 */

/**
 * @typedef {Object} SaveResult
 * @property {boolean} ok
 * @property {string} [message]
 */

/**
 * @typedef {Object} PackageRepository
 * @property {() => PackageRecord[]} load
 * @property {(packages: PackageRecord[]) => Promise<SaveResult>} save
 */

const MAX_PACKAGES = 30;

/** @param {unknown} value @param {number} max */
function clipText(value, max) {
  return String(value ?? "").replaceAll("\r", "").trim().slice(0, max);
}

/**
 * Parse priceStars — must be a positive integer.
 * Falls back to 0 (which means "not configured").
 * @param {unknown} value
 */
function parsePriceStars(value) {
  const n = parseInt(String(value ?? "0"), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * @param {unknown} source
 * @returns {PackageRecord[]}
 */
export function sanitizePackages(source) {
  if (!Array.isArray(source)) {
    throw new PackageConfigError("Package configuration must be an array or an object with a packages array");
  }

  /** @type {PackageRecord[]} */
  const packages = [];
  const seen = new Set();

  for (const item of source) {
    if (!item || typeof item !== "object") continue;
    const raw = /** @type {Record<string, unknown>} */ (item);
    const id = clipText(raw.id, 32).toLowerCase();
    if (!isValidPackageId(id) || seen.has(id)) continue;
    const name = clipText(raw.name, 80);
    if (!name) continue;

    // channelEnvs — array of env key names pointing to numeric channel IDs
    let channelEnvs = /** @type {string[]} */ ([]);
    if (Array.isArray(raw.channelEnvs)) {
      channelEnvs = raw.channelEnvs
        .map((v) => clipText(v, 81))
        .filter((v) => isEnvKey(v));
    }
    if (channelEnvs.length === 0) {
      channelEnvs = [defaultChannelEnv(id)];
    }

    const requestedEnv = clipText(raw.inviteLinkEnv, 81);

    packages.push({
      id,
      name,
      description: clipText(raw.description, 500),
      priceLabel: clipText(raw.priceLabel, 80),
      priceStars: parsePriceStars(raw.priceStars),
      active: raw.active === true,
      imageUrl: sanitizeImageUrl(raw.imageUrl),
      inviteLinkEnv: isEnvKey(requestedEnv) ? requestedEnv : defaultInviteEnv(id),
      channelEnvs,
    });
    seen.add(id);
    if (packages.length >= MAX_PACKAGES) break;
  }

  return packages;
}

/**
 * @param {unknown} source
 */
function extractPackageArray(source) {
  if (Array.isArray(source)) return source;
  if (source && typeof source === "object" && Array.isArray(/** @type {any} */ (source).packages)) {
    return /** @type {any} */ (source).packages;
  }
  throw new PackageConfigError("Package configuration must be an array or an object with a packages array");
}

/**
 * @param {PackageRecord} record
 * @param {NodeJS.ProcessEnv} env
 * @returns {ResolvedPackage}
 */
export function resolvePackage(record, env) {
  const channelIds = record.channelEnvs
    .map((envKey) => (env[envKey] ?? "").trim())
    .filter((v) => /^-?\d+$/.test(v));
  return { ...record, channelIds };
}

/**
 * @param {ResolvedPackage} pkg
 */
export function isPayable(pkg) {
  return pkg.active === true && pkg.priceStars > 0 && pkg.channelIds.length > 0;
}

/**
 * @param {PackageRecord} record
 * @param {NodeJS.ProcessEnv} env
 * @returns {"missing"|"invalid"|"configured"}
 */
export function channelStatus(record, env) {
  const ids = record.channelEnvs.map((k) => (env[k] ?? "").trim()).filter(Boolean);
  if (ids.length === 0) return "missing";
  return ids.every((id) => /^-?\d+$/.test(id)) ? "configured" : "invalid";
}

/**
 * @param {PackageRecord[]} packages
 * @returns {PackageRepository}
 */
export function createMemoryRepository(packages) {
  let current = sanitizePackages(packages);
  return {
    load() { return current.map((pkg) => ({ ...pkg })); },
    async save(next) {
      current = sanitizePackages(next);
      return { ok: true };
    },
  };
}

/**
 * @param {object} options
 * @param {NodeJS.ProcessEnv} options.env
 * @param {string} options.filePath
 * @param {unknown} options.bundled
 * @returns {PackageRepository}
 */
export function createFileRepository({ env, filePath, bundled }) {
  function readSource() {
    const override = env.PACKAGES_JSON;
    if (typeof override === "string" && override.trim()) {
      try { return { source: JSON.parse(override), fromEnv: true }; }
      catch { throw new PackageConfigError("PACKAGES_JSON is not valid JSON"); }
    }
    if (existsSync(filePath)) {
      try { return { source: JSON.parse(readFileSync(filePath, "utf8")), fromEnv: false }; }
      catch (error) {
        if (error instanceof SyntaxError) throw new PackageConfigError("config/packages.json is not valid JSON");
        throw error;
      }
    }
    return { source: bundled, fromEnv: false };
  }

  return {
    load() { return sanitizePackages(extractPackageArray(readSource().source)); },
    async save(packages) {
      const state = readSource();
      if (state.fromEnv) {
        return { ok: false, message: "Packages are loaded from PACKAGES_JSON. Update that env var." };
      }
      const clean = sanitizePackages(packages);
      try {
        writeFileSync(filePath, `${JSON.stringify({ packages: clean }, null, 2)}\n`, "utf8");
      } catch (error) {
        const code = /** @type {NodeJS.ErrnoException} */ (error).code;
        if (["EROFS","EPERM","EACCES","ENOENT"].includes(code ?? "")) {
          return { ok: false, message: "Cannot write on this host. Edit config/packages.json and redeploy." };
        }
        return { ok: false, message: "The package list could not be saved." };
      }
      return { ok: true };
    },
  };
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {PackageRepository}
 */
export function createDefaultRepository(env = process.env) {
  return createFileRepository({
    env,
    filePath: path.join(process.cwd(), "config", "packages.json"),
    bundled: bundledCatalog,
  });
}

// Keep old export name for backward compat
export { channelStatus as inviteStatus };

/**
 * @param {PackageRecord[]} _packages
 * @param {NodeJS.ProcessEnv} _env
 * @param {string} _id
 */
export function packagesSharingInvite(_packages, _env, _id) { return []; }
