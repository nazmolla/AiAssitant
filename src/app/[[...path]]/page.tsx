"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import dynamic from "next/dynamic";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import LogoutIcon from "@mui/icons-material/Logout";
import MenuIcon from "@mui/icons-material/Menu";
import PaletteIcon from "@mui/icons-material/Palette";
import ChatIcon from "@mui/icons-material/Chat";
import DashboardIcon from "@mui/icons-material/Dashboard";
import SchoolIcon from "@mui/icons-material/School";
import SettingsIcon from "@mui/icons-material/Settings";
import ScheduleIcon from "@mui/icons-material/Schedule";
import HeadsetMicIcon from "@mui/icons-material/HeadsetMic";
import Avatar from "@mui/material/Avatar";
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import HubIcon from "@mui/icons-material/Hub";
import ExtensionIcon from "@mui/icons-material/Extension";
import GavelIcon from "@mui/icons-material/Gavel";
import AssignmentIcon from "@mui/icons-material/Assignment";
import DevicesIcon from "@mui/icons-material/Devices";
import RecordVoiceOverIcon from "@mui/icons-material/RecordVoiceOver";
import MicIcon from "@mui/icons-material/Mic";
import ArticleIcon from "@mui/icons-material/Article";
import ManageSearchIcon from "@mui/icons-material/ManageSearch";
import StorageIcon from "@mui/icons-material/Storage";
import BuildIcon from "@mui/icons-material/Build";
import LockIcon from "@mui/icons-material/Lock";
import GroupIcon from "@mui/icons-material/Group";
import { useTheme, THEMES } from "@/components/theme-provider";
import { AppPageBackbone } from "@/components/app-page-backbone";

/* ── Lazy-loaded tab components (code-split into separate chunks) ── */
const ChatPanel = dynamic(() => import("@/components/chat-panel").then(m => ({ default: m.ChatPanel })), { ssr: false });
const KnowledgeVault = dynamic(() => import("@/components/knowledge-vault").then(m => ({ default: m.KnowledgeVault })), { ssr: false });
const AgentDashboard = dynamic(() => import("@/components/agent-dashboard").then(m => ({ default: m.AgentDashboard })), { ssr: false });
const ConversationMode = dynamic(() => import("@/components/conversation-mode").then(m => ({ default: m.ConversationMode })), { ssr: false });
const NotificationBell = dynamic(() => import("@/components/notification-bell").then(m => ({ default: m.NotificationBell })), { ssr: false });
const SchedulerConsole = dynamic(() => import("@/components/scheduler-console").then(m => ({ default: m.SchedulerConsole })), { ssr: false });

/* ── Lazy-loaded settings sub-tab components ── */
const McpConfig = dynamic(() => import("@/components/mcp-config").then(m => ({ default: m.McpConfig })), { ssr: false });
const LlmConfig = dynamic(() => import("@/components/llm-config").then(m => ({ default: m.LlmConfig })), { ssr: false });
const ChannelsConfig = dynamic(() => import("@/components/channels-config").then(m => ({ default: m.ChannelsConfig })), { ssr: false });
const ProfileConfig = dynamic(() => import("@/components/profile-config").then(m => ({ default: m.ProfileConfig })), { ssr: false });
const UserManagement = dynamic(() => import("@/components/user-management").then(m => ({ default: m.UserManagement })), { ssr: false });
const AuthConfig = dynamic(() => import("@/components/auth-config").then(m => ({ default: m.AuthConfig })), { ssr: false });
const ToolPolicies = dynamic(() => import("@/components/tool-policies").then(m => ({ default: m.ToolPolicies })), { ssr: false });
const CustomToolsConfig = dynamic(() => import("@/components/custom-tools-config").then(m => ({ default: m.CustomToolsConfig })), { ssr: false });
const LoggingConfig = dynamic(() => import("@/components/logging-config").then(m => ({ default: m.LoggingConfig })), { ssr: false });
const SearchProvidersConfig = dynamic(() => import("@/components/search-providers-config").then(m => ({ default: m.SearchProvidersConfig })), { ssr: false });
const WhisperConfig = dynamic(() => import("@/components/whisper-config").then(m => ({ default: m.WhisperConfig })), { ssr: false });
const SchedulerConfig = dynamic(() => import("@/components/scheduler-config").then(m => ({ default: m.SchedulerConfig })), { ssr: false });
const DbManagementConfig = dynamic(() => import("@/components/db-management-config").then(m => ({ default: m.DbManagementConfig })), { ssr: false });
const StandingOrdersConfig = dynamic(() => import("@/components/standing-orders-config").then(m => ({ default: m.StandingOrdersConfig })), { ssr: false });
const DevicesConfig = dynamic(() => import("@/components/devices-config").then(m => ({ default: m.DevicesConfig })), { ssr: false });
const VoiceProfileConfig = dynamic(() => import("@/components/voice-profile-config").then(m => ({ default: m.VoiceProfileConfig })), { ssr: false });

/* ── URL ↔ tab mapping (module-level for stable references) ── */
const TAB_FROM_PATH: Record<string, string> = {
  chat: "chat", dashboard: "dashboard",
  conversation: "conversation",
  knowledge: "knowledge",
  scheduler: "scheduler",
  settings: "config",
};
const PATH_FROM_TAB: Record<string, string> = {
  chat: "/chat", dashboard: "/dashboard",
  conversation: "/conversation",
  knowledge: "/knowledge",
  scheduler: "/scheduler",
  config: "/settings",
};

export default function HomePage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string>("user");
  const [isUserMetaLoading, setIsUserMetaLoading] = useState(true);
  const pathname = usePathname();
  const [navDrawerOpen, setNavDrawerOpen] = useState(false);
  // Ref for opening the chat thread drawer from the app-level burger button
  const openChatThreadsRef = useRef<(() => void) | null>(null);

  /* Derive initial tab + settings sub-page from the current URL */
  const pathSegments = pathname.split("/").filter(Boolean);
  const tabFromUrl = TAB_FROM_PATH[pathSegments[0]] || "chat";
  const settingsPageFromUrl = pathSegments[0] === "settings" ? pathSegments[1] : undefined;

  /* State mirrors the URL but allows instant UI updates before the push */
  const [activeTab, setActiveTab] = useState<string>(tabFromUrl);
  const [settingsPage, setSettingsPage] = useState<string | undefined>(settingsPageFromUrl);

  /* Sync state when the URL changes (browser back/forward or external navigate) */
  useEffect(() => { setActiveTab(tabFromUrl); }, [tabFromUrl]);
  useEffect(() => { setSettingsPage(settingsPageFromUrl); }, [settingsPageFromUrl]);

  const navigateTo = useCallback((tab: string) => {
    setActiveTab(tab);
    router.push(PATH_FROM_TAB[tab] || "/chat");
  }, [router]);

  const navigateToSettings = useCallback((page: string) => {
    setSettingsPage(page);
    router.push(`/settings/${page}`);
  }, [router]);

  const openProfileFromMenu = useCallback(() => {
    setActiveTab("config");
    setSettingsPage("profile");
    router.push("/settings/profile");
  }, [router]);

  const signOutFromMenu = useCallback(async () => {
    await signOut({ redirect: false });
    router.push("/auth/signin");
  }, [router]);
  const [perms, setPerms] = useState<Record<string, number>>({
    chat: 1, knowledge: 1, dashboard: 1,
    mcp_servers: 1, channels: 1, llm_config: 1, screen_sharing: 1,
  });

  useEffect(() => {
    let mounted = true;

    const loadUserMeta = async () => {
      try {
        const [profileResult, meResult] = await Promise.allSettled([
          fetch("/api/config/profile").then((r) => r.json()),
          fetch("/api/admin/users/me").then((r) => r.json()),
        ]);

        if (!mounted) return;

        if (profileResult.status === "fulfilled" && profileResult.value?.display_name) {
          setDisplayName(profileResult.value.display_name);
        }
        if (profileResult.status === "fulfilled" && profileResult.value?.avatar_url) {
          setAvatarUrl(profileResult.value.avatar_url);
        }

        if (meResult.status === "fulfilled") {
          const data = meResult.value;
          if (data?.role) setUserRole(data.role);
          if (data?.permissions) setPerms(data.permissions);
        }
      } finally {
        if (mounted) setIsUserMetaLoading(false);
      }
    };

    loadUserMeta();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!perms.chat && activeTab === "chat") {
      setActiveTab("config");
      router.replace("/settings");
    }
  }, [perms.chat, activeTab, router]);

  /* Redirect bare "/" to "/chat" so the URL always shows the active page */
  useEffect(() => {
    if (pathname === "/") {
      router.replace("/chat");
    }
  }, [pathname, router]);

  /* ── Hooks that depend on perms — MUST be called before any conditional return
     to satisfy React's Rules of Hooks (same hook count on every render). ── */
  const tabItems = useMemo(() => {
    const items: { value: string; label: string; icon: React.ReactElement }[] = [];
    if (perms.chat) items.push({ value: "chat", label: "Chat", icon: <ChatIcon fontSize="small" /> });
    if (perms.chat) items.push({ value: "conversation", label: "Conversation", icon: <HeadsetMicIcon fontSize="small" /> });
    if (perms.dashboard) items.push({ value: "dashboard", label: "Dashboard", icon: <DashboardIcon fontSize="small" /> });
    if (perms.knowledge) items.push({ value: "knowledge", label: "Knowledge", icon: <SchoolIcon fontSize="small" /> });
    if (userRole === "admin") items.push({ value: "scheduler", label: "Scheduler", icon: <ScheduleIcon fontSize="small" /> });
    items.push({ value: "config", label: "Settings", icon: <SettingsIcon fontSize="small" /> });
    return items;
  }, [perms, userRole]);

  const activeTabItem = tabItems.find((t) => t.value === activeTab);

  if (status === "loading") {
    return (
      <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <div style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--accent-grad)", animation: "aurora-drift 2s ease-in-out infinite alternate", opacity: 0.8 }} />
          <span style={{ color: "var(--ng-fg-dim)", fontSize: 14 }}>Loading Nexus…</span>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 42, fontWeight: 700, letterSpacing: "-0.03em", marginBottom: 10, background: "var(--accent-grad)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Nexus</div>
          <div style={{ color: "var(--ng-fg-dim)", fontSize: 16, marginBottom: 32 }}>The AI that actually does things.</div>
          <Button variant="contained" size="large" sx={{ px: 5, py: 1.5, borderRadius: 3 }} onClick={() => router.push("/auth/signin")}>
            Sign In
          </Button>
        </div>
      </div>
    );
  }

  const initials = (displayName || session.user?.email || "?").charAt(0).toUpperCase();

  return (
    <div className="app-shell">
      {/* ── Sidebar rail ── */}
      <nav className="ng-glass ng-sidebar">
        {/* Brand logo tile */}
        <div
          className="ng-brand"
          onClick={() => navigateTo("chat")}
          title="Nexus — Go to chat"
          aria-label="Nexus"
          role="button"
          tabIndex={0}
        >
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <circle cx="11" cy="11" r="3" fill="white" opacity="0.95" />
            <circle cx="11" cy="11" r="6.5" stroke="white" strokeWidth="1.2" opacity="0.6" fill="none" />
            <circle cx="11" cy="11" r="10" stroke="white" strokeWidth="0.8" opacity="0.35" fill="none" />
            <circle cx="11" cy="4.5" r="1.5" fill="white" opacity="0.8" />
            <circle cx="17.5" cy="14.5" r="1.5" fill="white" opacity="0.8" />
            <circle cx="4.5" cy="14.5" r="1.5" fill="white" opacity="0.8" />
          </svg>
        </div>

        {/* Nav items */}
        {tabItems.map((t) => (
          <button
            key={t.value}
            className={`ng-nav-item${activeTab === t.value ? " active" : ""}`}
            onClick={() => {
              if (t.value === "chat" && activeTab === "chat" && openChatThreadsRef.current) {
                openChatThreadsRef.current();
              } else {
                navigateTo(t.value);
              }
            }}
            aria-label={t.label}
          >
            {t.icon}
            <span className="ng-tip">{t.label}</span>
          </button>
        ))}

        <div className="ng-sidebar-spacer" />

        {/* Avatar at bottom */}
        <button
          className="ng-nav-item"
          onClick={openProfileFromMenu}
          aria-label="Profile settings"
          title="Profile"
        >
          <div className="ng-avatar" style={{ width: 28, height: 28, fontSize: 12 }}>{initials}</div>
          <span className="ng-tip">{displayName || session.user?.email}</span>
        </button>
      </nav>

      {/* ── Topbar ── */}
      <header className="ng-glass ng-topbar">
        <div className="ng-topbar-left">
          {/* Mobile: hamburger */}
          <button
            className="ng-icon-btn ng-mobile-menu-btn"
            onClick={() => setNavDrawerOpen((prev) => !prev)}
            aria-label="Open navigation"
          >
            <MenuIcon fontSize="small" />
          </button>
          {activeTabItem && (
            <div className="ng-crumb-chip">
              {activeTabItem.icon}
              <span>{activeTabItem.label}</span>
            </div>
          )}
          <span className="ng-version-pill">v{process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0"}</span>
        </div>
        <div className="ng-topbar-right">
          <NotificationBell />
          <ThemeSwitcher />
          <div
            className="ng-avatar-chip"
            onClick={openProfileFromMenu}
            role="button"
            tabIndex={0}
            title="Open profile settings"
          >
            <div className="ng-avatar">{initials}</div>
            <span className="ng-avatar-name" style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {displayName || session.user?.email}
            </span>
          </div>
          <button className="ng-icon-btn" onClick={signOutFromMenu} title="Sign out" aria-label="Sign out">
            <LogoutIcon fontSize="small" />
          </button>
        </div>
      </header>

      {/* ── Mobile nav overlay ── */}
      <Drawer
        open={navDrawerOpen}
        onClose={() => setNavDrawerOpen(false)}
        anchor="left"
        sx={{ display: { xs: "block", md: "none" } }}
        PaperProps={{
          sx: {
            width: DRAWER_WIDTH,
            display: "flex",
            flexDirection: "column",
            bgcolor: "background.default",
          },
        }}
      >
        <Box sx={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <Box sx={{ flex: 1 }} />
          <List disablePadding sx={{ py: 0.5, px: 0.5 }}>
            {tabItems.map((t) => (
              <ListItemButton
                key={t.value}
                selected={activeTab === t.value}
                onClick={() => {
                  if (t.value === "chat" && activeTab === "chat" && openChatThreadsRef.current) {
                    openChatThreadsRef.current();
                  } else {
                    navigateTo(t.value);
                  }
                  setNavDrawerOpen(false);
                }}
                sx={{
                  borderRadius: 1.5, minHeight: 44, py: 0.75, px: 1.5, mb: 0.25,
                  "&.Mui-selected": {
                    bgcolor: "primary.main", color: "primary.contrastText",
                    "& .MuiListItemIcon-root": { color: "inherit" },
                    "&:hover": { bgcolor: "primary.dark" },
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: 32, color: "text.secondary", justifyContent: "center" }}>
                  {t.icon}
                </ListItemIcon>
                <ListItemText primary={t.label} primaryTypographyProps={{ fontSize: "0.9rem", fontWeight: 500 }} />
              </ListItemButton>
            ))}
          </List>
        </Box>
      </Drawer>

      {/* ── Main content area ── */}
      <div className="ng-glass ng-main">
        {/* ChatPanel kept mounted — hidden via CSS to preserve state & SSE connections */}
        <div style={{ display: activeTab === "chat" ? "flex" : "none", flex: 1, overflow: "hidden", flexDirection: "column", height: "100%" }}>
          <ChatPanel
            openThreadDrawerRef={openChatThreadsRef}
            navItems={tabItems}
            activeNavTab={activeTab}
            onNavigate={(tab) => { navigateTo(tab); }}
          />
        </div>
        {activeTab === "conversation" && <ConversationMode />}
        {activeTab === "dashboard" && (
          <AppPageBackbone>
            <AgentDashboard />
          </AppPageBackbone>
        )}
        {activeTab === "scheduler" && (
          <AppPageBackbone>
            <SchedulerConsole />
          </AppPageBackbone>
        )}
        {activeTab === "knowledge" && (
          <AppPageBackbone>
            <KnowledgeVault />
          </AppPageBackbone>
        )}
        {activeTab === "config" && <SettingsPanel userRole={userRole} perms={perms} isUserMetaLoading={isUserMetaLoading} activePage={settingsPage} onNavigate={navigateToSettings} />}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Settings Panel — left sidebar navigation                                   */
/* -------------------------------------------------------------------------- */

interface SettingsPage {
  key: string;
  label: string;
  Icon: React.ElementType;
  adminOnly?: boolean;
  permKey?: string;
}

const SETTINGS_PAGES: SettingsPage[] = [
  { key: "llm", label: "Providers", Icon: SmartToyIcon, permKey: "llm_config" },
  { key: "channels", label: "Channels", Icon: HubIcon, permKey: "channels" },
  { key: "mcp", label: "MCP Servers", Icon: ExtensionIcon, permKey: "mcp_servers" },
  { key: "policies", label: "Tool Policies", Icon: GavelIcon, permKey: "mcp_servers" },
  { key: "standing-orders", label: "Standing Orders", Icon: AssignmentIcon },
  { key: "devices", label: "Devices", Icon: DevicesIcon },
  { key: "voice-profile", label: "Voice Profile", Icon: RecordVoiceOverIcon },
  { key: "whisper", label: "Local Whisper", Icon: MicIcon, adminOnly: true },
  { key: "logging", label: "Logging", Icon: ArticleIcon },
  { key: "search-providers", label: "Search Providers", Icon: ManageSearchIcon, adminOnly: true },
  { key: "db-management", label: "DB Management", Icon: StorageIcon, adminOnly: true },
  { key: "custom-tools", label: "Custom Tools", Icon: BuildIcon, adminOnly: true },
  { key: "auth", label: "Authentication", Icon: LockIcon, adminOnly: true },
  { key: "users", label: "Users", Icon: GroupIcon, adminOnly: true },
  { key: "scheduler", label: "Batch Scheduler", Icon: ScheduleIcon, adminOnly: true },
];

interface SettingsGroup {
  label: string;
  keys: string[];
}

const SETTINGS_GROUPS: SettingsGroup[] = [
  { label: "Integrations", keys: ["llm", "channels", "mcp"] },
  { label: "Agent Behavior", keys: ["policies", "standing-orders", "custom-tools", "scheduler"] },
  { label: "Voice & Hardware", keys: ["devices", "voice-profile", "whisper"] },
  { label: "System", keys: ["logging", "search-providers", "db-management", "auth", "users"] },
];

const SETTINGS_HEADERS: Record<string, { title: string; subtitle: string }> = {
  profile: { title: "Owner Profile", subtitle: "Your identity, skills, and contact info. Nexus uses this to personalize responses." },
  scheduler: { title: "Batch Scheduler", subtitle: "Configure batch job scheduling for proactive scans, knowledge maintenance, cleanup, and email reading." },
  llm: { title: "LLM Providers", subtitle: "Centralize Azure OpenAI, OpenAI, and Anthropic credentials." },
  channels: { title: "Communication Channels", subtitle: "Connect messaging platforms so Nexus can chat with you anywhere." },
  mcp: { title: "MCP Servers", subtitle: "Manage Model Context Protocol server connections." },
  policies: { title: "Tool Policies", subtitle: "Configure approval requirements and proactive scanning for each discovered tool." },
  "standing-orders": { title: "Standing Orders", subtitle: "View, edit, or revoke your saved approval decisions (Always Allow, Always Ignore, Always Reject)." },
  devices: { title: "Devices", subtitle: "Register ESP32 and other hardware voice clients. Each device gets a one-time API key to connect." },
  "voice-profile": { title: "Voice Profile", subtitle: "Enroll your voice so a shared device can identify you and route conversations to your account." },
  whisper: { title: "Local Whisper", subtitle: "Deploy and configure a local Whisper server as a fallback for cloud Speech-to-Text." },
  logging: { title: "Logging", subtitle: "Server-wide log levels, retention boundary, and cleanup tools." },
  "search-providers": { title: "Search Providers", subtitle: "Configure DB-backed web search providers and fallback order for builtin web_search." },
  "db-management": { title: "DB Management", subtitle: "Monitor DB growth, resource usage, and automate cleanup policies in one place." },
  "custom-tools": { title: "Custom Tools", subtitle: "Agent-created tools that extend Nexus capabilities at runtime." },
  auth: { title: "Authentication", subtitle: "Configure OAuth login providers, API keys, and external integrations." },
  users: { title: "User Management", subtitle: "Manage user access, roles, and feature permissions." },
};

const DRAWER_WIDTH = 200;
const DRAWER_MINI_WIDTH = 52;

const SETTINGS_NAV_WIDTH = 200;

function SettingsPanel({ userRole, perms, isUserMetaLoading, activePage, onNavigate }: { userRole: string; perms: Record<string, number>; isUserMetaLoading: boolean; activePage?: string; onNavigate: (page: string) => void }) {
  const visiblePages = useMemo(() => {
    if (isUserMetaLoading) return SETTINGS_PAGES;
    return SETTINGS_PAGES.filter((p) => {
      if (p.adminOnly && userRole !== "admin") return false;
      if (p.permKey && !perms[p.permKey]) return false;
      return true;
    });
  }, [userRole, perms, isUserMetaLoading]);

  const defaultPage = visiblePages[0]?.key || "llm";
  const validPage = activePage === "profile" || (activePage && visiblePages.some((p) => p.key === activePage)) ? activePage : defaultPage;
  const [active, setActive] = useState(validPage);

  useEffect(() => { setActive(validPage); }, [validPage]);

  useEffect(() => {
    if (isUserMetaLoading) return;
    if (visiblePages.length === 0) return;
    if (!activePage || (activePage !== "profile" && !visiblePages.some((p) => p.key === activePage))) {
      onNavigate(active);
    }
  }, [activePage, active, visiblePages, onNavigate, isUserMetaLoading]);

  const handleNavigate = useCallback((key: string) => {
    setActive(key);
    onNavigate(key);
  }, [onNavigate]);

  const header = SETTINGS_HEADERS[active];

  const visibleKeys = new Set(visiblePages.map((p) => p.key));
  const pageMap = Object.fromEntries(SETTINGS_PAGES.map((p) => [p.key, p]));

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* ── Mobile: horizontal scrollable chip strip (xs / sm) ── */}
      <Box
        sx={{
          display: { xs: "flex", md: "none" },
          alignItems: "center",
          gap: 0.75,
          px: 1.5,
          py: 0.75,
          borderBottom: "1px solid var(--glass-border)",
          background: "rgba(255,255,255,0.02)",
          overflowX: "auto",
          overflowY: "hidden",
          whiteSpace: "nowrap",
          flexShrink: 0,
          scrollbarWidth: "none",
          WebkitOverflowScrolling: "touch",
          "&::-webkit-scrollbar": { display: "none" },
        }}
      >
        {isUserMetaLoading ? (
          <CircularProgress size={16} />
        ) : (
          visiblePages.map((page) => (
            <Chip
              key={page.key}
              icon={<page.Icon sx={{ fontSize: "0.85rem !important" }} />}
              label={page.label}
              size="small"
              variant={active === page.key ? "filled" : "outlined"}
              color={active === page.key ? "primary" : "default"}
              onClick={() => handleNavigate(page.key)}
              sx={{
                flexShrink: 0,
                fontSize: "0.75rem",
                height: 28,
                fontWeight: active === page.key ? 600 : 400,
                cursor: "pointer",
              }}
            />
          ))
        )}
      </Box>

      {/* ── Desktop: vertical grouped sidebar + content (md+) ── */}
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex" }}>
        {/* Sidebar — hidden on mobile */}
        <Box
          sx={{
            display: { xs: "none", md: "block" },
            width: SETTINGS_NAV_WIDTH,
            flexShrink: 0,
            borderRight: "1px solid var(--glass-border)",
            background: "rgba(255,255,255,0.02)",
            overflowY: "auto",
            py: 1,
            "&::-webkit-scrollbar": { width: 6 },
            "&::-webkit-scrollbar-thumb": { background: "rgba(255,255,255,0.08)", borderRadius: 4 },
          }}
        >
          {isUserMetaLoading ? (
            <Box sx={{ px: 2, py: 4, display: "flex", justifyContent: "center" }}>
              <CircularProgress size={20} />
            </Box>
          ) : (
            SETTINGS_GROUPS.map((group) => {
              const groupPages = group.keys
                .filter((k) => visibleKeys.has(k))
                .map((k) => pageMap[k])
                .filter(Boolean);
              if (groupPages.length === 0) return null;
              return (
                <Box key={group.label} sx={{ mb: 1.5 }}>
                  <Typography
                    variant="caption"
                    sx={{
                      px: 1.5,
                      py: 0.75,
                      display: "block",
                      fontWeight: 600,
                      fontSize: "0.6rem",
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "var(--ng-fg-mute)",
                    }}
                  >
                    {group.label}
                  </Typography>
                  <List disablePadding sx={{ px: 0.75 }}>
                    {groupPages.map((page) => (
                      <ListItemButton
                        key={page.key}
                        selected={active === page.key}
                        onClick={() => handleNavigate(page.key)}
                        sx={{
                          borderRadius: "10px",
                          minHeight: 34,
                          py: 0.5,
                          px: 1.25,
                          mb: 0.25,
                          gap: 1,
                          color: "var(--ng-fg-dim)",
                          "&:hover": { background: "rgba(255,255,255,0.04)", color: "var(--ng-fg)" },
                          "&.Mui-selected": {
                            background: "rgba(91,140,255,0.12)",
                            color: "var(--ng-fg)",
                            "& .MuiListItemIcon-root": { color: "var(--ng-accent)" },
                            "&:hover": { background: "rgba(91,140,255,0.16)" },
                          },
                        }}
                      >
                        <ListItemIcon sx={{ minWidth: 0, color: "inherit" }}>
                          <page.Icon sx={{ fontSize: "0.95rem" }} />
                        </ListItemIcon>
                        <ListItemText
                          primary={page.label}
                          primaryTypographyProps={{ fontSize: "0.8rem", fontWeight: 500, noWrap: true }}
                        />
                      </ListItemButton>
                    ))}
                  </List>
                </Box>
              );
            })
          )}
        </Box>

        {/* Content — full width on mobile, sidebar-constrained on desktop */}
        <Box sx={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <AppPageBackbone>
            <Box sx={{ width: "100%" }}>
              {isUserMetaLoading ? (
                <Box sx={{ py: 8, display: "flex", justifyContent: "center" }}>
                  <CircularProgress size={28} />
                </Box>
              ) : (
                <>
                  {header && (
                    <Box sx={{ mb: 3 }}>
                      <Typography variant="h5" fontWeight={700} sx={{ letterSpacing: "-0.02em", color: "var(--ng-fg)" }}>{header.title}</Typography>
                      <Typography variant="body2" sx={{ mt: 0.5, color: "var(--ng-fg-dim)", fontSize: "0.875rem" }}>{header.subtitle}</Typography>
                    </Box>
                  )}
                  {active === "profile" && <ProfileConfig />}
                  {active === "llm" && <LlmConfig />}
                  {active === "channels" && <ChannelsConfig />}
                  {active === "mcp" && <McpConfig />}
                  {active === "policies" && <ToolPolicies />}
                  {active === "standing-orders" && <StandingOrdersConfig />}
                  {active === "devices" && <DevicesConfig />}
                  {active === "voice-profile" && <VoiceProfileConfig />}
                  {active === "whisper" && userRole === "admin" && <WhisperConfig />}
                  {active === "logging" && <LoggingConfig />}
                  {active === "search-providers" && userRole === "admin" && <SearchProvidersConfig />}
                  {active === "db-management" && userRole === "admin" && <DbManagementConfig />}
                  {active === "custom-tools" && userRole === "admin" && <CustomToolsConfig />}
                  {active === "auth" && userRole === "admin" && <AuthConfig />}
                  {active === "users" && userRole === "admin" && <UserManagement />}
                  {active === "scheduler" && userRole === "admin" && <SchedulerConfig />}
                </>
              )}
            </Box>
          </AppPageBackbone>
        </Box>
      </Box>
    </Box>
  );
}

/* -------------------------------------------------------------------------- */
/*  Theme Switcher — dropdown menu in the header                               */
/* -------------------------------------------------------------------------- */

function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  return (
    <>
      <IconButton size="small" onClick={(e) => setAnchorEl(e.currentTarget)} title="Change theme" sx={{ color: "text.secondary" }}>
        <PaletteIcon fontSize="small" />
      </IconButton>
      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={() => setAnchorEl(null)} slotProps={{ paper: { sx: { minWidth: 200, mt: 1 } } }}>
        {THEMES.map((t) => (
          <MenuItem
            key={t.id}
            selected={theme === t.id}
            onClick={() => { setTheme(t.id); setAnchorEl(null); }}
            sx={{ gap: 1.5, borderRadius: 1, mx: 0.5 }}
          >
            <Box sx={{ width: 14, height: 14, borderRadius: "50%", bgcolor: t.swatch, border: "1px solid", borderColor: "divider", flexShrink: 0 }} />
            <Box>
              <Typography variant="body2" fontWeight={500}>{t.label}</Typography>
              <Typography variant="caption" color="text.secondary">{t.description}</Typography>
            </Box>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
