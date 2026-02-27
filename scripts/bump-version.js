#!/usr/bin/env node
/**
 * Auto-increment version number based on:
 *   - Git commit messages since last tag (conventional commits)
 *   - Environment variable BUMP_TYPE override
 *   - Default: patch bump
 *
 * Commit conventions:
 *   feat:  / feature:  → minor bump
 *   fix:   / bugfix:   → patch bump
 *   BREAKING CHANGE / breaking: / major: → major bump
 *
 * Usage:
 *   node scripts/bump-version.js          # auto-detect from git log
 *   BUMP_TYPE=minor node scripts/bump-version.js  # force minor
 *   node scripts/bump-version.js --dry-run        # show what would happen
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const PKG_PATH = path.resolve(__dirname, "..", "package.json");
const DRY_RUN = process.argv.includes("--dry-run");

function getCurrentVersion() {
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, "utf-8"));
  return pkg.version;
}

function parseVersion(version) {
  const [major, minor, patch] = version.split(".").map(Number);
  return { major, minor, patch };
}

function formatVersion({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

function detectBumpType() {
  // Allow explicit override
  const envBump = process.env.BUMP_TYPE;
  if (envBump && ["major", "minor", "patch"].includes(envBump)) {
    console.log(`  Bump type from BUMP_TYPE env: ${envBump}`);
    return envBump;
  }

  // Try to read git commits since last tag
  try {
    let commits;
    try {
      const lastTag = execSync("git describe --tags --abbrev=0", {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      commits = execSync(`git log ${lastTag}..HEAD --oneline --no-merges`, { encoding: "utf-8" });
      console.log(`  Analyzing commits since ${lastTag}...`);
    } catch {
      // No tags — use last 20 commits
      commits = execSync("git log --oneline --no-merges -20", { encoding: "utf-8" });
      console.log("  No tags found, analyzing recent commits...");
    }

    const lines = commits.trim().split("\n").filter(Boolean);
    if (lines.length === 0) {
      console.log("  No new commits, defaulting to patch bump");
      return "patch";
    }

    let hasMajor = false;
    let hasMinor = false;

    for (const line of lines) {
      const msg = line.toLowerCase();
      if (msg.includes("breaking change") || msg.includes("breaking:") || msg.includes("major:")) {
        hasMajor = true;
      }
      if (msg.includes("feat:") || msg.includes("feat(") || msg.includes("feature:") || msg.includes("feature(")) {
        hasMinor = true;
      }
    }

    if (hasMajor) {
      console.log(`  Detected BREAKING CHANGE in ${lines.length} commits → major bump`);
      return "major";
    }
    if (hasMinor) {
      console.log(`  Detected feature commits in ${lines.length} commits → minor bump`);
      return "minor";
    }
    console.log(`  ${lines.length} commits (fixes/chores) → patch bump`);
    return "patch";
  } catch {
    console.log("  Git not available, defaulting to patch bump");
    return "patch";
  }
}

function bumpVersion(version, type) {
  const v = parseVersion(version);
  switch (type) {
    case "major":
      return formatVersion({ major: v.major + 1, minor: 0, patch: 0 });
    case "minor":
      return formatVersion({ major: v.major, minor: v.minor + 1, patch: 0 });
    case "patch":
    default:
      return formatVersion({ major: v.major, minor: v.minor, patch: v.patch + 1 });
  }
}

// ── Main ──────────────────────────────────────────────────────────
console.log("Version bump:");
const currentVersion = getCurrentVersion();
const bumpType = detectBumpType();
const newVersion = bumpVersion(currentVersion, bumpType);

console.log(`  ${currentVersion} → ${newVersion} (${bumpType})`);

if (DRY_RUN) {
  console.log("  [dry-run] No changes written");
  process.exit(0);
}

// Write updated version to package.json
const pkg = JSON.parse(fs.readFileSync(PKG_PATH, "utf-8"));
pkg.version = newVersion;
fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + "\n");
console.log("  ✓ package.json updated");

// Create a git tag so subsequent builds only scan commits since this version
try {
  execSync(`git tag -a v${newVersion} -m "v${newVersion}"`, {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  console.log(`  ✓ Tagged v${newVersion}`);
} catch {
  // Tag may already exist or git may not be available — non-fatal
  console.log(`  ⚠ Could not create tag v${newVersion} (may already exist)`);
}
