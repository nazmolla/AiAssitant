/**
 * Unit tests — Channels CRUD & user scoping
 */
import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import {
  createChannel,
  listChannels,
  getChannel,
  updateChannel,
  deleteChannel,
  getChannelOwnerId,
  upsertChannelUserMapping,
  getChannelUserMapping,
  listChannelUserMappings,
  deleteChannelUserMapping,
} from "@/lib/db/queries";

let userA: string;
let userB: string;

beforeAll(() => {
  setupTestDb();
  userA = seedTestUser({ email: "ch-a@example.com" });
  userB = seedTestUser({ email: "ch-b@example.com" });
});
afterAll(() => teardownTestDb());

describe("Channels", () => {
  let channelId: string;

  test("createChannel creates a channel owned by user", () => {
    const ch = createChannel({
      label: "My WhatsApp",
      channelType: "whatsapp",
      configJson: JSON.stringify({ phone: "+123" }),
      userId: userA,
    });
    channelId = ch.id;
    expect(ch.label).toBe("My WhatsApp");
    expect(ch.channel_type).toBe("whatsapp");
    expect(ch.user_id).toBe(userA);
    expect(ch.webhook_secret).toBeDefined();
    expect(ch.enabled).toBe(1);
  });

  test("getChannel retrieves by id", () => {
    const ch = getChannel(channelId);
    expect(ch).toBeDefined();
    expect(ch!.label).toBe("My WhatsApp");
  });

  test("listChannels scoped to user", () => {
    createChannel({
      label: "Bob Discord",
      channelType: "discord",
      configJson: "{}",
      userId: userB,
    });
    const aCh = listChannels(userA);
    const bCh = listChannels(userB);
    expect(aCh.every((c) => c.user_id === userA)).toBe(true);
    expect(bCh.every((c) => c.user_id === userB)).toBe(true);
  });

  test("getChannelOwnerId returns the owner", () => {
    expect(getChannelOwnerId(channelId)).toBe(userA);
  });

  test("updateChannel modifies fields", () => {
    const updated = updateChannel({ id: channelId, label: "Updated WA" });
    expect(updated).toBeDefined();
    expect(updated!.label).toBe("Updated WA");
  });

  test("updateChannel toggles enabled", () => {
    const updated = updateChannel({ id: channelId, enabled: false });
    expect(updated!.enabled).toBe(0);
  });

  test("updateChannel returns undefined for unknown id", () => {
    expect(updateChannel({ id: "nonexistent" })).toBeUndefined();
  });

  test("deleteChannel removes the channel", () => {
    const temp = createChannel({ label: "Temp", channelType: "webhook", configJson: "{}", userId: userA });
    deleteChannel(temp.id);
    expect(getChannel(temp.id)).toBeUndefined();
  });
});

describe("Channel User Mappings", () => {
  let channelId: string;

  beforeAll(() => {
    const ch = createChannel({ label: "Mapping Test", channelType: "webhook", configJson: "{}", userId: userA });
    channelId = ch.id;
  });

  test("upsertChannelUserMapping creates a mapping", () => {
    upsertChannelUserMapping(channelId, "ext-123", userA);
    const mapping = getChannelUserMapping(channelId, "ext-123");
    expect(mapping).toBeDefined();
    expect(mapping!.user_id).toBe(userA);
  });

  test("upsertChannelUserMapping updates on conflict", () => {
    upsertChannelUserMapping(channelId, "ext-123", userB);
    const mapping = getChannelUserMapping(channelId, "ext-123");
    expect(mapping!.user_id).toBe(userB);
  });

  test("listChannelUserMappings returns all for channel", () => {
    upsertChannelUserMapping(channelId, "ext-456", userA);
    const mappings = listChannelUserMappings(channelId);
    expect(mappings.length).toBeGreaterThanOrEqual(2);
  });

  test("deleteChannelUserMapping removes the mapping", () => {
    deleteChannelUserMapping(channelId, "ext-456");
    expect(getChannelUserMapping(channelId, "ext-456")).toBeUndefined();
  });
});
