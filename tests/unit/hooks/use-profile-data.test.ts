/**
 * Unit tests for use-profile-data hook.
 * @jest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";
import { useProfileData, EMPTY_PROFILE } from "@/hooks/use-profile-data";

const mockThemeCtx = {
  theme: "ember",
  setTheme: jest.fn(),
  font: "inter",
  setFont: jest.fn(),
  timezone: "",
  setTimezone: jest.fn(),
};

describe("useProfileData", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("initializes with empty profile", () => {
    const { result } = renderHook(() => useProfileData(mockThemeCtx));
    expect(result.current.profile).toEqual(EMPTY_PROFILE);
    expect(result.current.saving).toBe(false);
    expect(result.current.saved).toBe(false);
    expect(result.current.languages).toEqual([]);
  });

  test("load fetches profile and emails", async () => {
    const profileData = { ...EMPTY_PROFILE, display_name: "Test User", theme: "ember", font: "inter", timezone: "" };
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ json: () => Promise.resolve(profileData) })
      .mockResolvedValueOnce({ json: () => Promise.resolve({ secondary: ["alt@test.com"] }) });

    const { result } = renderHook(() => useProfileData(mockThemeCtx));

    await act(async () => { await result.current.load(); });

    expect(result.current.profile.display_name).toBe("Test User");
    expect(result.current.secondaryEmails).toEqual(["alt@test.com"]);
  });

  test("save calls PUT with profile data", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

    const { result } = renderHook(() => useProfileData(mockThemeCtx));

    await act(async () => { await result.current.save(); });

    expect(global.fetch).toHaveBeenCalledWith("/api/config/profile", expect.objectContaining({
      method: "PUT",
    }));
  });

  test("update modifies a profile field", () => {
    const { result } = renderHook(() => useProfileData(mockThemeCtx));

    act(() => { result.current.update("display_name", "New Name"); });

    expect(result.current.profile.display_name).toBe("New Name");
  });

  test("update coerces numeric fields to number", () => {
    const { result } = renderHook(() => useProfileData(mockThemeCtx));

    act(() => { result.current.update("screen_sharing_enabled", "0"); });

    expect(result.current.profile.screen_sharing_enabled).toBe(0);
  });

  test("addLang adds a language", () => {
    const { result } = renderHook(() => useProfileData(mockThemeCtx));

    act(() => { result.current.setLangInput("TypeScript"); });
    act(() => { result.current.addLang(); });

    expect(result.current.languages).toContain("TypeScript");
    expect(result.current.langInput).toBe("");
  });

  test("addLang ignores duplicates", () => {
    const { result } = renderHook(() => useProfileData(mockThemeCtx));

    act(() => { result.current.setLangInput("JavaScript"); });
    act(() => { result.current.addLang(); });
    act(() => { result.current.setLangInput("JavaScript"); });
    act(() => { result.current.addLang(); });

    expect(result.current.languages.filter((l: string) => l === "JavaScript")).toHaveLength(1);
  });

  test("removeLang removes a language", () => {
    const { result } = renderHook(() => useProfileData(mockThemeCtx));

    act(() => { result.current.setLangInput("Python"); });
    act(() => { result.current.addLang(); });
    expect(result.current.languages).toContain("Python");

    act(() => { result.current.removeLang("Python"); });
    expect(result.current.languages).not.toContain("Python");
  });

  test("addSecondaryEmail calls POST and updates list", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

    const { result } = renderHook(() => useProfileData(mockThemeCtx));

    act(() => { result.current.setNewEmailInput("new@test.com"); });
    await act(async () => { await result.current.addSecondaryEmail(); });

    expect(result.current.secondaryEmails).toContain("new@test.com");
    expect(result.current.newEmailInput).toBe("");
  });

  test("removeSecondaryEmail calls DELETE and removes from list", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

    const { result } = renderHook(() => useProfileData(mockThemeCtx));

    // Add first
    act(() => { result.current.setNewEmailInput("remove@test.com"); });
    await act(async () => { await result.current.addSecondaryEmail(); });
    expect(result.current.secondaryEmails).toContain("remove@test.com");

    // Remove
    await act(async () => { await result.current.removeSecondaryEmail("remove@test.com"); });
    expect(result.current.secondaryEmails).not.toContain("remove@test.com");
  });

  test("playVoicePreview calls TTS API", async () => {
    const mockBlob = new Blob(["audio"], { type: "audio/mpeg" });
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(mockBlob),
    });

    const originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = jest.fn(() => "blob:http://localhost/voice");

    // Mock Audio constructor
    const playMock = jest.fn().mockResolvedValue(undefined);
    const origAudio = global.Audio;
    global.Audio = jest.fn().mockImplementation(() => ({
      play: playMock,
      onended: null,
      onerror: null,
    })) as unknown as typeof Audio;

    const { result } = renderHook(() => useProfileData(mockThemeCtx));

    await act(async () => { await result.current.playVoicePreview("alloy"); });

    expect(global.fetch).toHaveBeenCalledWith("/api/audio/tts", expect.objectContaining({ method: "POST" }));
    expect(playMock).toHaveBeenCalled();

    URL.createObjectURL = originalCreateObjectURL;
    global.Audio = origAudio;
  });

  test("timezones returns a non-empty array", () => {
    const { result } = renderHook(() => useProfileData(mockThemeCtx));
    expect(result.current.timezones.length).toBeGreaterThan(0);
  });
});
