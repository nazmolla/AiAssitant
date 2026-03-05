#!/usr/bin/env node
/**
 * YouTube MCP Server for Nexus Agent
 *
 * Provides YouTube Data API v3 tools via the Model Context Protocol (stdio transport).
 *
 * Required environment variables:
 *   YOUTUBE_CLIENT_ID      — Google OAuth2 client ID
 *   YOUTUBE_CLIENT_SECRET  — Google OAuth2 client secret
 *   YOUTUBE_REFRESH_TOKEN  — OAuth2 refresh token (obtain via `node auth-setup.js`)
 *
 * Tools exposed:
 *   youtube_search              — Search for videos, channels, or playlists
 *   youtube_get_video           — Get detailed info about a video
 *   youtube_list_playlists      — List the user's playlists
 *   youtube_create_playlist     — Create a new playlist
 *   youtube_update_playlist     — Update playlist title/description/privacy
 *   youtube_delete_playlist     — Delete a playlist
 *   youtube_list_playlist_items — List videos in a playlist
 *   youtube_add_to_playlist     — Add a video to a playlist
 *   youtube_remove_from_playlist— Remove a video from a playlist
 *   youtube_list_subscriptions  — List the user's channel subscriptions
 *   youtube_get_liked_videos    — Get the user's liked videos
 *   youtube_get_watch_history   — Get recent activity (uploads, likes, etc.)
 *   youtube_get_channel_info    — Get info about the authenticated user's channel
 */

"use strict";

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { google } = require("googleapis");

// ── Auth Setup ────────────────────────────────────────────────

const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.YOUTUBE_REFRESH_TOKEN;

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.error(
    "[youtube-mcp] Missing required env vars: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN"
  );
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });

const youtube = google.youtube({ version: "v3", auth: oauth2Client });

// ── Helpers ───────────────────────────────────────────────────

const MAX_RESULTS = 50;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function formatDuration(iso) {
  if (!iso) return "unknown";
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return iso;
  const h = m[1] ? `${m[1]}h ` : "";
  const min = m[2] ? `${m[2]}m ` : "";
  const s = m[3] ? `${m[3]}s` : "";
  return (h + min + s).trim() || "0s";
}

function formatVideo(item) {
  const s = item.snippet || {};
  const stats = item.statistics || {};
  const cd = item.contentDetails || {};
  return {
    videoId: item.id?.videoId || item.id || s.resourceId?.videoId,
    title: s.title,
    channel: s.channelTitle,
    publishedAt: s.publishedAt,
    description: s.description?.slice(0, 300),
    duration: formatDuration(cd.duration),
    views: stats.viewCount,
    likes: stats.likeCount,
    url: `https://www.youtube.com/watch?v=${item.id?.videoId || item.id || s.resourceId?.videoId}`,
  };
}

// ── MCP Server ────────────────────────────────────────────────

const server = new McpServer({
  name: "youtube",
  version: "1.0.0",
});

// ── youtube_search ────────────────────────────────────────────

server.tool(
  "youtube_search",
  "Search YouTube for videos, channels, or playlists. Returns titles, URLs, and metadata.",
  {
    query: { type: "string", description: "Search query" },
    type: {
      type: "string",
      description: "Type of result: 'video' (default), 'channel', or 'playlist'",
    },
    maxResults: {
      type: "number",
      description: "Number of results to return (1-50, default 10)",
    },
    order: {
      type: "string",
      description: "Sort order: 'relevance' (default), 'date', 'rating', 'viewCount'",
    },
  },
  async ({ query, type, maxResults, order }) => {
    const res = await youtube.search.list({
      part: ["snippet"],
      q: query,
      type: [type || "video"],
      maxResults: clamp(maxResults || 10, 1, MAX_RESULTS),
      order: order || "relevance",
    });
    const items = (res.data.items || []).map((item) => ({
      id: item.id?.videoId || item.id?.channelId || item.id?.playlistId,
      kind: item.id?.kind,
      title: item.snippet?.title,
      channel: item.snippet?.channelTitle,
      publishedAt: item.snippet?.publishedAt,
      description: item.snippet?.description?.slice(0, 200),
      url:
        item.id?.videoId
          ? `https://www.youtube.com/watch?v=${item.id.videoId}`
          : item.id?.playlistId
            ? `https://www.youtube.com/playlist?list=${item.id.playlistId}`
            : item.id?.channelId
              ? `https://www.youtube.com/channel/${item.id.channelId}`
              : undefined,
    }));
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { totalResults: res.data.pageInfo?.totalResults, items },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ── youtube_get_video ─────────────────────────────────────────

server.tool(
  "youtube_get_video",
  "Get detailed information about a specific YouTube video by ID.",
  {
    videoId: { type: "string", description: "YouTube video ID (e.g. 'dQw4w9WgXcQ')" },
  },
  async ({ videoId }) => {
    const res = await youtube.videos.list({
      part: ["snippet", "contentDetails", "statistics"],
      id: [videoId],
    });
    const item = res.data.items?.[0];
    if (!item) {
      return { content: [{ type: "text", text: "Video not found." }] };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(formatVideo(item), null, 2) }],
    };
  }
);

// ── youtube_list_playlists ────────────────────────────────────

server.tool(
  "youtube_list_playlists",
  "List the authenticated user's YouTube playlists.",
  {
    maxResults: {
      type: "number",
      description: "Number of playlists to return (1-50, default 25)",
    },
  },
  async ({ maxResults }) => {
    const res = await youtube.playlists.list({
      part: ["snippet", "contentDetails"],
      mine: true,
      maxResults: clamp(maxResults || 25, 1, MAX_RESULTS),
    });
    const items = (res.data.items || []).map((pl) => ({
      id: pl.id,
      title: pl.snippet?.title,
      description: pl.snippet?.description?.slice(0, 200),
      itemCount: pl.contentDetails?.itemCount,
      privacy: pl.status?.privacyStatus,
      publishedAt: pl.snippet?.publishedAt,
      url: `https://www.youtube.com/playlist?list=${pl.id}`,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify({ count: items.length, items }, null, 2) }],
    };
  }
);

// ── youtube_create_playlist ───────────────────────────────────

server.tool(
  "youtube_create_playlist",
  "Create a new YouTube playlist on the authenticated user's channel.",
  {
    title: { type: "string", description: "Playlist title" },
    description: { type: "string", description: "Playlist description (optional)" },
    privacy: {
      type: "string",
      description: "Privacy status: 'public', 'unlisted', or 'private' (default 'private')",
    },
  },
  async ({ title, description, privacy }) => {
    const res = await youtube.playlists.insert({
      part: ["snippet", "status"],
      requestBody: {
        snippet: { title, description: description || "" },
        status: { privacyStatus: privacy || "private" },
      },
    });
    const pl = res.data;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              id: pl.id,
              title: pl.snippet?.title,
              privacy: pl.status?.privacyStatus,
              url: `https://www.youtube.com/playlist?list=${pl.id}`,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ── youtube_update_playlist ───────────────────────────────────

server.tool(
  "youtube_update_playlist",
  "Update the title, description, or privacy of an existing YouTube playlist.",
  {
    playlistId: { type: "string", description: "Playlist ID to update" },
    title: { type: "string", description: "New title (required)" },
    description: { type: "string", description: "New description (optional)" },
    privacy: {
      type: "string",
      description: "New privacy: 'public', 'unlisted', or 'private'",
    },
  },
  async ({ playlistId, title, description, privacy }) => {
    const body = {
      id: playlistId,
      snippet: { title, description: description || "" },
    };
    if (privacy) body.status = { privacyStatus: privacy };
    const res = await youtube.playlists.update({
      part: ["snippet", "status"],
      requestBody: body,
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { id: res.data.id, title: res.data.snippet?.title, updated: true },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ── youtube_delete_playlist ───────────────────────────────────

server.tool(
  "youtube_delete_playlist",
  "Delete a YouTube playlist by ID. This action is irreversible.",
  {
    playlistId: { type: "string", description: "Playlist ID to delete" },
  },
  async ({ playlistId }) => {
    await youtube.playlists.delete({ id: playlistId });
    return {
      content: [{ type: "text", text: JSON.stringify({ deleted: true, playlistId }, null, 2) }],
    };
  }
);

// ── youtube_list_playlist_items ───────────────────────────────

server.tool(
  "youtube_list_playlist_items",
  "List videos in a specific YouTube playlist.",
  {
    playlistId: { type: "string", description: "Playlist ID" },
    maxResults: {
      type: "number",
      description: "Number of items to return (1-50, default 25)",
    },
    pageToken: {
      type: "string",
      description: "Page token for pagination (from previous response)",
    },
  },
  async ({ playlistId, maxResults, pageToken }) => {
    const res = await youtube.playlistItems.list({
      part: ["snippet", "contentDetails"],
      playlistId,
      maxResults: clamp(maxResults || 25, 1, MAX_RESULTS),
      pageToken: pageToken || undefined,
    });
    const items = (res.data.items || []).map((item) => ({
      playlistItemId: item.id,
      videoId: item.contentDetails?.videoId,
      title: item.snippet?.title,
      channel: item.snippet?.videoOwnerChannelTitle,
      addedAt: item.snippet?.publishedAt,
      position: item.snippet?.position,
      url: `https://www.youtube.com/watch?v=${item.contentDetails?.videoId}`,
    }));
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              total: res.data.pageInfo?.totalResults,
              nextPageToken: res.data.nextPageToken || null,
              items,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ── youtube_add_to_playlist ───────────────────────────────────

server.tool(
  "youtube_add_to_playlist",
  "Add a video to a YouTube playlist.",
  {
    playlistId: { type: "string", description: "Target playlist ID" },
    videoId: { type: "string", description: "Video ID to add" },
    position: {
      type: "number",
      description: "Position in playlist (0-based, optional — appends to end by default)",
    },
  },
  async ({ playlistId, videoId, position }) => {
    const snippet = {
      playlistId,
      resourceId: { kind: "youtube#video", videoId },
    };
    if (position !== undefined && position !== null) snippet.position = position;
    const res = await youtube.playlistItems.insert({
      part: ["snippet"],
      requestBody: { snippet },
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              playlistItemId: res.data.id,
              videoId,
              playlistId,
              position: res.data.snippet?.position,
              added: true,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ── youtube_remove_from_playlist ──────────────────────────────

server.tool(
  "youtube_remove_from_playlist",
  "Remove a video from a YouTube playlist by its playlist item ID. Use youtube_list_playlist_items to find the playlistItemId.",
  {
    playlistItemId: {
      type: "string",
      description: "The playlist item ID (not the video ID — get it from youtube_list_playlist_items)",
    },
  },
  async ({ playlistItemId }) => {
    await youtube.playlistItems.delete({ id: playlistItemId });
    return {
      content: [
        { type: "text", text: JSON.stringify({ deleted: true, playlistItemId }, null, 2) },
      ],
    };
  }
);

// ── youtube_list_subscriptions ────────────────────────────────

server.tool(
  "youtube_list_subscriptions",
  "List the authenticated user's YouTube channel subscriptions.",
  {
    maxResults: {
      type: "number",
      description: "Number of subscriptions to return (1-50, default 25)",
    },
    order: {
      type: "string",
      description: "Sort: 'relevance' (default), 'alphabetical', 'unread'",
    },
    pageToken: { type: "string", description: "Page token for pagination" },
  },
  async ({ maxResults, order, pageToken }) => {
    const res = await youtube.subscriptions.list({
      part: ["snippet"],
      mine: true,
      maxResults: clamp(maxResults || 25, 1, MAX_RESULTS),
      order: order || "relevance",
      pageToken: pageToken || undefined,
    });
    const items = (res.data.items || []).map((sub) => ({
      subscriptionId: sub.id,
      channelId: sub.snippet?.resourceId?.channelId,
      title: sub.snippet?.title,
      description: sub.snippet?.description?.slice(0, 200),
      subscribedAt: sub.snippet?.publishedAt,
      url: `https://www.youtube.com/channel/${sub.snippet?.resourceId?.channelId}`,
    }));
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              total: res.data.pageInfo?.totalResults,
              nextPageToken: res.data.nextPageToken || null,
              items,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ── youtube_get_liked_videos ──────────────────────────────────

server.tool(
  "youtube_get_liked_videos",
  "Get the authenticated user's liked videos. This is the closest available proxy for watch history since YouTube removed direct history API access.",
  {
    maxResults: {
      type: "number",
      description: "Number of liked videos to return (1-50, default 25)",
    },
    pageToken: { type: "string", description: "Page token for pagination" },
  },
  async ({ maxResults, pageToken }) => {
    const res = await youtube.videos.list({
      part: ["snippet", "contentDetails", "statistics"],
      myRating: "like",
      maxResults: clamp(maxResults || 25, 1, MAX_RESULTS),
      pageToken: pageToken || undefined,
    });
    const items = (res.data.items || []).map(formatVideo);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              total: res.data.pageInfo?.totalResults,
              nextPageToken: res.data.nextPageToken || null,
              items,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ── youtube_get_watch_history ─────────────────────────────────

server.tool(
  "youtube_get_watch_history",
  "Get recent YouTube activity for the authenticated user — includes uploads, likes, subscriptions, and other actions. Note: direct watch history is not available via YouTube API v3; this returns the Activities feed instead.",
  {
    maxResults: {
      type: "number",
      description: "Number of activity items to return (1-50, default 25)",
    },
    pageToken: { type: "string", description: "Page token for pagination" },
  },
  async ({ maxResults, pageToken }) => {
    const res = await youtube.activities.list({
      part: ["snippet", "contentDetails"],
      mine: true,
      maxResults: clamp(maxResults || 25, 1, MAX_RESULTS),
      pageToken: pageToken || undefined,
    });
    const items = (res.data.items || []).map((act) => {
      const s = act.snippet || {};
      const cd = act.contentDetails || {};
      const videoId =
        cd.upload?.videoId ||
        cd.like?.resourceId?.videoId ||
        cd.playlistItem?.resourceId?.videoId ||
        cd.recommendation?.resourceId?.videoId;
      return {
        type: s.type,
        title: s.title,
        description: s.description?.slice(0, 200),
        publishedAt: s.publishedAt,
        videoId,
        url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : undefined,
      };
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              total: res.data.pageInfo?.totalResults,
              nextPageToken: res.data.nextPageToken || null,
              items,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ── youtube_get_channel_info ──────────────────────────────────

server.tool(
  "youtube_get_channel_info",
  "Get information about the authenticated user's YouTube channel.",
  {},
  async () => {
    const res = await youtube.channels.list({
      part: ["snippet", "statistics", "contentDetails"],
      mine: true,
    });
    const ch = res.data.items?.[0];
    if (!ch) {
      return { content: [{ type: "text", text: "No channel found for this account." }] };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              channelId: ch.id,
              title: ch.snippet?.title,
              description: ch.snippet?.description?.slice(0, 300),
              subscriberCount: ch.statistics?.subscriberCount,
              videoCount: ch.statistics?.videoCount,
              viewCount: ch.statistics?.viewCount,
              likesPlaylistId: ch.contentDetails?.relatedPlaylists?.likes,
              uploadsPlaylistId: ch.contentDetails?.relatedPlaylists?.uploads,
              url: `https://www.youtube.com/channel/${ch.id}`,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ── Start Server ──────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[youtube] MCP server running on stdio");
}

main().catch((err) => {
  console.error("[youtube] Fatal error:", err);
  process.exit(1);
});
