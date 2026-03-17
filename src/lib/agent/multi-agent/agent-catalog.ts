/**
 * Multi-Agent Framework — Agent Catalog (Default Definitions)
 *
 * Default agent type definitions shipped with Nexus.
 * These can be overridden or extended via the `app_config` key
 * `agent_catalog_v1` (JSON array stored in the database).
 *
 * Each entry defines the agent's identity, short description (used by the
 * orchestrator for selection), and the full system prompt governing its
 * behaviour.
 *
 * @see https://github.com/nazmolla/AiAssitant/issues/171
 */

import type { AgentTypeDefinition } from "./types";
import { MULTI_AGENT_SYSTEM_PROMPTS } from "@/lib/prompts";

export const DEFAULT_AGENT_CATALOG: AgentTypeDefinition[] = [
  /* ── Information & Research ──────────────────────────────── */
  {
    id: "web_researcher",
    name: "Web Researcher",
    description:
      "Researches topics on the web, extracts information from URLs, and delivers structured summaries. Best for: finding facts, news searches, product comparisons, price lookups, company research.",
    capabilities: ["research", "web_search", "content_extraction", "summarization"],
    systemPrompt: MULTI_AGENT_SYSTEM_PROMPTS.web_researcher,
  },
  {
    id: "news_analyst",
    name: "News Analyst",
    description:
      "Fetches and analyses the latest news and trends on a topic. Returns a structured briefing with headline summaries, key developments, and market/industry implications.",
    capabilities: ["news", "trend_analysis", "summarization", "web_search"],
    systemPrompt: MULTI_AGENT_SYSTEM_PROMPTS.news_analyst,
  },
  {
    id: "data_analyst",
    name: "Data Analyst",
    description:
      "Analyses structured data, produces statistics, surfaces insights, and creates readable summaries or comparisons. Best for: processing lists of records, comparing options, spotting anomalies.",
    capabilities: ["data_analysis", "statistics", "comparison", "summarization"],
    systemPrompt: MULTI_AGENT_SYSTEM_PROMPTS.data_analyst,
  },
  /* ── Content & Document Creation ─────────────────────────── */
  {
    id: "resume_writer",
    name: "Resume Writer",
    description:
      "Writes and tailors professional resumes, cover letters, and career bios. Customises content for specific job descriptions using the user's experience from the knowledge vault.",
    capabilities: ["writing", "resume", "cover_letter", "career_documents"],
    systemPrompt: MULTI_AGENT_SYSTEM_PROMPTS.resume_writer,
  },
  {
    id: "file_creator",
    name: "File Creator",
    description:
      "Authors different types of files: reports, documents, templates, config files, markdown pages, or any structured text output. Saves to the filesystem on request.",
    capabilities: ["file_creation", "writing", "templating", "documentation"],
    systemPrompt: MULTI_AGENT_SYSTEM_PROMPTS.file_creator,
  },
  /* ── Communication ───────────────────────────────────────── */
  {
    id: "email_manager",
    name: "Email Manager",
    description:
      "Reads, classifies, and summarises emails. Drafts and sends replies based on context. Best for: inbox monitoring, email triage, automated responses, email digests.",
    capabilities: ["email_read", "email_write", "inbox_management", "communication"],
    systemPrompt: MULTI_AGENT_SYSTEM_PROMPTS.email_manager,
  },
  /* ── Smart Home & Devices ────────────────────────────────── */
  {
    id: "house_manager",
    name: "House Manager",
    description:
      "Monitors and controls smart home devices via Alexa, Home Assistant, and other MCP integrations. Handles device states, automation routines, sensors, and comfort adjustments.",
    capabilities: ["smart_home", "device_control", "automation", "sensors"],
    systemPrompt: MULTI_AGENT_SYSTEM_PROMPTS.house_manager,
  },
  /* ── Development & Engineering ───────────────────────────── */
  {
    id: "developer",
    name: "Developer",
    description:
      "Writes code, creates and updates custom Nexus tools, debugs issues, and implements features. Works in the nexus_create_tool / nexus_update_tool ecosystem.",
    capabilities: ["coding", "tool_creation", "debugging", "implementation"],
    systemPrompt: MULTI_AGENT_SYSTEM_PROMPTS.developer,
  },
  {
    id: "designer",
    name: "Designer",
    description:
      "Designs tools and features before implementation: defines specs, schemas, API surfaces, and system design documents. Works with the Developer agent to hand off implementation-ready designs.",
    capabilities: ["design", "specification", "schema", "system_design", "api_design"],
    systemPrompt: MULTI_AGENT_SYSTEM_PROMPTS.designer,
  },
  /* ── Knowledge & Memory ──────────────────────────────────── */
  {
    id: "knowledge_manager",
    name: "Knowledge Manager",
    description:
      "Builds and maintains the knowledge vault. Extracts key facts from conversations, research, and documents, then stores them for future retrieval.",
    capabilities: ["knowledge_management", "information_extraction", "memory", "organisation"],
    systemPrompt: MULTI_AGENT_SYSTEM_PROMPTS.knowledge_manager,
  },
];
