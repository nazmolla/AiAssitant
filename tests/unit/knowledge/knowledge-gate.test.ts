/**
 * Unit tests — Knowledge retrieval gate (PERF-10)
 *
 * Verifies that:
 *  1. needsKnowledgeRetrieval() is tested BEFORE hasKnowledgeEntries()
 *  2. Trivial messages ('ok', 'thanks', 'yes') skip retrieval entirely
 *  3. Short but meaningful queries ('what is X?') still trigger retrieval
 *  4. The check order in loop.ts puts heuristic before vault check
 */

import { needsKnowledgeRetrieval } from "@/lib/knowledge/retriever";

describe("needsKnowledgeRetrieval — trivial message filtering", () => {
  const trivialMessages = [
    "ok", "okay", "sure", "thanks", "thank you", "thx", "ty",
    "got it", "understood", "roger", "cool", "nice", "great",
    "awesome", "perfect", "alright", "np", "no problem", "cheers",
    "hi", "hello", "hey", "howdy", "yo", "sup",
    "bye", "goodbye", "see ya", "later", "take care",
    "yes", "no", "yep", "nope", "yeah", "nah",
    "lol", "haha", "hehe",
    "how are you", "what are you", "who are you",
    "", "  ", ".",
  ];

  test.each(trivialMessages)(
    "skips retrieval for trivial message: '%s'",
    (msg) => {
      expect(needsKnowledgeRetrieval(msg)).toBe(false);
    }
  );
});

describe("needsKnowledgeRetrieval — meaningful queries still trigger", () => {
  const meaningfulMessages = [
    "what is the project deadline?",
    "tell me about my preferences",
    "how do I configure the database?",
    "summarize the architecture",
    "what tools are available?",
    "find files related to authentication",
    "explain the deployment process",
    "what language does the user prefer?",
    "search for error handling patterns",
    "what is TypeScript?",
  ];

  test.each(meaningfulMessages)(
    "triggers retrieval for meaningful query: '%s'",
    (msg) => {
      expect(needsKnowledgeRetrieval(msg)).toBe(true);
    }
  );
});

describe("Knowledge retrieval check ordering (PERF-10)", () => {
  test("loop.ts checks needsKnowledgeRetrieval BEFORE hasKnowledgeEntries", () => {
    const fs = require("fs");
    const path = require("path");
    const loopPath = path.join(__dirname, "../../../src/lib/agent/loop.ts");
    const src = fs.readFileSync(loopPath, "utf-8");

    // Find the condition that gates knowledge retrieval
    const conditionMatch = src.match(
      /if\s*\(\s*(needsKnowledgeRetrieval|hasKnowledgeEntries)\(.*?\)\s*&&\s*(needsKnowledgeRetrieval|hasKnowledgeEntries)\(/
    );
    expect(conditionMatch).not.toBeNull();
    // The first check should be needsKnowledgeRetrieval (cheap heuristic),
    // not hasKnowledgeEntries (DB/cache check)
    expect(conditionMatch![1]).toBe("needsKnowledgeRetrieval");
    expect(conditionMatch![2]).toBe("hasKnowledgeEntries");
  });
});
