"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Thread {
  id: string;
  title: string;
  status: string;
  last_message_at: string;
}

interface Message {
  id: number;
  thread_id: string;
  role: string;
  content: string | null;
  tool_calls: string | null;
  tool_results: string | null;
}

export function ChatPanel() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch threads
  useEffect(() => {
    fetch("/api/threads")
      .then((r) => r.json())
      .then(setThreads)
      .catch(console.error);
  }, []);

  // Fetch messages when thread changes
  useEffect(() => {
    if (!activeThread) return;
    fetch(`/api/threads/${activeThread}`)
      .then((r) => r.json())
      .then((data) => setMessages(data.messages || []))
      .catch(console.error);
  }, [activeThread]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function createThread() {
    const res = await fetch("/api/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New Thread" }),
    });
    const thread = await res.json();
    setThreads((prev) => [thread, ...prev]);
    setActiveThread(thread.id);
    setMessages([]);
  }

  async function sendMessage() {
    if (!input.trim() || !activeThread) return;

    const userMsg = input;
    setInput("");
    setLoading(true);

    // Optimistic update
    setMessages((prev) => [
      ...prev,
      { id: Date.now(), thread_id: activeThread, role: "user", content: userMsg, tool_calls: null, tool_results: null },
    ]);

    try {
      const res = await fetch(`/api/threads/${activeThread}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg }),
      });
      const data = await res.json();

      if (data.error) {
        setMessages((prev) => [
          ...prev,
          { id: Date.now() + 1, thread_id: activeThread, role: "system", content: `Error: ${data.error}`, tool_calls: null, tool_results: null },
        ]);
      } else {
        // Refresh messages from server
        const threadRes = await fetch(`/api/threads/${activeThread}`);
        const threadData = await threadRes.json();
        setMessages(threadData.messages || []);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, thread_id: activeThread, role: "system", content: `Error: ${err}`, tool_calls: null, tool_results: null },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full">
      {/* Thread Sidebar */}
      <div className="w-64 border-r flex flex-col">
        <div className="p-3 border-b">
          <Button onClick={createThread} className="w-full" size="sm">
            + New Thread
          </Button>
        </div>
        <ScrollArea className="flex-1">
          {threads.map((thread) => (
            <button
              key={thread.id}
              onClick={() => setActiveThread(thread.id)}
              className={`w-full text-left px-3 py-2 text-sm border-b hover:bg-muted transition-colors ${
                activeThread === thread.id ? "bg-muted" : ""
              }`}
            >
              <div className="font-medium truncate">{thread.title}</div>
              <div className="flex items-center gap-1 mt-1">
                <Badge
                  variant={
                    thread.status === "active"
                      ? "success"
                      : thread.status === "awaiting_approval"
                      ? "warning"
                      : "secondary"
                  }
                >
                  {thread.status}
                </Badge>
              </div>
            </button>
          ))}
        </ScrollArea>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {activeThread ? (
          <>
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4 max-w-3xl mx-auto">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${
                      msg.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <Card
                      className={`max-w-[80%] p-3 ${
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : msg.role === "system"
                          ? "bg-muted border-yellow-500/50"
                          : msg.role === "tool"
                          ? "bg-muted border-blue-500/50 font-mono text-xs"
                          : "bg-card"
                      }`}
                    >
                      <div className="text-xs font-medium mb-1 opacity-70 uppercase">
                        {msg.role}
                      </div>
                      <div className="whitespace-pre-wrap text-sm">
                        {msg.content || "(no content)"}
                      </div>
                      {msg.tool_calls && (
                        <div className="mt-2 text-xs opacity-70">
                          🔧 Tool calls: {msg.tool_calls}
                        </div>
                      )}
                    </Card>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Input Bar */}
            <div className="border-t p-4">
              <div className="max-w-3xl mx-auto flex gap-2">
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
                  placeholder="Send a message to Nexus..."
                  disabled={loading}
                />
                <Button onClick={sendMessage} disabled={loading || !input.trim()}>
                  {loading ? "Thinking..." : "Send"}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            Select or create a thread to start chatting.
          </div>
        )}
      </div>
    </div>
  );
}
