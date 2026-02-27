import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  roots: ["<rootDir>/tests"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: "tsconfig.json",
        // Skip type checking in tests for speed
        diagnostics: false,
      },
    ],
  },
  // Separate test suites
  projects: [
    {
      displayName: "unit",
      testMatch: ["<rootDir>/tests/unit/**/*.test.ts"],
      preset: "ts-jest",
      testEnvironment: "node",
      moduleNameMapper: {
        "^@/(.*)$": "<rootDir>/src/$1",
      },
      transform: {
        "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.json", diagnostics: false }],
      },
    },
    {
      displayName: "integration",
      testMatch: ["<rootDir>/tests/integration/**/*.test.ts"],
      preset: "ts-jest",
      testEnvironment: "node",
      moduleNameMapper: {
        "^@/(.*)$": "<rootDir>/src/$1",
      },
      transform: {
        "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.json", diagnostics: false }],
      },
    },
    {
      displayName: "component",
      testMatch: ["<rootDir>/tests/component/**/*.test.tsx"],
      preset: "ts-jest",
      testEnvironment: "jsdom",
      moduleNameMapper: {
        "^@/(.*)$": "<rootDir>/src/$1",
        "\\.(css|less|scss|sass)$": "identity-obj-proxy",
      },
      transform: {
        "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.jest.json", diagnostics: false }],
      },
      setupFilesAfterEnv: ["<rootDir>/tests/helpers/setup-jsdom.ts"],
    },
  ],
  // Coverage thresholds
  collectCoverageFrom: [
    "src/lib/**/*.ts",
    "src/components/**/*.tsx",
    "src/app/**/*.tsx",
    "!src/lib/bootstrap.ts",
    "!src/lib/**/index.ts",
  ],
  coverageDirectory: "coverage",
};

export default config;
