import React, { useState, useEffect, useCallback, useRef } from "react";
import { render, Box, Text, useInput, useStdout } from "ink";
import { Session, type SessionStatus, type PendingQuestion, type PendingTool, type ConversationMessage } from "./session.js";
import { loadBacklog, saveBacklog, nextPendingTask, type Backlog, type Task } from "./backlog.js";
import { BacklogView } from "./backlog-view.js";
import { ensureWorktree } from "../lib/worktree.js";

// --- Helpers ---

function slugify(text: string, maxLen = 50): string {
  return text.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "").slice(0, maxLen).replace(/-+$/, "");
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

function statusIcon(s: SessionStatus): string {
  return { starting: "◦", working: "⚙", waiting: "⏳", done: "✓", failed: "✗" }[s];
}

function statusColor(s: SessionStatus): string {
  return { starting: "gray", working: "cyan", waiting: "yellow", done: "green", failed: "red" }[s];
}

function formatCost(usd: number): string {
  return usd > 0 ? `$${usd.toFixed(2)}` : "";
}

function formatTokens(n: number): string {
  if (n === 0) return "-";
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

function buildPrompt(task: Task): string {
  const items = task.items.filter((i) => !i.done).slice(0, 15).map((i) => `- ${i.text}`).join("\n");
  if (items) return `/think Implement ${task.id}: ${task.title}.\n\nItems:\n${items}`;
  return `/think ${task.title}${task.description ? ". " + task.description : ""}`;
}

// --- Session monitor panel ---

function SessionMonitor({ sessions }: { sessions: Session[] }) {
  if (sessions.length === 0) return null;

  return (
    <Box flexDirection="column">
      <Box paddingX={2}>
        <Text bold dimColor>active sessions</Text>
      </Box>
      <Box paddingX={2}>
        <Text dimColor>
          {"  "}{"Task".padEnd(28)}{"Status".padEnd(12)}{"Cost".padEnd(8)}{"In".padEnd(8)}{"Out".padEnd(8)}{"Last output"}
        </Text>
      </Box>
      {sessions.map((s, i) => {
        const last = s.streamingText || s.messages[s.messages.length - 1]?.text || "";
        return (
          <Box key={`sm-${i}`} paddingX={2}>
            <Text wrap="truncate">
              {"  "}
              <Text>{s.name.slice(0, 27).padEnd(28)}</Text>
              <Text color={statusColor(s.status)}>{(statusIcon(s.status) + " " + s.status).padEnd(12)}</Text>
              <Text>{formatCost(s.cost).padEnd(8)}</Text>
              <Text dimColor>{formatTokens(s.inputTokens).padEnd(8)}</Text>
              <Text dimColor>{formatTokens(s.outputTokens).padEnd(8)}</Text>
              <Text dimColor>{truncate(last.replace(/\n/g, " "), 35)}</Text>
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

// --- Tool Approval ---

function ToolApproval({ pending }: { pending: PendingTool }) {
  useInput((input) => {
    if (input === "y") pending.resolve("allow");
    if (input === "n") pending.resolve("deny");
  });

  const display = pending.toolName === "Bash"
    ? (pending.input.command as string || JSON.stringify(pending.input))
    : pending.toolName === "Edit" || pending.toolName === "Write"
    ? String(pending.input.file_path || "")
    : JSON.stringify(pending.input, null, 2);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="yellow" paddingX={1}>
      <Text bold color="yellow">Tool approval needed</Text>
      <Box marginTop={1}>
        <Text bold>{pending.toolName}: </Text>
        <Text color="yellow" wrap="truncate">{display}</Text>
      </Box>
      {pending.input.description && <Text dimColor>{String(pending.input.description)}</Text>}
      <Box marginTop={1}><Text>[y] allow  [n] deny</Text></Box>
    </Box>
  );
}

// --- Question Form ---

function QuestionForm({ pending }: { pending: PendingQuestion }) {
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState(0);

  const q = pending.questions[currentQ];
  if (!q) return null;

  const submit = (answer: string) => {
    const newAnswers = { ...answers, [q.question]: answer };
    setAnswers(newAnswers);
    if (currentQ + 1 < pending.questions.length) { setCurrentQ(currentQ + 1); setCursor(0); }
    else pending.resolve(newAnswers);
  };

  useInput((input, key) => {
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) setCursor((c) => Math.min(q.options.length - 1, c + 1));
    if (key.return) submit(q.options[cursor]?.label || "proceed");
    const num = parseInt(input, 10);
    if (num >= 1 && num <= q.options.length) submit(q.options[num - 1].label);
  });

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">{q.header}: {q.question}</Text>
      <Box flexDirection="column" marginTop={1}>
        {q.options.map((opt, i) => (
          <Box key={`opt-${i}`}>
            <Text inverse={i === cursor}>  {i + 1}. {opt.label}</Text>
            <Text dimColor> — {opt.description}</Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>[1-{q.options.length}] select  [↑↓] navigate  [enter] confirm</Text>
      </Box>
    </Box>
  );
}

// --- Message Log ---

function MessageLog({ messages, streaming, height }: {
  messages: ConversationMessage[];
  streaming: string;
  height: number;
}) {
  const lines: Array<{ key: string; role: string; text: string }> = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    for (const [j, chunk] of m.text.split("\n").entries()) {
      if (chunk.trim()) lines.push({ key: `m-${i}-${j}`, role: j === 0 ? m.role : "cont", text: chunk });
    }
  }
  if (streaming) {
    for (const [j, chunk] of streaming.split("\n").entries()) {
      if (chunk.trim()) lines.push({ key: `s-${j}`, role: j === 0 ? "streaming" : "cont", text: chunk });
    }
  }

  return (
    <Box flexDirection="column" height={height}>
      {lines.slice(-height).map((l) => (
        <Box key={l.key}>
          {l.role === "assistant" && <Text color="cyan">● </Text>}
          {l.role === "user" && <Text color="green">› </Text>}
          {l.role === "tool" && <Text color="yellow">▸ </Text>}
          {l.role === "streaming" && <Text color="cyan">● </Text>}
          {l.role === "cont" && <Text>  </Text>}
          <Text wrap="wrap">{l.text}</Text>
        </Box>
      ))}
      <Box flexGrow={1} />
    </Box>
  );
}

// --- User Input ---

function UserInput({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [text, setText] = useState("");

  useInput((input, key) => {
    if (key.return && text.trim()) {
      onSubmit(text.trim());
      setText("");
      return;
    }
    if (key.backspace || key.delete) {
      setText((t) => t.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta && !key.tab) {
      setText((t) => t + input);
    }
  });

  return (
    <Box paddingX={1}>
      <Text color="green">› </Text>
      <Text>{text}</Text>
      <Text dimColor>█</Text>
    </Box>
  );
}

// --- Session Detail ---

function SessionDetail({ session, onBack, rows }: {
  session: Session; onBack: () => void; rows: number;
}) {
  const [, forceUpdate] = useState(0);
  const refresh = useCallback(() => forceUpdate((n) => n + 1), []);

  useEffect(() => {
    const events = ["update", "stream", "question", "tool-approval"];
    events.forEach((e) => session.on(e, refresh));
    return () => { events.forEach((e) => session.off(e, refresh)); };
  }, [session, refresh]);

  const isInputActive = session.status === "waiting" && !session.pendingQuestion && !session.pendingTool;

  useInput((input, key) => {
    if (key.escape) { onBack(); return; }
    if (key.ctrl && input === "b" && !session.pendingQuestion && !session.pendingTool) { onBack(); return; }
    // Ctrl+X to kill session
    if (key.ctrl && input === "x") { session.kill(); return; }
  });

  const questionH = session.pendingQuestion ? (session.pendingQuestion.questions[0]?.options.length ?? 0) + 5 : 0;
  const toolH = session.pendingTool ? 6 : 0;
  const inputH = isInputActive ? 1 : 0;
  const logH = Math.max(5, rows - 3 - questionH - toolH - inputH);

  return (
    <Box flexDirection="column" height={rows}>
      <MessageLog messages={session.messages} streaming={session.streamingText} height={logH} />

      {session.pendingQuestion && <QuestionForm pending={session.pendingQuestion} />}
      {session.pendingTool && <ToolApproval pending={session.pendingTool} />}

      {isInputActive && (
        <UserInput onSubmit={(text) => {
          session.sendMessage(text);
        }} />
      )}

      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor>
          {!isInputActive && <Text>Esc → back  │  Ctrl+X → kill  │  </Text>}
          {isInputActive && <Text color="yellow">type reply + enter  │  Esc → back  │  Ctrl+X → kill  │  </Text>}
          {session.name}  │
          <Text color={statusColor(session.status)}> {statusIcon(session.status)} {session.status}</Text>
          {session.cost > 0 && <Text>  │  {formatCost(session.cost)}</Text>}
          <Text>  │  {formatTokens(session.inputTokens)} in / {formatTokens(session.outputTokens)} out</Text>
          {session.turns > 0 && <Text>  │  {session.turns} turns</Text>}
        </Text>
      </Box>
    </Box>
  );
}

// --- Root App (unified view) ---

const MAX_CONCURRENT = 3;

function AppRoot() {
  const [view, setView] = useState<"main" | "session">("main");
  const [backlog, setBacklog] = useState<Backlog>(loadBacklog());
  const [sessions, setSessions] = useState<Session[]>([]);
  const [autoStart, setAutoStart] = useState(false);
  const [focusedSession, setFocusedSession] = useState(0);
  const [modalActive, setModalActive] = useState(false);
  const [, forceUpdate] = useState(0);
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  const refresh = useCallback(() => forceUpdate((n) => n + 1), []);

  // Refresh on session changes
  useEffect(() => {
    const handler = () => refresh();
    for (const s of sessions) {
      s.on("update", handler);
      s.on("stream", handler);
    }
    return () => { for (const s of sessions) { s.off("update", handler); s.off("stream", handler); } };
  }, [sessions, refresh]);

  // --- Start a task (shared logic) ---
  const startTask = useCallback((task: Task): Session | null => {
    // Don't exceed concurrency limit
    const running = sessionsRef.current.filter((s) => s.status !== "done" && s.status !== "failed");
    if (running.length >= MAX_CONCURRENT) return null;

    // Don't start a task that already has a session
    const slug = slugify(`${task.id}-${task.title}`);
    if (sessionsRef.current.some((s) => s.name === slug)) return null;

    const wtPath = ensureWorktree(slug);

    task.status = "active";
    task.branch = slug;
    task.startedAt = new Date().toISOString();
    saveBacklog(backlog);

    const session = new Session({
      name: slug,
      section: { id: task.id, title: task.title, unchecked: task.items.filter((i) => !i.done).map((i) => i.text) },
      worktreePath: wtPath,
      prompt: buildPrompt(task),
    });
    session.start();
    setSessions((prev) => [...prev, session]);
    return session;
  }, [backlog]);

  // --- Auto-start: fill available concurrency ---
  useEffect(() => {
    if (!autoStart) return;

    const allSessions = sessionsRef.current;
    const runningSessions = allSessions.filter((s) => s.status !== "done" && s.status !== "failed");
    if (runningSessions.length >= MAX_CONCURRENT) return;

    // Don't start tasks that already have a session (any state — running, done, or failed).
    // This prevents re-starting tasks whose sessions failed immediately.
    const sessionSlugs = new Set(allSessions.map((s) => s.name));
    const next = backlog.tasks.find(
      (t) => t.status === "pending" && !sessionSlugs.has(slugify(`${t.id}-${t.title}`)),
    );
    if (next) {
      startTask(next);
    }
  }, [autoStart, sessions, backlog, startTask]);

  // --- Global keys ---
  useInput((input, key) => {
    if (view === "session") return;
    if (modalActive) return;

    if (input === "q") process.exit(0);

    // Toggle auto-start
    if (input === "S") {
      setAutoStart((a) => !a);
      return;
    }

    // Focus a session by number (F1, F2... or just number when sessions exist)
    // Use 'v' + number to view session
    if (input === "v") {
      // Next keypress will be the session number — handled in a follow-up
      // For now, focus session 0
      if (sessions.length > 0) {
        setFocusedSession(0);
        setView("session");
      }
    }
  });

  // Session detail
  if (view === "session" && sessions[focusedSession]) {
    return (
      <SessionDetail
        session={sessions[focusedSession]}
        onBack={() => setView("main")}
        rows={rows}
      />
    );
  }

  // --- Main unified view ---
  const activeSessions = sessions.filter((s) => s.status !== "done" && s.status !== "failed");
  const contentRows = rows - 4; // header (2) + help bar (2)

  return (
    <Box flexDirection="column" height={rows}>
      {/* Header */}
      <Box paddingX={2} marginBottom={1}>
        <Text bold>aflow</Text>
        <Text dimColor>  {backlog.tasks.length} tasks</Text>
        <Text>  </Text>
        {autoStart ? (
          <Text color="green" bold>auto: ON ({activeSessions.length}/{MAX_CONCURRENT})</Text>
        ) : (
          <Text dimColor>auto: off</Text>
        )}
      </Box>

      {/* Side-by-side: Backlog (left) | Sessions (right) */}
      <Box flexGrow={1} height={contentRows}>
        {/* Left panel: Backlog */}
        <Box flexDirection="column" width="50%">
          <Box paddingX={2} marginBottom={1}>
            <Text bold dimColor>backlog</Text>
            <Text dimColor>  {backlog.tasks.length} task(s)</Text>
          </Box>
          <BacklogView
            backlog={backlog}
            rows={contentRows - 2}
            onStartTask={(task) => { startTask(task); refresh(); }}
            onRefresh={() => { setBacklog(loadBacklog()); refresh(); }}
            onModalChange={setModalActive}
            onViewSession={(sessionIndex) => { setFocusedSession(sessionIndex); setView("session"); }}
            sessions={sessions}
          />
        </Box>

        {/* Divider */}
        <Box flexDirection="column" width={1}>
          <Text dimColor>│</Text>
        </Box>

        {/* Right panel: Active sessions */}
        <Box flexDirection="column" width="50%">
          <Box paddingX={1} marginBottom={1}>
            <Text bold dimColor>sessions</Text>
            <Text dimColor>  {activeSessions.length} active</Text>
          </Box>
          {activeSessions.length === 0 ? (
            <Box paddingX={1}>
              <Text dimColor>No active sessions</Text>
            </Box>
          ) : (
            <Box flexDirection="column" paddingX={1}>
              {activeSessions.map((s, i) => {
                const last = s.streamingText || s.messages[s.messages.length - 1]?.text || "";
                return (
                  <Box key={`sm-${i}`} flexDirection="column" marginBottom={1}>
                    <Box>
                      <Text color={statusColor(s.status)}>{statusIcon(s.status)} </Text>
                      <Text bold>{s.name}</Text>
                    </Box>
                    <Box paddingLeft={2}>
                      <Text dimColor>
                        {formatCost(s.cost) || "-"} cost
                        {"  "}
                        {formatTokens(s.inputTokens)} in / {formatTokens(s.outputTokens)} out
                        {"  "}
                        {s.turns > 0 ? `${s.turns} turns` : ""}
                      </Text>
                    </Box>
                    <Box paddingLeft={2}>
                      <Text dimColor wrap="truncate">{truncate(last.replace(/\n/g, " "), 50)}</Text>
                    </Box>
                  </Box>
                );
              })}
            </Box>
          )}
        </Box>
      </Box>

      {/* Help bar */}
      <Box paddingX={2}>
        <Text dimColor>
          [enter] start/view  [a] add  [e] edit  [d] delete  [x] kill  [J/K] reorder  [v] view  [S] auto  [r] refresh  [q] quit
        </Text>
      </Box>
    </Box>
  );
}

// --- Public API ---

export class App {
  start() {
    render(<AppRoot />, { fullscreen: true });
  }
}
