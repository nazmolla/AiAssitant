#!/usr/bin/env node
/**
 * YouTube OAuth2 Setup Script
 *
 * Run once to obtain a refresh token for the YouTube MCP server.
 *
 * Prerequisites:
 *   1. Go to https://console.cloud.google.com/
 *   2. Create a project (or select existing)
 *   3. Enable "YouTube Data API v3"
 *   4. Go to Credentials → Create OAuth 2.0 Client ID (type: Desktop app)
 *   5. Download the client ID and secret
 *
 * Usage:
 *   YOUTUBE_CLIENT_ID=xxx YOUTUBE_CLIENT_SECRET=yyy node auth-setup.js
 *
 * This will:
 *   - Print an authorization URL — open it in your browser
 *   - Ask you to paste the authorization code
 *   - Exchange it for tokens and print the refresh token
 */

"use strict";

const { google } = require("googleapis");
const readline = require("readline");

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET environment variables first.");
  process.exit(1);
}

const SCOPES = [
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.force-ssl",
];

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  "urn:ietf:wg:oauth:2.0:oob"
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  scope: SCOPES,
  prompt: "consent",
});

console.log("\n=== YouTube OAuth2 Setup ===\n");
console.log("1. Open this URL in your browser:\n");
console.log(`   ${authUrl}\n`);
console.log("2. Sign in and authorize the application.");
console.log("3. Copy the authorization code and paste it below.\n");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question("Authorization code: ", async (code) => {
  rl.close();
  try {
    const { tokens } = await oauth2Client.getToken(code.trim());
    console.log("\n=== Success! ===\n");
    console.log("Your refresh token (save this — you won't see it again):\n");
    console.log(`   YOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    console.log("Add this as an env var when registering the MCP server in Nexus.");
  } catch (err) {
    console.error("\nFailed to exchange authorization code:", err.message);
    process.exit(1);
  }
});
