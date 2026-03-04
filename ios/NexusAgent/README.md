# Nexus Agent — iOS App

Native SwiftUI companion app for [Nexus Agent](../../README.md) with full feature parity.

---

## Requirements

- **Xcode 15+** (macOS Sonoma or later recommended)
- **iOS 17.0+** deployment target
- **Nexus Agent server** running on the local network (e.g. `http://<host>:3000`)

## Setup in Xcode

Since this project uses pure SwiftUI with no external dependencies (no CocoaPods/SPM packages), you create the Xcode project manually:

1. Open **Xcode → File → New → Project**
2. Choose **iOS → App**, click Next
3. Configure:
   - **Product Name:** `NexusAgent`
   - **Organization Identifier:** your reverse-domain (e.g. `com.yourname`)
   - **Interface:** SwiftUI
   - **Language:** Swift
   - **Storage:** None
4. Save the project into `ios/NexusAgent/`
5. **Delete** the auto-generated `ContentView.swift` (you'll use ours)
6. Drag the entire `NexusAgent/` source folder (containing Models/, Services/, ViewModels/, Views/, ContentView.swift, NexusAgentApp.swift) into the Xcode project navigator. Select **"Create groups"** and ensure the target is checked.
7. Replace the auto-generated `Assets.xcassets` with our version, or merge the color sets.

## Build & Run

1. Select an **iPhone 15 Pro** simulator (or a physical device)
2. Press **⌘R** to build and run
3. The app will auto-discover any Nexus Agent server on your local network
4. If auto-discovery fails, tap **"Enter address manually"** and enter the server URL

## Architecture

```
NexusAgent/
├── Models/          # 15 Codable structs matching the server API
├── Services/        # APIClient, AuthService, SSEClient, KeychainService, ServerDiscovery
├── ViewModels/      # 8 @MainActor ObservableObjects (MVVM)
├── Views/
│   ├── Auth/        # LoginView (with auto-discovery)
│   ├── Chat/        # ThreadList, ChatView, MessageBubble, ChatInput, ThinkingBlock
│   ├── Knowledge/   # KnowledgeListView + form
│   ├── Approvals/   # ApprovalsView with approve/reject
│   ├── Settings/    # LLM, API Keys, Policies, MCP, Channels, Tools, Alexa, Admin, Logs
│   └── Profile/     # ProfileView + ChangePassword
├── ContentView.swift    # TabView root (5 tabs)
└── NexusAgentApp.swift  # @main entry point
```

### Authentication

The app uses **cookie-based auth** via NextAuth's credential flow — no backend changes required:

1. `GET /api/auth/csrf` → obtain CSRF token
2. `POST /api/auth/callback/credentials` → email + password + csrfToken
3. Session cookie stored in `HTTPCookieStorage` (persists across launches)
4. All subsequent API calls include the cookie automatically

### Server Discovery

On launch, the app auto-discovers the Nexus Agent server:

1. Probes any **saved URL** from Keychain
2. Tries a **default local address** (`http://<host>:3000`)
3. **Scans subnets** (192.168.0-2.x, 192.168.10.x, 10.0.0-1.x) on ports 3000, 80, 8080, 443
4. Uses concurrent `TaskGroup` batches (20 IPs at a time) with 2-second timeout
5. Verifies by checking `/api/auth/csrf` returns a valid CSRF token

If discovery fails, the user can enter the server address manually.

### SSE Streaming

Chat uses **Server-Sent Events** for real-time streaming. `SSEClient` (a `URLSessionDataDelegate`) parses the SSE stream and dispatches events:

| Event    | Action |
|----------|--------|
| `status` | Shows thinking/analysis indicator |
| `message`| Appends message to chat |
| `done`   | Marks streaming complete |
| `error`  | Displays error message |

## Features

| Feature | Description |
|---------|-------------|
| **Chat** | Full chat with SSE streaming, thinking blocks, tool call display, attachments (PhotosPicker) |
| **Knowledge** | Browse, search, add, delete knowledge entries |
| **Approvals** | View pending HITL approvals, approve/reject with argument inspection |
| **Settings** | LLM providers, API keys, tool policies, MCP servers, channels, custom tools, Alexa config |
| **Admin** | User management (roles, permissions, enable/disable) — admin only |
| **Logs** | Agent activity logs with level/source filters and bulk clear |
| **Profile** | Profile editing + password change |
| **Server Discovery** | Auto-find the server on the local network |

## Supported API Endpoints

The app communicates with all 20+ Nexus Agent API endpoints. See [TECH_SPECS.md](../../docs/TECH_SPECS.md) for the full API reference.

## Notes

- No third-party dependencies — pure SwiftUI + Foundation + Security (Keychain)
- iOS 17+ required for `onChange(of:)` two-parameter overload and `symbolEffect`
- `Info.plist`: Add `NSAppTransportSecurity > NSAllowsArbitraryLoads = YES` for HTTP connections to the local server (or add specific domain exceptions)

## License

Same license as the main Nexus Agent project.
