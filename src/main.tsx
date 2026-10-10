import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowUp,
  ArrowUpRight,
  Archive,
  Check,
  CheckCheck,
  ChevronRight,
  Circle,
  CircleHelp,
  Clock3,
  Download,
  FileText,
  Folder,
  FolderOpen,
  Layers3,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  Unplug,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import Markdown from 'react-markdown';
import type { AppState, Approval, Session, Workspace } from './types';
import './style.css';
const empty: AppState = {
  workspaces: [],
  sessions: [],
  config: { routerUrl: 'http://127.0.0.1:4000/v1', decisionModel: 'router' },
  codexConnected: false,
};
const active = (s: Session) =>
  ['routing', 'running', 'waiting'].includes(s.status);
const labels: Record<string, string> = {
  routing: 'Choosing workspace',
  running: 'Working',
  waiting: 'Needs your input',
  completed: 'Completed',
  failed: 'Failed',
  interrupted: 'Stopped',
};
function Orbit({ small = false }: { small?: boolean }) {
  return (
    <span className={`orbit ${small ? 'small' : ''}`}>
      <span />
      <i />
    </span>
  );
}
function App() {
  const [state, setState] = useState<AppState>(empty);
  const [connection, setConnection] = useState(() => ({
    url: localStorage.getItem('orbit-url') || 'http://127.0.0.1:4317',
    token: sessionStorage.getItem('orbit-token') || '',
  }));
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState('home');
  const [selected, setSelected] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [install, setInstall] = useState<any>(null);
  const [showActivity, setShowActivity] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [workspaceFilter, setWorkspaceFilter] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const session = state.sessions.find((s) => s.id === selected);
  async function api(
    path: string,
    method = 'GET',
    body?: unknown,
    pair = connection,
  ) {
    const response = await fetch(`${pair.url.replace(/\/$/, '')}/api${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${pair.token}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(40000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }
  async function action(path: string, method: string, body?: unknown) {
    try {
      setError('');
      return await api(path, method, body);
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }
  useEffect(() => {
    if (!connection.token) return;
    let cancelled = false,
      socket: WebSocket | undefined,
      timer: ReturnType<typeof setTimeout>;
    async function connect() {
      try {
        const next = await api('/state');
        if (cancelled) return;
        setState(next);
        setConnected(true);
        const url = new URL(connection.url);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        url.pathname = '/events';
        socket = new WebSocket(url);
        socket.onopen = () =>
          socket?.send(JSON.stringify({ token: connection.token }));
        socket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'state') setState(data.state);
          } catch {
            /* ignore malformed event */
          }
        };
        socket.onclose = () => {
          if (!cancelled) {
            setConnected(false);
            timer = setTimeout(connect, 3000);
          }
        };
        socket.onerror = () => socket?.close();
      } catch {
        if (!cancelled) {
          setConnected(false);
          timer = setTimeout(connect, 5000);
        }
      }
    }
    void connect();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, [connection]);
  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      setInstall(event);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [session?.messages.length, session?.status, selected]);
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!message.trim() || sending) return;
    setSending(true);
    const result = await action(
      session ? `/sessions/${session.id}/message` : '/sessions',
      'POST',
      { message },
    );
    if (result) {
      setSelected(result.id);
      setView('home');
      setMessage('');
      setWorkspaceFilter(null);
    }
    setSending(false);
  }
  function newTask() {
    setSelected(null);
    setView('home');
    setMessage('');
    setWorkspaceFilter(null);
  }
  const sessions = state.sessions
    .filter((s) => s.archived === (view === 'archive'))
    .filter((s) => !workspaceFilter || s.workspaceId === workspaceFilter)
    .filter((s) =>
      `${s.title} ${s.workspaceName || ''}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
  const running = state.sessions.filter((s) => !s.archived && active(s)).length;
  return (
    <div className="app">
      <aside className="sidebar">
        <button className="brand" onClick={newTask}>
          <Orbit />
          <span>
            orbit<span className="brand-caption">CODEX ORCHESTRATOR</span>
          </span>
        </button>
        <button className="primary new-task" onClick={newTask}>
          <Plus size={17} /> New task <kbd>↗</kbd>
        </button>
        <div className="nav-label">YOUR SPACE</div>
        <button
          className={`nav ${view === 'home' && !workspaceFilter ? 'chosen' : ''}`}
          onClick={() => {
            setView('home');
            setSelected(null);
            setWorkspaceFilter(null);
          }}
        >
          <Layers3 size={17} /> Overview{' '}
          <span>{state.sessions.filter((s) => !s.archived).length}</span>
        </button>
        <button
          className={`nav ${view === 'workspaces' ? 'chosen' : ''}`}
          onClick={() => {
            setView('workspaces');
            setSelected(null);
          }}
        >
          <FolderOpen size={17} /> Workspaces{' '}
          <span>{state.workspaces.length}</span>
        </button>
        <button
          className={`nav ${view === 'archive' ? 'chosen' : ''}`}
          onClick={() => {
            setView('archive');
            setSelected(null);
            setWorkspaceFilter(null);
          }}
        >
          <Archive size={17} /> Archived
        </button>
        <div className="nav-label workspace-label">
          WORKSPACES{' '}
          <button
            className="icon"
            aria-label="Add workspace"
            onClick={() => (connected ? setAdding(true) : setSettings(true))}
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="workspace-nav">
          {state.workspaces.map((w, i) => (
            <button
              key={w.id}
              className={`nav ${workspaceFilter === w.id ? 'chosen' : ''}`}
              onClick={() => {
                setWorkspaceFilter(w.id);
                setView('home');
                setSelected(null);
              }}
            >
              <span className={`folder-dot tone-${i % 4}`} />
              {w.name}
              <ChevronRight size={14} />
            </button>
          ))}
          {!state.workspaces.length && (
            <p className="sidebar-hint">
              Add your workspaces once.
              <br />
              Orbit finds the right one.
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className={`connection-dot ${connected ? 'online' : ''}`} />
            <div>
              <strong>
                {connected
                  ? 'Local companion connected'
                  : 'Connect your local companion'}
              </strong>
              <span>
                {connected
                  ? 'Your work stays on your computer'
                  : 'Pair once to start working'}
              </span>
            </div>
          </div>
          <button className="nav" onClick={() => setSettings(true)}>
            <Settings2 size={17} /> Settings <ChevronRight size={14} />
          </button>
          {install && (
            <button
              className="nav"
              onClick={async () => {
                await install.prompt();
                setInstall(null);
              }}
            >
              <Download size={17} /> Install Orbit
            </button>
          )}
          <div className="sidebar-footer">
            Built around your work <span>v0.1</span>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <span className="breadcrumb">Your space</span>
            <ChevronRight size={13} />
            <strong>
              {session
                ? 'Session'
                : view === 'workspaces'
                  ? 'Workspaces'
                  : view === 'archive'
                    ? 'Archive'
                    : workspaceFilter
                      ? state.workspaces.find((w) => w.id === workspaceFilter)
                          ?.name
                      : 'Overview'}
            </strong>
          </div>
          <div>
            <span className="local-pill">
              <span className={`connection-dot ${connected ? 'online' : ''}`} />
              {connected ? 'Local connected' : 'Not connected'}
            </span>
            <button
              className="icon"
              aria-label="Connection settings"
              onClick={() => setSettings(true)}
            >
              <Settings2 size={18} />
            </button>
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button
              className="icon"
              aria-label="Dismiss error"
              onClick={() => setError('')}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className={`content ${session ? 'session-content' : ''}`}>
          {session ? (
            <>
              <div className="session-heading">
                <div>
                  <div className="eyebrow">
                    {session.workspaceName || 'AUTOMATIC ROUTING'}
                  </div>
                  <h1>{session.title}</h1>
                  <div className="session-meta">
                    <Status session={session} />
                    {session.threadId && (
                      <span title={session.threadId}>
                        Codex session · {session.threadId.slice(0, 8)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="heading-actions">
                  <button
                    className="icon"
                    aria-label="Rename session"
                    onClick={() => {
                      setName(session.title);
                      setRenaming(true);
                    }}
                  >
                    <MoreHorizontal size={20} />
                  </button>
                  {active(session) ? (
                    <button
                      className="secondary"
                      onClick={() =>
                        action(`/sessions/${session.id}/interrupt`, 'POST', {})
                      }
                    >
                      <Square size={14} /> Stop
                    </button>
                  ) : (
                    <button
                      className="secondary"
                      onClick={() =>
                        action(`/sessions/${session.id}`, 'PATCH', {
                          archived: !session.archived,
                        })
                      }
                    >
                      <Archive size={15} />
                      {session.archived ? 'Restore' : 'Archive'}
                    </button>
                  )}
                </div>
              </div>
              <div className="conversation">
                {session.messages.map((m) => (
                  <div className={`message ${m.role}`} key={m.id}>
                    <div className="message-avatar">
                      {m.role === 'user' ? 'You' : <Orbit small />}
                    </div>
                    <div className="message-body">
                      <div className="message-label">
                        {m.role === 'user' ? 'You' : 'Codex'}
                      </div>
                      {m.role === 'user' ? (
                        <p>{m.text}</p>
                      ) : (
                        <Markdown>{m.text}</Markdown>
                      )}
                    </div>
                  </div>
                ))}
                {session.status === 'routing' && (
                  <div className="working">
                    <Loader2 size={17} className="spin" /> Reading workspace
                    context and choosing a model…
                  </div>
                )}
                {session.status === 'running' && (
                  <div className="working">
                    <Loader2 size={17} className="spin" /> Codex is working in{' '}
                    {session.workspaceName}…
                  </div>
                )}
                {session.error && (
                  <div className="session-error" role="alert">
                    {session.error}
                  </div>
                )}
                {session.approvals.map((a) => (
                  <ApprovalCard
                    key={a.id}
                    approval={a}
                    respond={(body) =>
                      action(`/sessions/${session.id}/approval`, 'POST', body)
                    }
                  />
                ))}
                <div ref={end} />
              </div>
              {(session.activity.length > 0 || session.diff) && (
                <details
                  className="activity"
                  open={showActivity}
                  onToggle={(e) => setShowActivity(e.currentTarget.open)}
                >
                  <summary>
                    <Terminal size={15} /> Activity & changes{' '}
                    <span>{session.activity.length} items</span>
                  </summary>
                  {session.activity.map((item) => (
                    <div key={item.id} className="activity-item">
                      <strong>{item.type.replace(/([A-Z])/g, ' $1')}</strong>
                      <span>{item.status}</span>
                      {item.command && <pre>{item.command}</pre>}
                      {item.output && <pre>{item.output}</pre>}
                      {item.changes?.map((change) => (
                        <div key={change.path}>
                          <code>{change.path}</code>
                          <pre>{change.diff}</pre>
                        </div>
                      ))}
                    </div>
                  ))}
                  {session.diff && <pre>{session.diff}</pre>}
                </details>
              )}
              {!session.archived && (
                <Composer
                  message={message}
                  setMessage={setMessage}
                  onSubmit={send}
                  disabled={!connected || active(session) || sending}
                  session
                />
              )}
              <div className="decisions-panel">
                <div className="panel-heading">
                  <Workflow size={17} />
                  <strong>Routing decisions</strong>
                  <span>Visible at every turn</span>
                </div>
                {session.decisions.length ? (
                  session.decisions.map((d, i) => (
                    <div key={d.decidedAt} className="decision">
                      <div className="decision-title">
                        <span className="decision-number">{i + 1}</span>
                        <strong>{d.workspaceName}</strong>
                        <ChevronRight size={14} />
                        <span>{d.model}</span>
                        <span className="confidence">
                          {Math.round(d.confidence * 100)}% confidence
                        </span>
                      </div>
                      <p>{d.reason}</p>
                      <div className="decision-meta">
                        <span>{d.effort} effort</span>
                        <span>Decided by {d.decisionModel}</span>
                        <span>{(d.durationMs / 1000).toFixed(1)}s</span>
                        <span>
                          {d.sources.length
                            ? `Read ${d.sources.join(' + ')}`
                            : 'No root context files'}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="muted">
                    The workspace and model choice will appear here before Codex
                    starts.
                  </p>
                )}
              </div>
            </>
          ) : view === 'workspaces' ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">CONTEXT FOR BETTER DECISIONS</div>
                  <h1>Your workspaces</h1>
                  <p>
                    Tell Orbit where your work lives. It takes care of the
                    routing.
                  </p>
                </div>
                <button
                  className="primary"
                  onClick={() =>
                    connected ? setAdding(true) : setSettings(true)
                  }
                >
                  <Plus size={16} /> Add workspace
                </button>
              </div>
              <div className="workspace-grid">
                {state.workspaces.map((w, i) => (
                  <WorkspaceCard
                    key={w.id}
                    workspace={w}
                    index={i}
                    action={action}
                  />
                ))}
                {!state.workspaces.length && (
                  <div className="empty-workspace">
                    <FolderOpen size={36} />
                    <h2>A little context goes a long way.</h2>
                    <p>
                      Add a local folder. Its README and AGENTS.md help Orbit
                      understand what belongs there.
                    </p>
                    <button
                      className="secondary"
                      onClick={() =>
                        connected ? setAdding(true) : setSettings(true)
                      }
                    >
                      Add your first workspace <ArrowUpRight size={16} />
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {view === 'archive'
                      ? 'SAVED FOR LATER'
                      : 'LESS SETUP. MORE DOING.'}
                  </div>
                  <h1>
                    {view === 'archive'
                      ? 'Archived sessions'
                      : workspaceFilter
                        ? state.workspaces.find((w) => w.id === workspaceFilter)
                            ?.name
                        : 'What are we working on?'}
                  </h1>
                  <p>
                    {view === 'archive'
                      ? 'Your past work, ready to pick up again.'
                      : 'Describe the outcome. Orbit finds the workspace and model.'}
                  </p>
                </div>
                <span className="date-label">
                  {new Intl.DateTimeFormat(undefined, {
                    month: 'short',
                    day: 'numeric',
                  }).format(new Date())}
                </span>
              </div>
              {view !== 'archive' && (
                <>
                  <Composer
                    message={message}
                    setMessage={setMessage}
                    onSubmit={send}
                    disabled={!connected || !state.workspaces.length || sending}
                  />
                  {!connected && (
                    <div className="setup-strip">
                      <span className="setup-icon">
                        <Unplug size={19} />
                      </span>
                      <div>
                        <strong>
                          Your local workspace, one connection away.
                        </strong>
                        <span>
                          Start the companion on your computer, then pair it
                          with Orbit.
                        </span>
                      </div>
                      <button
                        className="secondary"
                        onClick={() => setSettings(true)}
                      >
                        Connect companion <ArrowUpRight size={15} />
                      </button>
                    </div>
                  )}
                  {connected && !state.workspaces.length && (
                    <div className="setup-strip">
                      <span className="setup-icon">
                        <FolderOpen size={19} />
                      </span>
                      <div>
                        <strong>Add your first workspace.</strong>
                        <span>
                          Orbit reads its README and AGENTS.md to understand the
                          project.
                        </span>
                      </div>
                      <button
                        className="secondary"
                        onClick={() => setAdding(true)}
                      >
                        Add workspace <Plus size={15} />
                      </button>
                    </div>
                  )}
                  <div className="stats">
                    <div>
                      <span>
                        <Folder size={16} /> Workspaces
                      </span>
                      <strong>
                        {state.workspaces.length}
                        <small>ready for routing</small>
                      </strong>
                    </div>
                    <div>
                      <span>
                        <Zap size={16} /> In progress
                      </span>
                      <strong>
                        {running}
                        <small>sessions working</small>
                      </strong>
                    </div>
                    <div>
                      <span>
                        <CheckCheck size={16} /> Completed
                      </span>
                      <strong>
                        {
                          state.sessions.filter((s) => s.status === 'completed')
                            .length
                        }
                        <small>outcomes delivered</small>
                      </strong>
                    </div>
                  </div>
                </>
              )}
              <div className="section-heading">
                <h2>
                  {workspaceFilter ? 'Workspace sessions' : 'Sessions'}
                  <span>{sessions.length}</span>
                </h2>
                <label className="search">
                  <Search size={15} />
                  <input
                    aria-label="Search sessions"
                    placeholder="Find a session…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
              </div>
              <div className="session-list">
                {sessions.map((s) => (
                  <button
                    className="session-row"
                    key={s.id}
                    onClick={() => {
                      setSelected(s.id);
                      setMessage('');
                    }}
                  >
                    <span
                      className={`session-icon ${s.status === 'completed' ? 'success' : ''}`}
                    >
                      {s.status === 'completed' ? (
                        <Check size={19} />
                      ) : (
                        <MessageSquare size={18} />
                      )}
                    </span>
                    <span className="session-row-main">
                      <strong>{s.title}</strong>
                      <span>
                        {s.workspaceName || 'Finding the right workspace'}
                        {s.decisions.at(-1) && (
                          <>
                            {' '}
                            <i>·</i> {s.decisions.at(-1)?.model}
                          </>
                        )}
                      </span>
                    </span>
                    <Status session={s} />
                    <span className="session-date">
                      {new Date(s.updatedAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                    <ChevronRight size={17} />
                  </button>
                ))}
                {!sessions.length && (
                  <div className="empty-sessions">
                    <span className="empty-symbol">
                      <Layers3 size={25} />
                    </span>
                    <h3>
                      {search
                        ? 'No matching sessions'
                        : view === 'archive'
                          ? 'Nothing archived yet'
                          : 'Good work starts with a message.'}
                    </h3>
                    <p>
                      {search
                        ? 'Try a different title or workspace name.'
                        : view === 'archive'
                          ? 'Archived sessions will live here.'
                          : 'Your sessions and their results will appear here.'}
                    </p>
                  </div>
                )}
              </div>
              {view !== 'archive' && (
                <div className="how-it-works">
                  <div>
                    <Sparkles size={17} />
                    <strong>A thoughtful route to the right result.</strong>
                  </div>
                  <span>
                    <span>01</span> Understand your task{' '}
                    <ChevronRight size={13} /> <span>02</span> Choose workspace
                    & model <ChevronRight size={13} /> <span>03</span> Work
                    locally with Codex
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </main>
      {settings && (
        <SettingsModal
          connection={connection}
          config={state.config}
          close={() => setSettings(false)}
          pair={async (value) => {
            const url = new URL(value.url);
            if (
              !['http:', 'https:'].includes(url.protocol) ||
              !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
            )
              throw new Error(
                'Use the loopback URL printed by your local companion.',
              );
            const next = await api('/state', 'GET', undefined, value);
            localStorage.setItem('orbit-url', value.url);
            sessionStorage.setItem('orbit-token', value.token);
            setConnection(value);
            setState(next);
            setConnected(true);
          }}
          save={async (config) => {
            const next = await api('/config', 'PATCH', config);
            setState(next);
          }}
          disconnect={() => {
            sessionStorage.removeItem('orbit-token');
            setConnection({ ...connection, token: '' });
            setConnected(false);
            setState(empty);
            setSelected(null);
          }}
        />
      )}
      {adding && (
        <AddWorkspace
          close={() => setAdding(false)}
          add={async (value) => {
            await api('/workspaces', 'POST', value);
          }}
        />
      )}
      {renaming && session && (
        <Modal title="Rename session" close={() => setRenaming(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await action(`/sessions/${session.id}`, 'PATCH', {
                  title: name,
                })
              )
                setRenaming(false);
            }}
          >
            <label>
              Session name
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
            <button className="primary full">Save name</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
function Status({ session }: { session: Session }) {
  return (
    <span className={`status ${session.status}`}>
      {session.status === 'completed' ? (
        <Check size={12} />
      ) : session.status === 'running' || session.status === 'routing' ? (
        <Loader2 size={12} className="spin" />
      ) : session.status === 'waiting' ? (
        <CircleHelp size={12} />
      ) : (
        <Circle size={7} />
      )}{' '}
      {labels[session.status] || session.status}
    </span>
  );
}
function Composer({
  message,
  setMessage,
  onSubmit,
  disabled,
  session = false,
}: {
  message: string;
  setMessage: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  disabled: boolean;
  session?: boolean;
}) {
  return (
    <form className="composer" onSubmit={onSubmit}>
      <textarea
        aria-label={session ? 'Follow-up message' : 'New task'}
        value={message}
        maxLength={16000}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={
          session
            ? 'Continue the conversation…'
            : 'Fix a bug, explore an idea, build something new…'
        }
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSubmit(e);
          }
        }}
      />
      <div className="composer-bottom">
        <span className="routing-pill">
          <Sparkles size={14} />
          {session
            ? 'Workspace retained · model chosen automatically'
            : 'Workspace & model chosen automatically'}
        </span>
        <div>
          <kbd>⌘ / Ctrl ↵</kbd>
          <button
            className="send"
            disabled={disabled || !message.trim()}
            aria-label="Send task"
          >
            <ArrowUp size={18} />
          </button>
        </div>
      </div>
    </form>
  );
}
function WorkspaceCard({
  workspace: w,
  index,
  action,
}: {
  workspace: Workspace;
  index: number;
  action: (p: string, m: string, b?: unknown) => Promise<any>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [remove, setRemove] = useState(false);
  return (
    <div className="workspace-card">
      <div className="workspace-card-top">
        <span className={`workspace-folder tone-${index % 4}`}>
          <FolderOpen size={22} />
        </span>
        <div>
          <button
            className="icon"
            aria-label={`Refresh ${w.name}`}
            onClick={() => action(`/workspaces/${w.id}/refresh`, 'POST', {})}
          >
            <RefreshCw size={15} />
          </button>
          <button
            className="icon"
            aria-label={`Remove ${w.name}`}
            onClick={() => setRemove(true)}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      <h2>{w.name}</h2>
      <p className="workspace-path">{w.path}</p>
      <div className="context-files">
        {w.documents.map((d) => (
          <span key={d.name}>
            <FileText size={13} />
            {d.name}
          </span>
        ))}
        {!w.documents.length && <span>No root README or AGENTS.md found</span>}
      </div>
      <button className="text-button" onClick={() => setExpanded(!expanded)}>
        {expanded ? 'Hide routing context' : 'View routing context'}
        <ChevronRight size={14} />
      </button>
      {expanded &&
        w.documents.map((d) => (
          <details key={d.name} open>
            <summary>{d.name}</summary>
            <pre>{d.text}</pre>
          </details>
        ))}
      {remove && (
        <div className="remove-confirm">
          <p>
            Remove this workspace from routing? Files and sessions stay on your
            computer.
          </p>
          <button className="secondary" onClick={() => setRemove(false)}>
            Cancel
          </button>
          <button
            className="danger"
            onClick={() => action(`/workspaces/${w.id}`, 'DELETE')}
          >
            Remove
          </button>
        </div>
      )}
      <div className="workspace-card-footer">
        <span className="connection-dot online" /> Context refreshed{' '}
        {new Date(w.indexedAt).toLocaleDateString()}
      </div>
    </div>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const elements = () =>
      Array.from(
        box.current?.querySelectorAll<HTMLElement>(
          'button,input,textarea,select,a[href]',
        ) || [],
      ).filter((e) => !e.hasAttribute('disabled'));
    elements()[0]?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab') {
        const all = elements();
        const first = all[0],
          last = all.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={box}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="modal-heading">
          <h2 id="modal-title">{title}</h2>
          <button className="icon" aria-label="Close dialog" onClick={close}>
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function AddWorkspace({
  close,
  add,
}: {
  close: () => void;
  add: (v: { name: string; path: string }) => Promise<void>;
}) {
  const [name, setName] = useState(''),
    [path, setPath] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="Add a workspace" close={close}>
      <p className="modal-description">
        Choose a folder on the computer running your companion. Orbit reads its
        root README and AGENTS.md to route future tasks.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await add({ name, path });
            close();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Workspace name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Personal website"
          />
        </label>
        <label>
          Absolute folder path
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/home/you/projects/website"
            required
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary full" disabled={busy}>
          {busy ? (
            <Loader2 className="spin" size={16} />
          ) : (
            <FolderOpen size={16} />
          )}{' '}
          Read context & add workspace
        </button>
      </form>
    </Modal>
  );
}
function SettingsModal({
  connection,
  config,
  close,
  pair,
  save,
  disconnect,
}: {
  connection: { url: string; token: string };
  config: AppState['config'];
  close: () => void;
  pair: (v: { url: string; token: string }) => Promise<void>;
  save: (v: AppState['config']) => Promise<void>;
  disconnect: () => void;
}) {
  const [url, setUrl] = useState(connection.url),
    [token, setToken] = useState(connection.token),
    [routerUrl, setRouterUrl] = useState(config.routerUrl),
    [decisionModel, setDecisionModel] = useState(config.decisionModel),
    [error, setError] = useState(''),
    [note, setNote] = useState(''),
    [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<void>, success: string) {
    setError('');
    setNote('');
    setBusy(true);
    try {
      await fn();
      setNote(success);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Settings" close={close}>
      <div className="settings-section">
        <div className="settings-title">
          <Unplug size={18} />
          <h3>Local companion</h3>
        </div>
        <p className="modal-description">
          Run <code>npm run bridge</code> from this repository on your computer.
          Copy the pairing token from the terminal.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () => pair({ url, token }),
              'Companion connected. You can add workspaces now.',
            );
          }}
        >
          <label>
            Companion URL
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
          </label>
          <label>
            Pairing token
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
              placeholder="Paste from your local terminal"
            />
          </label>
          <button className="primary full" disabled={busy}>
            Connect companion <ArrowUpRight size={16} />
          </button>
        </form>
        <p className="field-hint">
          The token stays in this browser tab. Allow local network access if
          your browser asks.
        </p>
      </div>
      <div className="settings-section">
        <div className="settings-title">
          <Workflow size={18} />
          <h3>Decision routing</h3>
        </div>
        <p className="modal-description">
          Use your local LiteLLM router to choose a workspace and a Codex model.
          Provider keys belong in the companion’s .env file.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () => save({ routerUrl, decisionModel }),
              'Routing settings saved.',
            );
          }}
        >
          <label>
            LiteLLM base URL
            <input
              type="url"
              value={routerUrl}
              onChange={(e) => setRouterUrl(e.target.value)}
              required
            />
          </label>
          <label>
            Decision model alias
            <input
              value={decisionModel}
              onChange={(e) => setDecisionModel(e.target.value)}
              placeholder="router"
              required
            />
          </label>
          <button
            className="secondary full"
            disabled={busy || !connection.token}
          >
            Save routing settings
          </button>
        </form>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {note && (
        <p className="form-success" role="status">
          {note}
        </p>
      )}
      {connection.token && (
        <button
          className="text-button"
          onClick={() => {
            disconnect();
            close();
          }}
        >
          Disconnect this browser
        </button>
      )}
    </Modal>
  );
}
function ApprovalCard({
  approval: a,
  respond,
}: {
  approval: Approval;
  respond: (v: unknown) => Promise<any>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false);
  async function answer(value: unknown) {
    setBusy(true);
    await respond(value);
    setBusy(false);
  }
  return (
    <div className="approval-card">
      <div>
        <CircleHelp size={18} />
        <strong>
          {a.method === 'item/tool/requestUserInput'
            ? 'Codex needs your input'
            : 'Approval requested'}
        </strong>
      </div>
      {a.params.reason && <p>{a.params.reason}</p>}
      {a.params.command && <pre>{a.params.command}</pre>}
      {a.params.networkApprovalContext && (
        <p>
          Network access: {a.params.networkApprovalContext.protocol}://
          {a.params.networkApprovalContext.host}
        </p>
      )}
      {a.params.questions?.map((q) => (
        <label key={q.id}>
          {q.question}
          {q.options?.length ? (
            <select
              value={answers[q.id] || ''}
              onChange={(e) =>
                setAnswers({ ...answers, [q.id]: e.target.value })
              }
            >
              <option value="">Choose an answer…</option>
              {q.options.map((o) => (
                <option key={o.label} value={o.label}>
                  {o.label} — {o.description}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={q.isSecret ? 'password' : 'text'}
              value={answers[q.id] || ''}
              onChange={(e) =>
                setAnswers({ ...answers, [q.id]: e.target.value })
              }
            />
          )}
        </label>
      ))}
      <div className="approval-actions">
        {a.params.questions ? (
          <button
            disabled={busy}
            className="primary"
            onClick={() => answer({ id: a.id, answers })}
          >
            Send answers
          </button>
        ) : (
          <>
            {(!a.params.availableDecisions ||
              a.params.availableDecisions.includes('decline')) && (
              <button
                disabled={busy}
                className="secondary"
                onClick={() => answer({ id: a.id, decision: 'decline' })}
              >
                Decline
              </button>
            )}
            {(!a.params.availableDecisions ||
              a.params.availableDecisions.includes('accept')) && (
              <button
                disabled={busy}
                className="primary"
                onClick={() => answer({ id: a.id, decision: 'accept' })}
              >
                Approve once
              </button>
            )}
            <button
              disabled={busy}
              className="secondary"
              onClick={() => answer({ id: a.id, decision: 'cancel' })}
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
if ('serviceWorker' in navigator && import.meta.env.PROD)
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(console.error);
  });
