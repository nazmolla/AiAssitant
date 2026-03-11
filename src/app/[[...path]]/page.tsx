"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
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
import HeadsetMicIcon from "@mui/icons-material/HeadsetMic";
import Avatar from "@mui/material/Avatar";
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import { useTheme, THEMES } from "@/components/theme-provider";
import { AppPageBackbone } from "@/components/app-page-backbone";

/* ── Lazy-loaded tab components (code-split into separate chunks) ── */
const ChatPanel = dynamic(() => import("@/components/chat-panel").then(m => ({ default: m.ChatPanel })), { ssr: false });
const KnowledgeVault = dynamic(() => import("@/components/knowledge-vault").then(m => ({ default: m.KnowledgeVault })), { ssr: false });
const AgentDashboard = dynamic(() => import("@/components/agent-dashboard").then(m => ({ default: m.AgentDashboard })), { ssr: false });
const ConversationMode = dynamic(() => import("@/components/conversation-mode").then(m => ({ default: m.ConversationMode })), { ssr: false });
const NotificationBell = dynamic(() => import("@/components/notification-bell").then(m => ({ default: m.NotificationBell })), { ssr: false });

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
const AlexaConfig = dynamic(() => import("@/components/alexa-config").then(m => ({ default: m.AlexaConfig })), { ssr: false });
const WhisperConfig = dynamic(() => import("@/components/whisper-config").then(m => ({ default: m.WhisperConfig })), { ssr: false });
const SchedulerConfig = dynamic(() => import("@/components/scheduler-config").then(m => ({ default: m.SchedulerConfig })), { ssr: false });
const DbManagementConfig = dynamic(() => import("@/components/db-management-config").then(m => ({ default: m.DbManagementConfig })), { ssr: false });
const StandingOrdersConfig = dynamic(() => import("@/components/standing-orders-config").then(m => ({ default: m.StandingOrdersConfig })), { ssr: false });

/* ── URL ↔ tab mapping (module-level for stable references) ── */
const TAB_FROM_PATH: Record<string, string> = {
  chat: "chat", dashboard: "dashboard",
  conversation: "conversation",
  knowledge: "knowledge",
  settings: "config",
};
const PATH_FROM_TAB: Record<string, string> = {
  chat: "/chat", dashboard: "/dashboard",
  conversation: "/conversation",
  knowledge: "/knowledge",
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
    items.push({ value: "config", label: "Settings", icon: <SettingsIcon fontSize="small" /> });
    return items;
  }, [perms]);

  const activeTabItem = tabItems.find((t) => t.value === activeTab);

  if (status === "loading") {
    return (
      <Box sx={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center", bgcolor: "background.default" }}>
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <CircularProgress size={40} />
          <Typography variant="body2" color="text.secondary">Loading Nexus...</Typography>
        </Box>
      </Box>
    );
  }

  if (!session) {
    return (
      <Box sx={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center", bgcolor: "background.default" }}>
        <Box sx={{ textAlign: "center" }}>
          <Typography variant="h3" fontWeight={700} color="primary" gutterBottom>
            Nexus
          </Typography>
          <Typography variant="subtitle1" color="text.secondary" sx={{ mb: 4 }}>
            The AI that actually does things.
          </Typography>
          <Button variant="contained" size="large" sx={{ px: 5, py: 1.5, borderRadius: 3 }} onClick={() => router.push("/auth/signin")}>
            Sign In
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh", bgcolor: "background.default" }}>
      {/* Header */}
      <AppBar position="static" color="default">
        <Toolbar variant="dense" sx={{ gap: 1, justifyContent: "space-between" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <IconButton size="small" onClick={() => setNavDrawerOpen(true)} sx={{ color: "text.secondary" }}>
              <MenuIcon fontSize="small" />
            </IconButton>
            <Typography variant="h6" color="primary" fontWeight={700} sx={{ letterSpacing: "-0.5px" }}>
              Nexus
            </Typography>
            {activeTabItem && (
              <Chip
                icon={activeTabItem.icon}
                label={activeTabItem.label}
                size="small"
                variant="outlined"
                color="primary"
                sx={{ fontSize: "0.7rem", height: 24, "& .MuiChip-icon": { fontSize: "0.85rem" } }}
              />
            )}
            <Typography variant="caption" color="text.secondary" sx={{ display: { xs: "none", sm: "inline" }, fontFamily: "monospace", fontSize: "0.65rem" }}>
              v{process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0"}
            </Typography>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <NotificationBell />
            <ThemeSwitcher />
            <FiberManualRecordIcon sx={{ fontSize: 10, color: "success.main" }} titleAccess="Online" />
              <Button
                size="small"
                variant="text"
                title="Open profile settings"
                onClick={openProfileFromMenu}
                sx={{
                  textTransform: "none",
                  minWidth: 0,
                  px: 1,
                  color: "text.secondary",
                  maxWidth: 220,
                  gap: 0.75,
                }}
              >
                <Avatar
                  src={avatarUrl || undefined}
                  sx={{ width: 24, height: 24, fontSize: "0.75rem", bgcolor: "primary.main" }}
                >
                  {(displayName || session.user?.email || "?").charAt(0).toUpperCase()}
                </Avatar>
                {displayName || session.user?.email}
              </Button>
              <IconButton size="small" onClick={signOutFromMenu} sx={{ color: "text.secondary" }} title="Sign out">
                <LogoutIcon fontSize="small" />
              </IconButton>
          </Box>
        </Toolbar>
      </AppBar>

      {/* Navigation Drawer */}
      <Drawer
        anchor="left"
        open={navDrawerOpen}
        onClose={() => setNavDrawerOpen(false)}
        slotProps={{ paper: { sx: { width: DRAWER_WIDTH, bgcolor: "background.paper", backgroundImage: "none" } } }}
      >
        <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}>
          <Typography variant="h6" color="primary" fontWeight={700} sx={{ fontSize: "1.1rem" }}>Nexus</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.65rem" }}>Command Center</Typography>
        </Box>
        <List disablePadding sx={{ flex: 1, py: 0.5, px: 0.5 }}>
          {tabItems.map((t) => (
            <ListItemButton
              key={t.value}
              selected={activeTab === t.value}
              onClick={() => { navigateTo(t.value); setNavDrawerOpen(false); }}
              sx={{
                borderRadius: 1.5,
                minHeight: 38,
                py: 0.75,
                px: 1.5,
                mb: 0.25,
                "&.Mui-selected": { bgcolor: "primary.main", color: "primary.contrastText", "& .MuiListItemIcon-root": { color: "inherit" }, "&:hover": { bgcolor: "primary.dark" } },
              }}
            >
              <ListItemIcon sx={{ minWidth: 32, color: "text.secondary" }}>{t.icon}</ListItemIcon>
              <ListItemText primary={t.label} primaryTypographyProps={{ fontSize: "0.85rem", fontWeight: 500 }} />
            </ListItemButton>
          ))}
        </List>
        <Divider />
        <Box sx={{ px: 2, py: 1.5 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
            <FiberManualRecordIcon sx={{ fontSize: 8, color: "success.main" }} />
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: "0.75rem" }} noWrap>
              {displayName || session.user?.email}
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.6rem", display: "block" }}>
            Nexus v{process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0"}
          </Typography>
        </Box>
      </Drawer>

      {/* Content */}
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {/* ChatPanel kept mounted — hidden via CSS to preserve state & SSE connections */}
        <Box sx={{ display: activeTab === "chat" ? "flex" : "none", flex: 1, overflow: "hidden", flexDirection: "column" }}>
          <ChatPanel />
        </Box>
        {activeTab === "conversation" && <ConversationMode />}
        {activeTab === "dashboard" && (
          <AppPageBackbone>
            <AgentDashboard />
          </AppPageBackbone>
        )}
        {activeTab === "knowledge" && (
          <AppPageBackbone>
            <KnowledgeVault />
          </AppPageBackbone>
        )}
        {activeTab === "config" && <SettingsPanel userRole={userRole} perms={perms} isUserMetaLoading={isUserMetaLoading} activePage={settingsPage} onNavigate={navigateToSettings} />}
      </Box>
    </Box>
  );
}

/* -------------------------------------------------------------------------- */
/*  Settings Panel — left sidebar navigation                                   */
/* -------------------------------------------------------------------------- */

interface SettingsPage {
  key: string;
  label: string;
  icon: string;
  adminOnly?: boolean;
  permKey?: string;
}

const SETTINGS_PAGES: SettingsPage[] = [
  { key: "llm", label: "Providers", icon: "🤖", permKey: "llm_config" },
  { key: "channels", label: "Channels", icon: "📡", permKey: "channels" },
  { key: "mcp", label: "MCP Servers", icon: "🔌", permKey: "mcp_servers" },
  { key: "policies", label: "Tool Policies", icon: "🛡️", permKey: "mcp_servers" },
  { key: "standing-orders", label: "Standing Orders", icon: "📋" },
  { key: "alexa", label: "Alexa", icon: "🔊" },
  { key: "whisper", label: "Local Whisper", icon: "🎤", adminOnly: true },
  { key: "logging", label: "Logging", icon: "🧾" },
  { key: "db-management", label: "DB Management", icon: "🗄️", adminOnly: true },
  { key: "custom-tools", label: "Custom Tools", icon: "🔧", adminOnly: true },
  { key: "auth", label: "Authentication", icon: "🔐", adminOnly: true },
  { key: "users", label: "Users", icon: "👥", adminOnly: true },
  { key: "scheduler", label: "Scheduler", icon: "⏱️", adminOnly: true },
];

const SETTINGS_HEADERS: Record<string, { title: string; subtitle: string }> = {
  profile: { title: "Owner Profile", subtitle: "Your identity, skills, and contact info. Nexus uses this to personalize responses." },
  scheduler: { title: "Proactive Scheduler", subtitle: "Configure how often Nexus proactively scans for updates and takes automated actions." },
  llm: { title: "LLM Providers", subtitle: "Centralize Azure OpenAI, OpenAI, and Anthropic credentials." },
  channels: { title: "Communication Channels", subtitle: "Connect messaging platforms so Nexus can chat with you anywhere." },
  mcp: { title: "MCP Servers", subtitle: "Manage Model Context Protocol server connections." },
  policies: { title: "Tool Policies", subtitle: "Configure approval requirements and proactive scanning for each discovered tool." },
  "standing-orders": { title: "Standing Orders", subtitle: "View, edit, or revoke your saved approval decisions (Always Allow, Always Ignore, Always Reject)." },
  alexa: { title: "Alexa Smart Home", subtitle: "Connect your Amazon Alexa account to control smart home devices, make announcements, and read sensors." },
  whisper: { title: "Local Whisper", subtitle: "Deploy and configure a local Whisper server as a fallback for cloud Speech-to-Text." },
  logging: { title: "Logging", subtitle: "Server-wide log levels, retention boundary, and cleanup tools." },
  "db-management": { title: "DB Management", subtitle: "Monitor DB growth, resource usage, and automate cleanup policies in one place." },
  "custom-tools": { title: "Custom Tools", subtitle: "Agent-created tools that extend Nexus capabilities at runtime." },
  auth: { title: "Authentication", subtitle: "Configure OAuth login providers, API keys, and external integrations." },
  users: { title: "User Management", subtitle: "Manage user access, roles, and feature permissions." },
};

const DRAWER_WIDTH = 200;

function SettingsPanel({ userRole, perms, isUserMetaLoading, activePage, onNavigate }: { userRole: string; perms: Record<string, number>; isUserMetaLoading: boolean; activePage?: string; onNavigate: (page: string) => void }) {
  const visiblePages = useMemo(() => {
    // While loading, show all pages to prevent premature redirects
    if (isUserMetaLoading) return SETTINGS_PAGES;
    return SETTINGS_PAGES.filter((p) => {
      if (p.adminOnly && userRole !== "admin") return false;
      if (p.permKey && !perms[p.permKey]) return false;
      return true;
    });
  }, [userRole, perms, isUserMetaLoading]);

  /* State for immediate UI, synced from URL prop */
  const defaultPage = visiblePages[0]?.key || "llm";
  /* Allow "profile" even though it's not in the chip list (accessible via account menu) */
  const validPage = activePage === "profile" || (activePage && visiblePages.some((p) => p.key === activePage)) ? activePage : defaultPage;
  const [active, setActive] = useState(validPage);

  /* Sync with URL changes */
  useEffect(() => { setActive(validPage); }, [validPage]);

  /* Redirect to valid page if needed — skip while permissions are loading */
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

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Horizontal scrollable chip strip */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          px: 1.5,
          py: 0.75,
          borderBottom: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
          overflowX: "auto",
          overflowY: "hidden",
          whiteSpace: "nowrap",
          scrollbarWidth: "none",
          "&::-webkit-scrollbar": { display: "none" },
        }}
      >
        {isUserMetaLoading ? (
          <Chip
            label="Loading settings..."
            size="small"
            variant="outlined"
            sx={{ flexShrink: 0, fontSize: "0.75rem", height: 28 }}
          />
        ) : (
          <>
            {visiblePages.map((page) => (
              <Chip
                key={page.key}
                label={`${page.icon} ${page.label}`}
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
            ))}
          </>
        )}
      </Box>

      {/* Content */}
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
              <Typography variant="h5" color="primary" fontWeight={700}>{header.title}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{header.subtitle}</Typography>
            </Box>
          )}

          {active === "profile" && <ProfileConfig />}
          {active === "llm" && <LlmConfig />}
          {active === "channels" && <ChannelsConfig />}
          {active === "mcp" && <McpConfig />}
          {active === "policies" && <ToolPolicies />}
          {active === "standing-orders" && <StandingOrdersConfig />}
          {active === "alexa" && <AlexaConfig />}
          {active === "whisper" && userRole === "admin" && <WhisperConfig />}
          {active === "logging" && <LoggingConfig />}
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
