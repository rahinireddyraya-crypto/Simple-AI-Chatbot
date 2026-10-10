import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { ArrowDown, ArrowUp, Plus, Sparkles } from 'lucide-react';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

const suggestions = [
  { label: 'Make a tricky idea simple', prompt: 'Can you explain compound interest in a simple, everyday way?' },
  { label: 'Find a fresh perspective', prompt: 'What is a small habit that can make a big difference over time?' },
  { label: 'Help me get started', prompt: 'I want to learn a new skill but feel overwhelmed. How should I begin?' },
];

function makeId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isClearingHistory, setIsClearingHistory] = useState(false);
  const [serviceMessage, setServiceMessage] = useState('');
  const [requestError, setRequestError] = useState('');
  const [databaseMessage, setDatabaseMessage] = useState('');
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const hasConversation = messages.length > 0;

  useEffect(() => {
    let cancelled = false;
    const loadHistory = async () => {
      try {
        const response = await fetch('/api/chat/history', {
          credentials: 'include',
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(
            typeof payload?.error === 'string'
              ? payload.error
              : 'Chat history could not be loaded.',
          );
        }
        if (!cancelled) {
          const loadedMessages = Array.isArray(payload?.messages)
            ? payload.messages.filter((message: unknown): message is Message =>
                typeof message === 'object' &&
                message !== null &&
                ((message as Message).role === 'user' ||
                  (message as Message).role === 'assistant') &&
                typeof (message as Message).content === 'string',
              ).map((message: Message) => ({ ...message, id: makeId() }))
            : [];
          setMessages(loadedMessages);
          setDatabaseMessage('');
        }
      } catch (error) {
        if (!cancelled) {
          setDatabaseMessage(
            error instanceof Error
              ? error.message
              : 'Chat history could not be loaded.',
          );
        }
      } finally {
        if (!cancelled) setIsLoadingHistory(false);
      }
    };
    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isStreaming, serviceMessage, requestError]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const startNewChat = async () => {
    if (isLoadingHistory || isClearingHistory) return;
    setIsClearingHistory(true);
    setDatabaseMessage('');
    try {
      const response = await fetch('/api/chat/history', {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          typeof payload?.error === 'string'
            ? payload.error
            : 'The saved chat could not be cleared.',
        );
      }
      controllerRef.current?.abort();
      controllerRef.current = null;
      setMessages([]);
      setDraft('');
      setIsStreaming(false);
      setServiceMessage('');
      setRequestError('');
      composerRef.current?.focus();
    } catch (error) {
      setDatabaseMessage(
        error instanceof Error
          ? error.message
          : 'The saved chat could not be cleared.',
      );
    } finally {
      setIsClearingHistory(false);
    }
  };

  const sendMessage = async (rawContent: string) => {
    if (isLoadingHistory || isClearingHistory) return;
    const content = rawContent.trim();
    if (!content || isStreaming) return;

    const userMessage: Message = { id: makeId(), role: 'user', content };
    const assistantMessage: Message = { id: makeId(), role: 'assistant', content: '' };
    const nextMessages = [...messages, userMessage];
    setMessages([...nextMessages, assistantMessage]);
    setDraft('');
    setServiceMessage('');
    setRequestError('');
    setDatabaseMessage('');
    setIsStreaming(true);

    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const response = await fetch('/api/gemini/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify({
          messages: nextMessages.slice(-40).map(({ role, content: messageContent }) => ({
            role,
            content: messageContent,
          })),
        }),
      });

      if (!response.ok) {
        let detail = '';
        try {
          const payload = await response.json();
          detail = typeof payload?.error === 'string'
            ? payload.error
            : typeof payload?.message === 'string'
              ? payload.message
              : '';
        } catch {
          detail = '';
        }
        setMessages(nextMessages);
        if (response.status === 503) {
          setServiceMessage(detail || 'The chat service is not available yet. Please try again later.');
        } else {
          setRequestError(detail || 'That message could not be sent. Please try again.');
        }
        return;
      }

      if (!response.body) throw new Error('The response stream was unavailable.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamFinished = false;

      const handleEvent = (eventText: string) => {
        const data = eventText
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n');
        if (!data) return;
        try {
          const event = JSON.parse(data) as {
            content?: unknown;
            done?: unknown;
            error?: unknown;
          };
          if (event.done === true) {
            streamFinished = true;
            return;
          }
          if (typeof event.error === 'string') {
            setRequestError(event.error);
            streamFinished = true;
            return;
          }
          if (typeof event.content === 'string') {
            setMessages((current) => current.map((message) =>
              message.id === assistantMessage.id
                ? { ...message, content: message.content + event.content }
                : message,
            ));
          }
        } catch {
          // Ignore malformed event frames while keeping the stream alive.
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? '';
        frames.forEach(handleEvent);
        if (done) break;
      }
      if (buffer.trim()) handleEvent(buffer);
      if (!streamFinished) {
        setRequestError('The reply ended before it was complete. You can try again.');
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        setMessages((current) => current.filter((message) => message.id !== assistantMessage.id));
        setRequestError(error instanceof Error ? error.message : 'Something went wrong. Please try again.');
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setIsStreaming(false);
    }
  };

  /*
   * Chat history is loaded before the composer becomes active, so outgoing
   * requests always include the complete saved context.
   */
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendMessage(draft);
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(draft);
    }
  };

  return (
    <main className="grain min-h-[100dvh] overflow-hidden bg-background text-foreground">
      <div className="relative z-[1] flex min-h-[100dvh] flex-col">
        <header className="flex h-[76px] shrink-0 items-center justify-between border-b border-[hsl(var(--border)/.72)] px-5 sm:px-8">
          <div className="flex items-center gap-3.5" data-testid="brand-goodquestion">
            <div className="relative flex size-9 items-center justify-center overflow-hidden rounded-[13px] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-sm">
              <span className="absolute size-[23px] rounded-full border border-current opacity-60" />
              <span className="absolute size-[13px] rounded-full border border-current opacity-80" />
              <span className="size-[5px] rounded-full bg-current" />
            </div>
            <div>
              <div className="font-serif text-[19px] font-semibold leading-none tracking-[-.04em]">goodquestion</div>
              <div className="mt-1 font-mono text-[9px] uppercase tracking-[.14em] text-muted-foreground">A clearer kind of chat</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-[hsl(var(--border)/.8)] bg-[hsl(var(--card)/.65)] px-3 py-1.5 text-[11px] text-muted-foreground sm:flex">
              <span className="size-1.5 rounded-full bg-[hsl(var(--accent-foreground))]" />
              Gemini chat
            </div>
            <button
              type="button"
              onClick={() => void startNewChat()}
              disabled={isLoadingHistory || isClearingHistory}
              className="group inline-flex h-10 items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card)/.74)] px-3.5 text-[13px] font-semibold transition-all duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--primary)/.35)] hover:bg-card hover:shadow-xs active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Start a new chat"
              data-testid="button-new-chat"
            >
              <Plus className="size-4 transition-transform duration-200 group-hover:rotate-90" strokeWidth={1.8} />
              <span className="hidden sm:inline">{isClearingHistory ? 'Clearing…' : 'New chat'}</span>
            </button>
          </div>
        </header>

        <section className="mx-auto flex w-full max-w-[920px] flex-1 flex-col px-4 sm:px-8">
          <div className={`flex min-h-0 flex-1 flex-col ${hasConversation ? 'pt-7 sm:pt-10' : 'justify-center pb-6'}`}>
            {!hasConversation ? (
              <div className="rise-in mx-auto w-full max-w-[760px]">
                <div className="mb-7 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground sm:mb-9">
                  <span className="h-px w-7 bg-[hsl(var(--primary)/.65)]" />
                  A small space to think out loud
                </div>
                <div className="relative mb-8 flex items-start justify-between gap-3 sm:mb-10">
                  <h1 className="max-w-[610px] font-serif text-[clamp(3.1rem,8vw,6.15rem)] leading-[.94] tracking-[-.065em] text-foreground">
                    Start with a
                    <span className="block text-[hsl(var(--primary))]">good question.</span>
                  </h1>
                  <div className="relative mt-1 hidden size-[120px] shrink-0 items-center justify-center sm:flex lg:mr-8">
                    <div className="orb-turn absolute inset-1 rounded-full border border-[hsl(var(--primary)/.22)]">
                      <span className="absolute left-2 top-5 size-2 rounded-full bg-[hsl(var(--primary))]" />
                      <span className="absolute bottom-3 right-4 size-1.5 rounded-full bg-[hsl(var(--accent-foreground))]" />
                    </div>
                    <div className="absolute inset-[18px] rounded-full border border-dashed border-[hsl(var(--primary)/.28)]" />
                    <div className="relative flex size-[62px] items-center justify-center rounded-full bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]">
                      <Sparkles className="size-[25px]" strokeWidth={1.4} />
                    </div>
                  </div>
                </div>
                <p className="mb-9 max-w-[430px] text-[15px] leading-[1.8] text-muted-foreground sm:mb-11 sm:text-[16px]">
                  Curious about something? Untangling a thought? Ask it the way you’d ask a person. We’ll work it out together.
                </p>

                <form onSubmit={handleSubmit} className="group relative rounded-[22px] border border-[hsl(var(--border))] bg-[hsl(var(--card)/.85)] p-2 shadow-[0_14px_44px_rgba(63,43,34,.07)] transition-all duration-300 focus-within:border-[hsl(var(--primary)/.42)] focus-within:shadow-[0_16px_48px_rgba(63,43,34,.11)]">
                  <label className="sr-only" htmlFor="chat-composer">Ask anything</label>
                  <textarea
                    ref={composerRef}
                    id="chat-composer"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={handleComposerKeyDown}
                    placeholder="What’s on your mind?"
                    rows={2}
                    maxLength={12000}
                    className="block max-h-40 min-h-[76px] w-full resize-none bg-transparent px-4 py-3.5 text-[15px] leading-6 outline-none placeholder:text-[hsl(var(--muted-foreground)/.68)] sm:px-5"
                    data-testid="input-chat-message"
                  />
                  <div className="flex items-center justify-between px-2 pb-1 pt-1">
                    <span className="pl-2 text-[11px] text-muted-foreground/80">Plain words are perfect</span>
                    <button
                      type="submit"
                      disabled={!draft.trim() || isStreaming || isLoadingHistory || isClearingHistory}
                      aria-label="Send message"
                      className="flex size-10 items-center justify-center rounded-[14px] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0 disabled:hover:shadow-none"
                      data-testid="button-send-message"
                    >
                      <ArrowUp className="size-[18px]" strokeWidth={2} />
                    </button>
                  </div>
                </form>
                {databaseMessage && (
                  <div className="mt-4 rounded-[16px] border border-[hsl(var(--primary)/.2)] bg-[hsl(var(--primary)/.06)] px-4 py-3 text-[13px] leading-relaxed" role="status" data-testid="status-database-message">
                    {databaseMessage}
                  </div>
                )}

                <div className="mt-8">
                  <div className="mb-3 pl-1 font-mono text-[9px] uppercase tracking-[.16em] text-muted-foreground/80">Not sure where to begin?</div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {suggestions.map((suggestion, index) => (
                      <button
                        key={suggestion.label}
                        type="button"
                        disabled={isLoadingHistory || isClearingHistory}
                        onClick={() => void sendMessage(suggestion.prompt)}
                        className="group flex min-h-[62px] items-center justify-between gap-3 rounded-[15px] border border-[hsl(var(--border)/.8)] bg-[hsl(var(--card)/.52)] px-4 py-3 text-left text-[12px] font-medium leading-[1.45] text-[hsl(var(--foreground)/.8)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--primary)/.32)] hover:bg-card hover:shadow-xs disabled:cursor-not-allowed disabled:opacity-50"
                        data-testid={`button-prompt-${index + 1}`}
                      >
                        {suggestion.label}
                        <ArrowDown className="size-3.5 shrink-0 -rotate-45 text-muted-foreground/55 transition-all duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[hsl(var(--primary))]" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mx-auto w-full max-w-[740px] flex-1">
                <div className="mb-8 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.17em] text-muted-foreground/75">
                  <span className="size-1.5 rounded-full bg-[hsl(var(--primary))]" />
                  A conversation, one thought at a time
                </div>
                <div className="space-y-8 pb-8">
                  {messages.map((message) => (
                    <article
                      key={message.id}
                      className={`message-in ${message.role === 'user' ? 'flex justify-end' : 'flex items-start gap-3.5 sm:gap-4'}`}
                      data-testid={`message-${message.role}-${message.id}`}
                    >
                      {message.role === 'assistant' && (
                        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[11px] bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]">
                          <Sparkles className="size-4" strokeWidth={1.6} />
                        </div>
                      )}
                      <div className={message.role === 'user'
                        ? 'max-w-[88%] rounded-[19px] rounded-br-[6px] bg-[hsl(var(--secondary))] px-4 py-3.5 text-[14px] leading-[1.75] text-foreground sm:max-w-[78%] sm:px-5'
                        : 'min-w-0 max-w-[calc(100%-3rem)] pt-1 text-[14px] leading-[1.85] text-[hsl(var(--foreground)/.9)] sm:text-[15px]'}>
                        {message.content ? (
                          <div className="whitespace-pre-wrap break-words" data-testid={`text-message-content-${message.id}`}>{message.content}</div>
                        ) : isStreaming && message.role === 'assistant' ? (
                          <div className="flex h-7 items-center gap-1.5" aria-label="Preparing a reply" data-testid="status-streaming">
                            <span className="typing-dot size-1.5 rounded-full bg-[hsl(var(--primary))]" />
                            <span className="typing-dot size-1.5 rounded-full bg-[hsl(var(--primary))]" />
                            <span className="typing-dot size-1.5 rounded-full bg-[hsl(var(--primary))]" />
                          </div>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
                {databaseMessage && (
                  <div className="mb-5 rounded-[16px] border border-[hsl(var(--primary)/.2)] bg-[hsl(var(--primary)/.06)] px-4 py-3.5 text-[13px] leading-relaxed" role="status" data-testid="status-database-message">
                    {databaseMessage}
                  </div>
                )}
                {serviceMessage && (
                  <div className="mb-5 rounded-[16px] border border-[hsl(var(--primary)/.2)] bg-[hsl(var(--primary)/.06)] px-4 py-3.5 text-[13px] leading-relaxed text-foreground" role="status" data-testid="status-service-message">
                    <span className="mb-1 block font-mono text-[9px] uppercase tracking-[.15em] text-[hsl(var(--primary))]">Setup notice</span>
                    {serviceMessage}
                  </div>
                )}
                {requestError && (
                  <div className="mb-5 flex items-center justify-between gap-4 rounded-[16px] border border-[hsl(var(--destructive)/.2)] bg-[hsl(var(--destructive)/.06)] px-4 py-3.5 text-[13px] leading-relaxed text-foreground" role="alert" data-testid="status-request-error">
                    <span>{requestError}</span>
                    <button type="button" onClick={() => setRequestError('')} className="shrink-0 text-xs font-semibold text-[hsl(var(--primary))] hover:underline" data-testid="button-dismiss-error">Dismiss</button>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          {hasConversation && (
            <div className="sticky bottom-0 z-20 mx-auto w-full max-w-[740px] bg-gradient-to-t from-background via-background to-transparent pb-4 pt-3 sm:pb-6">
              <form onSubmit={handleSubmit} className="rounded-[20px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 shadow-[0_12px_38px_rgba(63,43,34,.09)] transition-all duration-300 focus-within:border-[hsl(var(--primary)/.4)]">
                <label className="sr-only" htmlFor="chat-composer">Continue the conversation</label>
                <textarea
                  ref={composerRef}
                  id="chat-composer"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder="Ask a follow-up..."
                  rows={1}
                  maxLength={12000}
                  className="block max-h-36 min-h-[48px] w-full resize-none bg-transparent px-3.5 py-3 text-[14px] leading-6 outline-none placeholder:text-[hsl(var(--muted-foreground)/.68)] sm:px-4"
                  data-testid="input-chat-message"
                />
                <div className="flex items-center justify-between px-1 pb-0.5">
                  <span className="pl-2 text-[10px] text-muted-foreground/75">Enter to send · Shift + Enter for a new line</span>
                  <button
                    type="submit"
                    disabled={!draft.trim() || isStreaming || isLoadingHistory || isClearingHistory}
                    aria-label="Send message"
                    className="flex size-9 items-center justify-center rounded-[13px] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0"
                    data-testid="button-send-message"
                  >
                    <ArrowUp className="size-[17px]" strokeWidth={2} />
                  </button>
                </div>
              </form>
              <div className="pt-2 text-center text-[10px] tracking-[.015em] text-muted-foreground/65">A good answer begins with a good question.</div>
            </div>
          )}
          {!hasConversation && (
            <footer className="flex h-12 shrink-0 items-center justify-center text-[10px] tracking-[.04em] text-muted-foreground/70">
              Made for the questions that don’t fit in a search box
            </footer>
          )}
        </section>
      </div>
    </main>
  );
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
