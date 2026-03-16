/**
 * Unit tests for quiet hours enforcement in the scheduler.
 *
 * Validates that audio-producing tools (announcements, media playback,
 * volume increases) are blocked during quiet hours (10 PM – 8 AM).
 */

// Mock the shared module's sole DB dependency so it can load
// without pulling in the full application stack.
jest.mock("@/lib/db", () => ({
  addLog: jest.fn(),
  listUsersWithPermissions: jest.fn(() => []),
}));

import { isQuietHours, isNoisyTool } from "@/lib/scheduler/shared";

describe("Quiet hours", () => {
  const realDate = global.Date;

  afterEach(() => {
    global.Date = realDate;
  });

  function mockHour(hour: number) {
    const Mock = class extends realDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) {
          super(2026, 2, 5, hour, 30, 0); // March 5, 2026, <hour>:30
        } else {
          super(...(args as [number]));
        }
      }
    } as DateConstructor;
    Mock.now = realDate.now;
    global.Date = Mock;
  }

  describe("isQuietHours", () => {
    test.each([22, 23, 0, 1, 5, 7])("returns true at %d:00 (quiet)", (hour) => {
      mockHour(hour);
      expect(isQuietHours()).toBe(true);
    });

    test.each([8, 9, 12, 15, 18, 21])("returns false at %d:00 (daytime)", (hour) => {
      mockHour(hour);
      expect(isQuietHours()).toBe(false);
    });
  });

  describe("isNoisyTool", () => {
    test("announce is noisy", () => {
      expect(isNoisyTool("builtin.alexa_announce")).toBe(true);
    });

    test("set_device_volume is noisy when increasing", () => {
      expect(isNoisyTool("builtin.alexa_set_device_volume", { volume: 50 })).toBe(true);
    });

    test("set_device_volume is not noisy when muting", () => {
      expect(isNoisyTool("builtin.alexa_set_device_volume", { volume: 0 })).toBe(false);
    });

    test("adjust_device_volume is noisy when positive", () => {
      expect(isNoisyTool("builtin.alexa_adjust_device_volume", { amount: 10 })).toBe(true);
    });

    test("adjust_device_volume is not noisy when negative", () => {
      expect(isNoisyTool("builtin.alexa_adjust_device_volume", { amount: -10 })).toBe(false);
    });

    test("pattern-matched MCP tools are noisy", () => {
      expect(isNoisyTool("mcp_spotify.play_media")).toBe(true);
      expect(isNoisyTool("mcp_home.play_music")).toBe(true);
      expect(isNoisyTool("mcp_tts.speak")).toBe(true);
      expect(isNoisyTool("custom.announce")).toBe(true);
      expect(isNoisyTool("mcp_audio.text_to_speech")).toBe(true);
    });

    test("read-only tools are not noisy", () => {
      expect(isNoisyTool("builtin.alexa_get_music_status")).toBe(false);
      expect(isNoisyTool("builtin.alexa_get_device_volumes")).toBe(false);
      expect(isNoisyTool("builtin.alexa_get_bedroom_state")).toBe(false);
      expect(isNoisyTool("builtin.alexa_list_lights")).toBe(false);
      expect(isNoisyTool("builtin.alexa_get_dnd_status")).toBe(false);
    });

    test("non-audio tools are not noisy", () => {
      expect(isNoisyTool("builtin.alexa_set_light_power")).toBe(false);
      expect(isNoisyTool("builtin.alexa_set_light_brightness")).toBe(false);
      expect(isNoisyTool("builtin.web_search")).toBe(false);
      expect(isNoisyTool("builtin.nexus_create_tool")).toBe(false);
    });
  });
});
