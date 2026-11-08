// @ts-check
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizePackages,
  resolvePackage,
  isPayable,
  inviteStatus,
  packagesSharingInvite,
  createMemoryRepository,
  PackageConfigError,
} from "../src/config/packages.js";
import { defaultInviteEnv, isValidPackageId } from "../src/utils/validation.js";

// ---------------------------------------------------------------------------
// isValidPackageId
// ---------------------------------------------------------------------------
describe("isValidPackageId", () => {
  it("accepts lowercase ids", () => assert.ok(isValidPackageId("basic")));
  it("accepts ids with hyphens and underscores", () => assert.ok(isValidPackageId("vip-access_1")));
  it("rejects empty string", () => assert.ok(!isValidPackageId("")));
  it("rejects ids starting with a hyphen", () => assert.ok(!isValidPackageId("-bad")));
  it("rejects ids with uppercase", () => assert.ok(!isValidPackageId("Premium")));
  it("rejects ids longer than 32 chars", () => assert.ok(!isValidPackageId("a".repeat(33))));
});

// ---------------------------------------------------------------------------
// defaultInviteEnv
// ---------------------------------------------------------------------------
describe("defaultInviteEnv", () => {
  it("converts id to env key", () => assert.equal(defaultInviteEnv("basic"), "PACKAGE_BASIC_INVITE_LINK"));
  it("replaces hyphens with underscores", () => assert.equal(defaultInviteEnv("vip-gold"), "PACKAGE_VIP_GOLD_INVITE_LINK"));
});

// ---------------------------------------------------------------------------
// sanitizePackages
// ---------------------------------------------------------------------------
describe("sanitizePackages", () => {
  it("accepts a valid array", () => {
    const result = sanitizePackages([{ id: "basic", name: "Basic", active: true }]);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "basic");
  });

  it("throws PackageConfigError on non-array input", () => {
    assert.throws(() => sanitizePackages("not an array"), PackageConfigError);
  });

  it("skips entries without valid ids", () => {
    // "BAD" gets lowercased to "bad" which is valid, so 2 packages survive.
    // Only truly invalid ids (empty, starts with -, contains spaces) are dropped.
    const result = sanitizePackages([
      { id: "ok", name: "Ok" },
      { id: "BAD", name: "Bad" },       // lowercased to "bad" — kept
      { id: "", name: "Empty" },         // empty — dropped
      { id: "-nope", name: "Nope" },    // starts with hyphen — dropped
      { id: "has space", name: "Sp" },  // contains space — dropped
    ]);
    assert.equal(result.length, 2); // "ok" and "bad"
    assert.equal(result[1].id, "bad");
  });

  it("skips duplicate ids", () => {
    const result = sanitizePackages([
      { id: "basic", name: "First" },
      { id: "basic", name: "Duplicate" },
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "First");
  });

  it("skips entries without a name", () => {
    const result = sanitizePackages([{ id: "noname", name: "" }]);
    assert.equal(result.length, 0);
  });

  it("assigns a default inviteLinkEnv when missing", () => {
    const [pkg] = sanitizePackages([{ id: "premium", name: "Premium" }]);
    assert.equal(pkg.inviteLinkEnv, "PACKAGE_PREMIUM_INVITE_LINK");
  });

  it("respects a custom inviteLinkEnv when valid", () => {
    const [pkg] = sanitizePackages([{ id: "pro", name: "Pro", inviteLinkEnv: "MY_CUSTOM_ENV" }]);
    assert.equal(pkg.inviteLinkEnv, "MY_CUSTOM_ENV");
  });

  it("falls back to default inviteLinkEnv when custom value is not a valid env key", () => {
    const [pkg] = sanitizePackages([{ id: "pro", name: "Pro", inviteLinkEnv: "bad key!" }]);
    assert.equal(pkg.inviteLinkEnv, "PACKAGE_PRO_INVITE_LINK");
  });

  it("caps at 30 packages", () => {
    const items = Array.from({ length: 35 }, (_, i) => ({ id: `pkg${i}`, name: `Pkg ${i}` }));
    const result = sanitizePackages(items);
    assert.equal(result.length, 30);
  });
});

// ---------------------------------------------------------------------------
// resolvePackage
// ---------------------------------------------------------------------------
describe("resolvePackage", () => {
  /** @type {import("../src/config/packages.js").PackageRecord} */
  const record = {
    id: "basic",
    name: "Basic",
    description: "desc",
    priceLabel: "100 Stars",
    active: true,
    imageUrl: "",
    inviteLinkEnv: "PACKAGE_BASIC_INVITE_LINK",
  };

  it("resolves a valid invite link", () => {
    const env = { PACKAGE_BASIC_INVITE_LINK: "https://t.me/+abc123" };
    const pkg = resolvePackage(record, env);
    assert.equal(pkg.inviteLink, "https://t.me/+abc123");
  });

  it("resolves to null when the env var is missing", () => {
    const pkg = resolvePackage(record, {});
    assert.equal(pkg.inviteLink, null);
  });

  it("resolves to null when the link is not a valid t.me URL", () => {
    const env = { PACKAGE_BASIC_INVITE_LINK: "https://example.com/bad" };
    const pkg = resolvePackage(record, env);
    assert.equal(pkg.inviteLink, null);
  });
});

// ---------------------------------------------------------------------------
// isPayable
// ---------------------------------------------------------------------------
describe("isPayable", () => {
  it("returns true for an active package with a valid invite link", () => {
    const pkg = { id: "basic", name: "Basic", description: "", priceLabel: "", active: true, imageUrl: "", inviteLinkEnv: "X", inviteLink: "https://t.me/+abc" };
    assert.ok(isPayable(pkg));
  });

  it("returns false when inactive", () => {
    const pkg = { id: "basic", name: "Basic", description: "", priceLabel: "", active: false, imageUrl: "", inviteLinkEnv: "X", inviteLink: "https://t.me/+abc" };
    assert.ok(!isPayable(pkg));
  });

  it("returns false when invite link is null", () => {
    const pkg = { id: "basic", name: "Basic", description: "", priceLabel: "", active: true, imageUrl: "", inviteLinkEnv: "X", inviteLink: null };
    assert.ok(!isPayable(pkg));
  });
});

// ---------------------------------------------------------------------------
// inviteStatus
// ---------------------------------------------------------------------------
describe("inviteStatus", () => {
  /** @type {import("../src/config/packages.js").PackageRecord} */
  const record = { id: "vip", name: "VIP", description: "", priceLabel: "", active: true, imageUrl: "", inviteLinkEnv: "PACKAGE_VIP_INVITE_LINK" };

  it("returns configured for a valid link", () => {
    assert.equal(inviteStatus(record, { PACKAGE_VIP_INVITE_LINK: "https://t.me/+xyz" }), "configured");
  });

  it("returns missing when env var is absent", () => {
    assert.equal(inviteStatus(record, {}), "missing");
  });

  it("returns invalid when the link does not pass validation", () => {
    assert.equal(inviteStatus(record, { PACKAGE_VIP_INVITE_LINK: "not-a-link" }), "invalid");
  });
});

// ---------------------------------------------------------------------------
// packagesSharingInvite
// ---------------------------------------------------------------------------
describe("packagesSharingInvite", () => {
  const records = [
    { id: "a", name: "A", description: "", priceLabel: "", active: true, imageUrl: "", inviteLinkEnv: "LINK_A" },
    { id: "b", name: "B", description: "", priceLabel: "", active: true, imageUrl: "", inviteLinkEnv: "LINK_B" },
    { id: "c", name: "C", description: "", priceLabel: "", active: true, imageUrl: "", inviteLinkEnv: "LINK_C" },
  ];
  const env = { LINK_A: "https://t.me/+shared", LINK_B: "https://t.me/+shared", LINK_C: "https://t.me/+unique" };

  it("finds packages sharing the same invite link", () => {
    const result = packagesSharingInvite(records, env, "a");
    assert.deepEqual(result, ["b"]);
  });

  it("returns empty when the invite is unique", () => {
    const result = packagesSharingInvite(records, env, "c");
    assert.deepEqual(result, []);
  });

  it("returns empty for an unknown id", () => {
    const result = packagesSharingInvite(records, env, "unknown");
    assert.deepEqual(result, []);
  });
});

// ---------------------------------------------------------------------------
// createMemoryRepository
// ---------------------------------------------------------------------------
describe("createMemoryRepository", () => {
  it("loads packages", () => {
    const repo = createMemoryRepository([{ id: "basic", name: "Basic" }]);
    const loaded = repo.load();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].id, "basic");
  });

  it("saves and reloads packages", async () => {
    const repo = createMemoryRepository([{ id: "basic", name: "Basic" }]);
    const result = await repo.save([{ id: "premium", name: "Premium", active: true }]);
    assert.ok(result.ok);
    const loaded = repo.load();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].id, "premium");
  });

  it("returns copies, not references", () => {
    const repo = createMemoryRepository([{ id: "basic", name: "Basic", active: true }]);
    const loaded = repo.load();
    loaded[0].name = "Mutated";
    assert.equal(repo.load()[0].name, "Basic");
  });
});
