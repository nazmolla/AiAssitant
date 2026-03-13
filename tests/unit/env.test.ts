describe("env config module", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function loadEnv() {
    return require("@/lib/env").env;
  }

  it("provides default DATABASE_PATH when env var is not set", () => {
    delete process.env.DATABASE_PATH;
    const { DATABASE_PATH } = loadEnv();
    expect(DATABASE_PATH).toContain("nexus.db");
  });

  it("uses DATABASE_PATH from env when set", () => {
    process.env.DATABASE_PATH = "/custom/path/db.sqlite";
    const { DATABASE_PATH } = loadEnv();
    expect(DATABASE_PATH).toBe("/custom/path/db.sqlite");
  });

  it("defaults NODE_ENV to development", () => {
    delete process.env.NODE_ENV;
    const { NODE_ENV } = loadEnv();
    expect(NODE_ENV).toBe("development");
  });

  it("reads NODE_ENV from env", () => {
    process.env.NODE_ENV = "production";
    const { NODE_ENV } = loadEnv();
    expect(NODE_ENV).toBe("production");
  });

  it("DISABLE_REGISTRATION defaults to false", () => {
    delete process.env.DISABLE_REGISTRATION;
    const { DISABLE_REGISTRATION } = loadEnv();
    expect(DISABLE_REGISTRATION).toBe(false);
  });

  it("DISABLE_REGISTRATION is true when set to 'true'", () => {
    process.env.DISABLE_REGISTRATION = "true";
    const { DISABLE_REGISTRATION } = loadEnv();
    expect(DISABLE_REGISTRATION).toBe(true);
  });

  it("WORKER_POOL_SIZE defaults to 2", () => {
    delete process.env.WORKER_POOL_SIZE;
    const { WORKER_POOL_SIZE } = loadEnv();
    expect(WORKER_POOL_SIZE).toBe(2);
  });

  it("WORKER_POOL_SIZE falls back to default for non-positive values", () => {
    process.env.WORKER_POOL_SIZE = "0";
    const { WORKER_POOL_SIZE } = loadEnv();
    expect(WORKER_POOL_SIZE).toBeGreaterThanOrEqual(1);
  });

  it("WORKER_POOL_SIZE parses integer values", () => {
    process.env.WORKER_POOL_SIZE = "4";
    const { WORKER_POOL_SIZE } = loadEnv();
    expect(WORKER_POOL_SIZE).toBe(4);
  });

  it("PROACTIVE_CRON_SCHEDULE defaults to every 15 minutes", () => {
    delete process.env.PROACTIVE_CRON_SCHEDULE;
    const { PROACTIVE_CRON_SCHEDULE } = loadEnv();
    expect(PROACTIVE_CRON_SCHEDULE).toBe("*/15 * * * *");
  });

  it("FS_ALLOWED_ROOT defaults to cwd", () => {
    delete process.env.FS_ALLOWED_ROOT;
    const { FS_ALLOWED_ROOT } = loadEnv();
    expect(FS_ALLOWED_ROOT).toBe(process.cwd());
  });

  it("NEXUS_DEDUPE_KNOWLEDGE_STARTUP defaults to false", () => {
    delete process.env.NEXUS_DEDUPE_KNOWLEDGE_STARTUP;
    const { NEXUS_DEDUPE_KNOWLEDGE_STARTUP } = loadEnv();
    expect(NEXUS_DEDUPE_KNOWLEDGE_STARTUP).toBe(false);
  });

  it("returns a frozen object", () => {
    const config = loadEnv();
    expect(Object.isFrozen(config)).toBe(true);
  });
});
