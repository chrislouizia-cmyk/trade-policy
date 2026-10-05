"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useLocale } from "./i18n/LocaleProvider";
import type {
  CompanionContextEvent,
  CompanionSelection,
} from "@/lib/companion-events";
import type { CompanionFact, LearningSummary } from "@/lib/trader-learning";

type Message = {
  role: string;
  text: string;
  question?: string;
  source?: string;
  evidenceIds?: string[];
  evidence?: CompanionFact[];
  createdAt?: string;
};
type Memory = { id: string; content: string; category: string };
const copy = {
  es: {
    title: "Tu acompañante",
    intro:
      "Entiende tu proceso, explica tus decisiones y aprende de tus operaciones registradas.",
    send: "Conversar",
    busy: "Pensando…",
    placeholder: "Cuéntame cómo operas o qué quieres entender",
    remember: "Recordar esto",
    automatic: "Comentar los nuevos análisis",
    memories: "Lo que recuerdo",
    history: "Historial registrado",
    forget: "Borrar memoria guardada",
    sources: "Evidencia utilizada",
    empty:
      "Todavía no hay operaciones cerradas suficientes para observar patrones.",
    error: "No pude completar la conversación. Inténtalo otra vez.",
    saved: "Memoria guardada",
    voice: "Escuchar",
    generic:
      "Ayúdame a revisar mi proceso y pregúntame lo que necesitas para entender cómo opero.",
  },
  en: {
    title: "Your companion",
    intro:
      "Understands your process, explains decisions and learns from recorded trades.",
    send: "Talk",
    busy: "Thinking…",
    placeholder: "Describe how you trade or what you want to understand",
    remember: "Remember this",
    automatic: "Comment on new analyses",
    memories: "What I remember",
    history: "Recorded history",
    forget: "Delete saved memory",
    sources: "Evidence used",
    empty: "There are not enough closed trades to observe patterns yet.",
    error: "The conversation could not be completed. Please try again.",
    saved: "Memory saved",
    voice: "Listen",
    generic:
      "Help me review my process and ask what you need to understand how I trade.",
  },
  fr: {
    title: "Votre compagnon",
    intro:
      "Comprend votre méthode, explique les décisions et apprend de vos opérations enregistrées.",
    send: "Discuter",
    busy: "Réflexion…",
    placeholder: "Décrivez votre méthode ou ce que vous voulez comprendre",
    remember: "Mémoriser ceci",
    automatic: "Commenter les nouvelles analyses",
    memories: "Mes souvenirs",
    history: "Historique enregistré",
    forget: "Supprimer la mémoire",
    sources: "Sources utilisées",
    empty:
      "Pas encore assez de positions clôturées pour observer des tendances.",
    error: "La conversation a échoué. Réessayez.",
    saved: "Mémoire enregistrée",
    voice: "Écouter",
    generic:
      "Aide-moi à revoir ma méthode et pose les questions nécessaires pour comprendre comment je trade.",
  },
};
export default function TraderCompanion() {
  const pathname = usePathname();
  const { locale } = useLocale();
  const c = copy[locale];
  const [ready, setReady] = useState(false),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [automatic, setAutomatic] = useState(true),
    [input, setInput] = useState(""),
    [remember, setRemember] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [messages, setMessages] = useState<Message[]>([]),
    [facts, setFacts] = useState<CompanionFact[]>([]),
    [memories, setMemories] = useState<Memory[]>([]),
    [summary, setSummary] = useState<LearningSummary | null>(null);
  const session = useRef({ id: "", version: 0 });
  const selection = useRef<CompanionSelection>({});
  const busyRef = useRef(false);
  const autoRef = useRef(true);
  const userRef = useRef("");
  const sequence = useRef(0);
  const pending = useRef<CompanionContextEvent | null>(null);
  const speakRef = useRef<(message: string, save?: boolean) => Promise<void>>(
    async () => {},
  );
  const allowed =
    !/^\/(login|signup|auth|hq|portal|onboarding|reset|forgot)/.test(
      pathname,
    ) && pathname !== "/";
  const reload = useCallback(
    async (context: CompanionSelection = selection.current, restore = true) => {
      const token = sequence.current;
      const query = new URLSearchParams(context);
      if (session.current.id) query.set("sessionId", session.current.id);
      const response = await fetch(`/api/trader-companion?${query}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Context unavailable");
      const data = await response.json();
      if (token !== sequence.current) return data;
      setFacts(data.facts);
      setMemories(data.memories);
      setSummary(data.summary);
      if (restore && data.session) {
        session.current = {
          id: data.session.id,
          version: data.session.version,
        };
        setMessages(data.session.messages);
      }
      return data;
    },
    [],
  );
  useEffect(() => {
    selection.current = {};
    pending.current = null;
    sequence.current++;
    queueMicrotask(() => setReady(false));
    if (!allowed) return;
    const controller = new AbortController();
    void fetch("/api/trader-companion", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const data = await response.json();
        if (controller.signal.aborted) return;
        if (userRef.current !== data.userId) {
          setMessages([]);
          session.current = { id: "", version: 0 };
        }
        userRef.current = data.userId;
        const key = `tp-companion:${data.userId}`;
        const stored = readPreference(key);
        session.current.id =
          stored && /^[\da-f-]{36}$/i.test(stored)
            ? stored
            : crypto.randomUUID();
        writePreference(key, session.current.id);
        autoRef.current = readPreference(`${key}:auto`) !== "false";
        setAutomatic(autoRef.current);
        setFacts(data.facts);
        setMemories(data.memories);
        setSummary(data.summary);
        setReady(true);
        await reload();
        const event = pending.current;
        pending.current = null;
        if (event && autoRef.current) {
          setOpen(true);
          void speakRef.current(contextPrompt(event));
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [allowed, pathname, reload]);
  const send = useCallback(
    async (message: string, save = false) => {
      if (busyRef.current || !session.current.id) return;
      busyRef.current = true;
      setBusy(true);
      setError("");
      setNotice("");
      const token = sequence.current;
      try {
        const response = await fetch("/api/trader-companion", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: session.current.id,
            version: session.current.version,
            message,
            locale,
            context: selection.current,
            ...(save ? { remember: "NOTE" } : {}),
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          if (response.status === 409) await reload();
          throw new Error(c.error);
        }
        session.current.version = data.version;
        if (token === sequence.current) {
          setMessages(data.messages);
          setFacts(data.facts);
          setInput("");
          setRemember(false);
          if (data.memorySaved) {
            setNotice(c.saved);
            await reload();
          }
        }
      } catch {
        if (token === sequence.current) setError(c.error);
      } finally {
        busyRef.current = false;
        setBusy(false);
        const event = pending.current;
        pending.current = null;
        if (event && autoRef.current) {
          setTimeout(() => void speakRef.current(contextPrompt(event)), 0);
        }
      }
    },
    [locale, c.error, c.saved, reload],
  );
  useEffect(() => {
    speakRef.current = send;
  }, [send]);
  useEffect(() => {
    const handler = (raw: Event) => {
      const event = (raw as CustomEvent<CompanionContextEvent>).detail;
      selection.current = event.context;
      sequence.current++;
      setMessages([]);
      setError("");
      setNotice("");
      if (!ready) {
        pending.current = event;
        return;
      }
      void reload(event.context, false).catch(() => setError(c.error));
      if (!autoRef.current) return;
      setOpen(true);
      if (busyRef.current) pending.current = event;
      else void send(contextPrompt(event));
    };
    window.addEventListener("trade-police:context", handler);
    return () => window.removeEventListener("trade-police:context", handler);
  }, [ready, send, reload, locale, c.error]);
  if (!allowed || !ready) return null;
  return (
    <section className="card trader-companion" aria-label={c.title}>
      <button
        type="button"
        className="companion-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <strong>Trade Police · {c.title}</strong>
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="companion-content">
          <p className="muted">{c.intro}</p>
          <label className="check-row">
            <input
              type="checkbox"
              checked={automatic}
              onChange={(e) => {
                setAutomatic(e.target.checked);
                autoRef.current = e.target.checked;
                writePreference(
                  `tp-companion:${userRef.current}:auto`,
                  String(e.target.checked),
                );
              }}
            />
            {c.automatic}
          </label>
          <div
            className="companion-log"
            role="log"
            aria-live="polite"
            aria-busy={busy}
          >
            {messages.map((message, i) => (
              <article
                key={i}
                className={
                  message.role === "user" ? "from-trader" : "from-trade-police"
                }
              >
                <strong>
                  {message.role === "user" ? "You" : "Trade Police"}
                  {message.source
                    ? ` · ${message.source === "OPENAI" ? "AI" : "Fallback"}`
                    : ""}
                </strong>
                <p>{message.text}</p>
                {message.question && <p>{message.question}</p>}
                {message.evidenceIds?.length ? (
                  <details>
                    <summary>{c.sources}</summary>
                    {message.evidenceIds.map((id) => {
                      const fact = (message.evidence ?? facts).find(
                        (f) => f.id === id,
                      );
                      return (
                        <p key={id}>
                          <small>{fact?.source ?? id}</small>
                          <br />
                          {fact?.text ?? id}
                        </p>
                      );
                    })}
                  </details>
                ) : null}
                {message.role === "assistant" && (
                  <button
                    type="button"
                    onClick={() => {
                      if ("speechSynthesis" in window) {
                        speechSynthesis.cancel();
                        const utterance = new SpeechSynthesisUtterance(
                          `${message.text} ${message.question ?? ""}`,
                        );
                        utterance.lang = locale;
                        speechSynthesis.speak(utterance);
                      }
                    }}
                  >
                    {c.voice}
                  </button>
                )}
              </article>
            ))}
          </div>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input.trim() || c.generic, remember);
            }}
          >
            <label>
              {c.placeholder}
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                maxLength={remember ? 1000 : 3000}
                rows={3}
              />
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={remember}
                disabled={input.length > 1000}
                onChange={(e) => setRemember(e.target.checked)}
              />
              {c.remember}
            </label>
            <button type="submit" disabled={busy}>
              {busy ? c.busy : c.send}
            </button>
          </form>
          <details>
            <summary>
              {c.memories} ({memories.length})
            </summary>
            {memories.map((memory) => (
              <div key={memory.id}>
                <p>{memory.content}</p>
                <button
                  disabled={busy}
                  onClick={async () => {
                    const response = await fetch("/api/trader-companion", {
                      method: "DELETE",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ memoryId: memory.id }),
                    });
                    if (response.ok) await reload();
                    else setError(c.error);
                  }}
                >
                  {c.forget}
                </button>
              </div>
            ))}
          </details>
          <details>
            <summary>
              {c.history} · {summary?.closedTrades ?? 0}
            </summary>
            <p className="muted">
              {summary?.closedTrades
                ? `${summary.closedTrades} · ${summary.averageR} R`
                : c.empty}
            </p>
            {summary?.findings.map((f) => (
              <p key={f.id}>{f.text}</p>
            ))}
          </details>
        </div>
      )}
    </section>
  );
}
function contextPrompt(event: CompanionContextEvent) {
  return `The workspace changed: ${event.reason}, instrument ${event.instrument ?? "see recorded context"}, timeframe ${event.timeframe ?? "see recorded context"}. Explain what matters in the supplied current context, relate it to my recorded process when evidence permits, identify missing information, and ask one useful question. Do not repeat old market facts as current.`;
}

function readPreference(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePreference(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* Conversation still works when browser storage is unavailable. */
  }
}
