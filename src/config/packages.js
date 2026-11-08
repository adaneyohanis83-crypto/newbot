// @ts-check
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import bundledCatalog from "../../config/packages.json" with { type: "json" };
import {
  defaultInviteEnv,
  isEnvKey,
  isPaidInviteLink,
  isValidPackageId,
  sanitizeImageUrl,
} from "../utils/validation.js";

export class PackageConfigError extends Error {
  /**
   * @param {string} message
   */
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
 * @property {boolean} active
 * @property {string} imageUrl
 * @property {string} inviteLinkEnv
 */

/**
 * @typedef {PackageRecord & { inviteLink: string | null }} ResolvedPackage
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

/**
 * @param {unknown} value
 * @param {number} max
 */
function clipText(value, max) {
  return String(value ?? "").replaceAll("\r", "").trim().slice(0, max);
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

    const requestedEnv = clipText(raw.inviteLinkEnv, 81);
    packages.push({
      id,
      name,
      description: clipText(raw.description, 500),
      priceLabel: clipText(raw.priceLabel, 80),
      active: raw.active === true,
      imageUrl: sanitizeImageUrl(raw.imageUrl),
      inviteLinkEnv: isEnvKey(requestedEnv) ? requestedEnv : defaultInviteEnv(id),
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
  if (source && typeof source === "object" && Array.isArray(/** @type {{ packages?: unknown }} */ (source).packages)) {
    return /** @type {{ packages: unknown[] }} */ (source).packages;
  }
  throw new PackageConfigError("Package configuration must be an array or an object with a packages array");
}

/**
 * @param {PackageRecord} record
 * @param {NodeJS.ProcessEnv} env
 * @returns {ResolvedPackage}
 */
export function resolvePackage(record, env) {
  const raw = env[record.inviteLinkEnv];
  const inviteLink = isPaidInviteLink(raw) ? raw.trim() : null;
  return { ...record, inviteLink };
}

/**
 * @param {ResolvedPackage} pkg
 */
export function isPayable(pkg) {
  return pkg.active === true && isPaidInviteLink(pkg.inviteLink);
}

/**
 * @param {PackageRecord} record
 * @param {NodeJS.ProcessEnv} env
 * @returns {"missing" | "invalid" | "configured"}
 */
export function inviteStatus(record, env) {
  const raw = env[record.inviteLinkEnv];
  if (typeof raw !== "string" || raw.trim() === "") return "missing";
  return isPaidInviteLink(raw) ? "configured" : "invalid";
}

/**
 * @param {PackageRecord[]} packages
 * @param {NodeJS.ProcessEnv} env
 * @param {string} id
 */
export function packagesSharingInvite(packages, env, id) {
  const current = packages.find((pkg) => pkg.id === id);
  if (!current) return [];
  const raw = env[current.inviteLinkEnv];
  if (!isPaidInviteLink(raw)) return [];
  const normalized = raw.trim();
  return packages
    .filter((pkg) => pkg.id !== id && isPaidInviteLink(env[pkg.inviteLinkEnv]) && env[pkg.inviteLinkEnv]?.trim() === normalized)
    .map((pkg) => pkg.id);
}

/**
 * @param {PackageRecord[]} packages
 * @returns {PackageRepository}
 */
export function createMemoryRepository(packages) {
  let current = sanitizePackages(packages);
  return {
    load() {
      return current.map((pkg) => ({ ...pkg }));
    },
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
      try {
        return { source: JSON.parse(override), fromEnv: true };
      } catch {
        throw new PackageConfigError("PACKAGES_JSON is not valid JSON");
      }
    }

    if (existsSync(filePath)) {
      try {
        return { source: JSON.parse(readFileSync(filePath, "utf8")), fromEnv: false };
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new PackageConfigError("config/packages.json is not valid JSON");
        }
        throw error;
      }
    }

    return { source: bundled, fromEnv: false };
  }

  return {
    load() {
      return sanitizePackages(extractPackageArray(readSource().source));
    },
    async save(packages) {
      const state = readSource();
      if (state.fromEnv) {
        return {
          ok: false,
          message: "Packages are currently loaded from PACKAGES_JSON. Update that environment variable to change them.",
        };
      }

      const clean = sanitizePackages(packages);
      try {
        writeFileSync(filePath, `${JSON.stringify({ packages: clean }, null, 2)}\n`, "utf8");
      } catch (error) {
        const code = /** @type {NodeJS.ErrnoException} */ (error).code;
        if (code === "EROFS" || code === "EPERM" || code === "EACCES" || code === "ENOENT") {
          return {
            ok: false,
            message: "This host cannot store package edits on disk. Edit config/packages.json and redeploy, or set PACKAGES_JSON.",
          };
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
