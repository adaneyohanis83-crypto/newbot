// @ts-check
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizePackages,
  resolvePackage,
  isPayable,
  channelStatus,
  packagesSharingInvite,
  createMemoryRepository,
  PackageConfigError,
} from "../src/config/packages.js";
import { defaultInviteEnv, defaultChannelEnv, isValidPackageId } from "../src/utils/validation.js";

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
// defaultInviteEnv / defaultChannelEnv
// ---------------------------------------------------------------------------
describe("defaultInviteEnv", () => {
  it("converts id to env key", () => assert.equal(defaultInviteEnv("basic"), "PACKAGE_BASIC_INVITE_LINK"));
  it("replaces hyphens with underscores", () => assert.equal(defaultInviteEnv("vip-gold"), "PACKAGE_VIP_GOLD_INVITE_LINK"));
});

describe("defaultChannelEnv", () => {
  it("converts id to channel env key", () => assert.equal(defaultChannelEnv("btn1"), "PACKAGE_BTN1_CHANNEL_ID"));
  it("replaces hyphens", () => assert.equal(defaultChannelEnv("my-pkg"), "PACKAGE_MY_PKG_CHANNEL_ID"));
});

// ---------------------------------------------------------------------------
// sanitizePackages
// ---------------------------------------------------------------------------
describe("sanitizePackages", () => {
  it("accepts a valid array", () => {
    const result = sanitizePackages([{ id: "basic", name: "Basic", active: true, priceStars: 2000 }]);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "basic");
    assert.equal(result[0].priceStars, 2000);
  });

  it("throws PackageConfigError on non-array input", () => {
    assert.throws(() => sanitizePackages("not an array"), PackageConfigError);
  });

  it("skips entries without valid ids", () => {
    const result = sanitizePackages([
      { id: "ok", name: "Ok" },
      { id: "BAD", name: "Bad" },
      { id: "", name: "Empty" },
      { id: "-nope", name: "Nope" },
      { id: "has space", name: "Sp" },
    ]);
    assert.equal(result.length, 2);
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

  it("assigns default channelEnvs when missing", () => {
    const [pkg] = sanitizePackages([{ id: "btn1", name: "Btn1" }]);
    assert.deepEqual(pkg.channelEnvs, ["PACKAGE_BTN1_CHANNEL_ID"]);
  });

  it("respects custom channelEnvs when valid", () => {
    const [pkg] = sanitizePackages([{ id: "pro", name: "Pro", channelEnvs: ["MY_CHANNEL_ENV"] }]);
    assert.deepEqual(pkg.channelEnvs, ["MY_CHANNEL_ENV"]);
  });

  it("caps at 30 packages", () => {
    const items = Array.from({ length: 35 }, (_, i) => ({ id: `pkg${i}`, name: `Pkg ${i}` }));
    assert.equal(sanitizePackages(items).length, 30);
  });

  it("priceStars defaults to 0 for missing/invalid value", () => {
    const [pkg] = sanitizePackages([{ id: "free", name: "Free" }]);
    assert.equal(pkg.priceStars, 0);
  });
});

// ---------------------------------------------------------------------------
// resolvePackage
// ---------------------------------------------------------------------------
describe("resolvePackage", () => {
  /** @type {import("../src/config/packages.js").PackageRecord} */
  const record = {
    id: "btn1",
    name: "Button 1",
    description: "desc",
    priceLabel: "2,000",
    priceStars: 2000,
    active: true,
    imageUrl: "",
    inviteLinkEnv: "PACKAGE_BTN1_INVITE_LINK",
    channelEnvs: ["PACKAGE_BTN1_CHANNEL_ID"],
  };

  it("resolves a valid channel id", () => {
    const pkg = resolvePackage(record, { PACKAGE_BTN1_CHANNEL_ID: "-1001234567890" });
    assert.deepEqual(pkg.channelIds, ["-1001234567890"]);
  });

  it("resolves to empty array when env var is missing", () => {
    const pkg = resolvePackage(record, {});
    assert.deepEqual(pkg.channelIds, []);
  });

  it("resolves to empty array when value is not numeric", () => {
    const pkg = resolvePackage(record, { PACKAGE_BTN1_CHANNEL_ID: "not-a-number" });
    assert.deepEqual(pkg.channelIds, []);
  });
});

// ---------------------------------------------------------------------------
// isPayable
// ---------------------------------------------------------------------------
describe("isPayable", () => {
  it("returns true for active package with priceStars and channelIds", () => {
    const pkg = { id: "btn1", name: "B1", description: "", priceLabel: "", priceStars: 2000, active: true, imageUrl: "", inviteLinkEnv: "X", channelEnvs: [], channelIds: ["-100123"] };
    assert.ok(isPayable(pkg));
  });

  it("returns false when inactive", () => {
    const pkg = { id: "btn1", name: "B1", description: "", priceLabel: "", priceStars: 2000, active: false, imageUrl: "", inviteLinkEnv: "X", channelEnvs: [], channelIds: ["-100123"] };
    assert.ok(!isPayable(pkg));
  });

  it("returns false when priceStars is 0", () => {
    const pkg = { id: "btn1", name: "B1", description: "", priceLabel: "", priceStars: 0, active: true, imageUrl: "", inviteLinkEnv: "X", channelEnvs: [], channelIds: ["-100123"] };
    assert.ok(!isPayable(pkg));
  });

  it("returns false when channelIds is empty", () => {
    const pkg = { id: "btn1", name: "B1", description: "", priceLabel: "", priceStars: 2000, active: true, imageUrl: "", inviteLinkEnv: "X", channelEnvs: [], channelIds: [] };
    assert.ok(!isPayable(pkg));
  });
});

// ---------------------------------------------------------------------------
// channelStatus
// ---------------------------------------------------------------------------
describe("channelStatus", () => {
  /** @type {import("../src/config/packages.js").PackageRecord} */
  const record = {
    id: "btn1", name: "B1", description: "", priceLabel: "", priceStars: 2000,
    active: true, imageUrl: "", inviteLinkEnv: "X", channelEnvs: ["PACKAGE_BTN1_CHANNEL_ID"],
  };

  it("returns configured for a valid numeric channel id", () => {
    assert.equal(channelStatus(record, { PACKAGE_BTN1_CHANNEL_ID: "-1001234567890" }), "configured");
  });

  it("returns missing when env var is absent", () => {
    assert.equal(channelStatus(record, {}), "missing");
  });

  it("returns invalid when value is not numeric", () => {
    assert.equal(channelStatus(record, { PACKAGE_BTN1_CHANNEL_ID: "not-numeric" }), "invalid");
  });
});

// ---------------------------------------------------------------------------
// packagesSharingInvite
// ---------------------------------------------------------------------------
describe("packagesSharingInvite", () => {
  it("returns empty (invite sharing check removed in new payment flow)", () => {
    const records = [
      { id: "a", name: "A", description: "", priceLabel: "", priceStars: 100, active: true, imageUrl: "", inviteLinkEnv: "LINK_A", channelEnvs: ["CH_A"] },
      { id: "b", name: "B", description: "", priceLabel: "", priceStars: 100, active: true, imageUrl: "", inviteLinkEnv: "LINK_B", channelEnvs: ["CH_B"] },
    ];
    assert.deepEqual(packagesSharingInvite(records, {}, "a"), []);
  });

  it("returns empty for unknown id", () => {
    assert.deepEqual(packagesSharingInvite([], {}, "unknown"), []);
  });
});

// ---------------------------------------------------------------------------
// createMemoryRepository
// ---------------------------------------------------------------------------
describe("createMemoryRepository", () => {
  it("loads packages", () => {
    const repo = createMemoryRepository([{ id: "btn1", name: "Button 1", priceStars: 2000 }]);
    const loaded = repo.load();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].id, "btn1");
  });

  it("saves and reloads packages", async () => {
    const repo = createMemoryRepository([{ id: "btn1", name: "Button 1" }]);
    const result = await repo.save([{ id: "btn2", name: "Button 2", active: true, priceStars: 5000 }]);
    assert.ok(result.ok);
    assert.equal(repo.load()[0].id, "btn2");
  });

  it("returns copies, not references", () => {
    const repo = createMemoryRepository([{ id: "btn1", name: "Button 1", active: true }]);
    const loaded = repo.load();
    loaded[0].name = "Mutated";
    assert.equal(repo.load()[0].name, "Button 1");
  });
});
