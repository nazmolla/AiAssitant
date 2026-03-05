# YouTube MCP Server

MCP server that provides YouTube Data API v3 access to Nexus Agent — search videos, manage playlists, view subscriptions and liked videos.

## Tools

| Tool | Description |
|------|-------------|
| `youtube_search` | Search for videos, channels, or playlists |
| `youtube_get_video` | Get detailed info about a specific video |
| `youtube_list_playlists` | List your playlists |
| `youtube_create_playlist` | Create a new playlist |
| `youtube_update_playlist` | Update playlist title/description/privacy |
| `youtube_delete_playlist` | Delete a playlist |
| `youtube_list_playlist_items` | List videos in a playlist |
| `youtube_add_to_playlist` | Add a video to a playlist |
| `youtube_remove_from_playlist` | Remove a video from a playlist |
| `youtube_list_subscriptions` | List your channel subscriptions |
| `youtube_get_liked_videos` | Get your liked videos (closest to watch history) |
| `youtube_get_watch_history` | Get recent activity feed (likes, uploads, etc.) |
| `youtube_get_channel_info` | Get your channel's info and stats |

## Setup

### 1. Google Cloud credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or select existing)
3. Enable **YouTube Data API v3** under APIs & Services → Library
4. Go to **Credentials** → Create Credentials → **OAuth 2.0 Client ID**
   - Application type: **Desktop app**
5. Note your **Client ID** and **Client Secret**

### 2. Get a refresh token

```bash
cd scripts/mcp-servers/youtube
npm install
YOUTUBE_CLIENT_ID=your_client_id YOUTUBE_CLIENT_SECRET=your_secret node auth-setup.js
```

Follow the prompts — open the URL, authorize, paste the code. Save the refresh token.

### 3. Register in Nexus

Register the MCP server via the Nexus API or UI:

- **Transport**: `stdio`
- **Command**: `node`
- **Args**: `["/home/<user>/AiAssistant/scripts/mcp-servers/youtube/index.js"]`
- **Env vars**:
  ```json
  {
    "YOUTUBE_CLIENT_ID": "your_client_id",
    "YOUTUBE_CLIENT_SECRET": "your_secret",
    "YOUTUBE_REFRESH_TOKEN": "your_refresh_token"
  }
  ```

Or via curl:

```bash
curl -X POST http://YOUR_SERVER_IP:3000/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "id": "youtube",
    "name": "YouTube",
    "transport": "stdio",
    "command": "node",
    "args": ["/home/<user>/AiAssistant/scripts/mcp-servers/youtube/index.js"],
    "env_vars": {
      "YOUTUBE_CLIENT_ID": "...",
      "YOUTUBE_CLIENT_SECRET": "...",
      "YOUTUBE_REFRESH_TOKEN": "..."
    }
  }'
```

## Limitations

- **Watch history**: YouTube removed direct watch history from API v3 in 2016. The `youtube_get_watch_history` tool returns the Activities feed (likes, uploads, subscriptions) instead. `youtube_get_liked_videos` is the closest available proxy.
- **API quotas**: YouTube Data API v3 has a daily quota of 10,000 units. Search costs 100 units; most other calls cost 1-5 units. Monitor usage in Google Cloud Console.
