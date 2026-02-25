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
  ],
  // Coverage thresholds
  collectCoverageFrom: [
    "src/lib/**/*.ts",
    "!src/lib/bootstrap.ts",
    "!src/lib/**/index.ts",
  ],
  coverageDirectory: "coverage",
};

export default config;
