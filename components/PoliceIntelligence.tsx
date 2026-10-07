import type { LearningDimension, LearningSummary } from "@/lib/trader-learning";
import type { Locale } from "@/lib/i18n/config";

const copy = {
  en: {
    eyebrow: "POLICE INTELLIGENCE",
    compactTitle: "Learning quietly in the background",
    briefTitle: "Your intelligence brief",
    briefIntro: "Patterns from your recorded decisions and closed trades, without changing your rules.",
    early: "Building your profile",
    established: "Profile active",
    noTrades: "Learning is active. Close recorded trades to reveal patterns by time, market and strategy.",
    automatic: "Updates automatically from recorded activity",
    trades: "closed trades",
    average: "average R",
    decisions: "decisions",
    activeDays: "active days",
    strongest: "Strongest observed",
    weakest: "Needs review",
    coaching: "Priority observation",
    moreCoaching: "Additional observations",
    sample: "trades",
    view: "View intelligence",
    open: "View full analysis",
    close: "Evidence and recommendations",
    evidence: "Evidence map",
    dna: "TRADING DNA",
    streak: "Current streak",
    adherence: "Rule adherence",
    riskBaseline: "Recent / baseline risk",
    today: "Trades today",
    losses: "losses",
    wins: "wins",
  },
  es: {
    eyebrow: "INTELIGENCIA POLICIAL",
    compactTitle: "Aprendiendo en segundo plano",
    briefTitle: "Tu resumen de inteligencia",
    briefIntro: "Patrones de tus decisiones y operaciones registradas, sin cambiar tus reglas.",
    early: "Construyendo tu perfil",
    established: "Perfil activo",
    noTrades: "El aprendizaje está activo. Cierra operaciones registradas para revelar patrones por horario, mercado y estrategia.",
    automatic: "Se actualiza automáticamente con la actividad registrada",
    trades: "operaciones cerradas",
    average: "R promedio",
    decisions: "decisiones",
    activeDays: "días activos",
    strongest: "Mejor patrón observado",
    weakest: "Requiere revisión",
    coaching: "Observación prioritaria",
    moreCoaching: "Observaciones adicionales",
    sample: "operaciones",
    view: "Ver inteligencia",
    open: "Ver análisis completo",
    close: "Evidencia y recomendaciones",
    evidence: "Mapa de evidencia",
    dna: "ADN DE TRADING",
    streak: "Racha actual",
    adherence: "Adherencia a reglas",
    riskBaseline: "Riesgo reciente / base",
    today: "Trades hoy",
    losses: "pérdidas",
    wins: "ganancias",
  },
  fr: {
    eyebrow: "INTELLIGENCE POLICIÈRE",
    compactTitle: "Apprentissage discret en arrière-plan",
    briefTitle: "Votre synthèse d’intelligence",
    briefIntro: "Des tendances issues de vos décisions et trades enregistrés, sans modifier vos règles.",
    early: "Création de votre profil",
    established: "Profil actif",
    noTrades: "L’apprentissage est actif. Clôturez des trades enregistrés pour révéler les tendances par heure, marché et stratégie.",
    automatic: "Mise à jour automatique depuis l’activité enregistrée",
    trades: "trades clôturés",
    average: "R moyen",
    decisions: "décisions",
    activeDays: "jours actifs",
    strongest: "Meilleur profil observé",
    weakest: "À examiner",
    coaching: "Observation prioritaire",
    moreCoaching: "Observations supplémentaires",
    sample: "trades",
    view: "Voir l’intelligence",
    open: "Voir l’analyse complète",
    close: "Preuves et recommandations",
    evidence: "Carte des preuves",
    dna: "ADN DE TRADING",
    streak: "Série actuelle",
    adherence: "Respect des règles",
    riskBaseline: "Risque récent / référence",
    today: "Trades aujourd’hui",
    losses: "pertes",
    wins: "gains",
  },
} as const;

type Props = {
  summary: LearningSummary;
  locale: Locale;
  full?: boolean;
};

export default function PoliceIntelligence({ summary, locale, full = false }: Props) {
  const c = copy[locale] ?? copy.en;
  const eligible = summary.dimensions.filter((item) => item.trades >= 3);
  const strongest = [...eligible].sort((a, b) => b.averageR - a.averageR)[0];
  const weakest = [...eligible].sort((a, b) => a.averageR - b.averageR)[0];
  const priority = summary.recommendations[0];
  const established = summary.closedTrades >= 30;
  const headingId = full ? "police-intelligence-title" : "police-intelligence-compact-title";

  if (!full) {
    return (
      <section className="card police-intelligence police-intelligence--compact" aria-labelledby={headingId}>
        <div className="police-intelligence-identity">
          <span className="police-intelligence-signal" aria-hidden="true" />
          <div>
            <span className="eyebrow">{c.eyebrow}</span>
            <h2 id={headingId}>{c.compactTitle}</h2>
          </div>
        </div>
        <div className="police-intelligence-compact-insight">
          <strong>{priority?.title ?? strongest?.label ?? c.noTrades}</strong>
          {priority ? <p>{priority.detail}</p> : strongest ? <p>{formatPattern(strongest, c.sample)}</p> : null}
        </div>
        <div className="police-intelligence-compact-meta" aria-label={`${summary.closedTrades} ${c.trades}`}>
          <span><strong>{summary.closedTrades}</strong> {c.trades}</span>
          <span><strong>{formatAverage(summary.averageR)}</strong> {c.average}</span>
        </div>
        <a className="police-intelligence-link" href="/analytics#police-intelligence">{c.view}<span aria-hidden="true">→</span></a>
      </section>
    );
  }

  return (
    <section id="police-intelligence" className="card police-intelligence police-intelligence--brief" aria-labelledby={headingId}>
      <header className="police-intelligence-head">
        <div>
          <span className="eyebrow">{c.eyebrow}</span>
          <h2 id={headingId}>{c.briefTitle}</h2>
          <p>{c.briefIntro}</p>
        </div>
        <span className={`police-intelligence-state ${established ? "is-established" : "is-learning"}`}>
          <i aria-hidden="true" />{established ? c.established : c.early}
        </span>
      </header>

      {summary.closedTrades === 0 ? <p className="police-intelligence-empty">{c.noTrades}</p> : (
        <>
          {priority ? (
            <article className="police-intelligence-priority">
              <span>{c.coaching}</span>
              <strong>{priority.title}</strong>
              <p>{priority.detail}</p>
            </article>
          ) : null}
          <section className="police-intelligence-dna" aria-label={c.dna}>
            <span className="police-intelligence-dna-label">{c.dna}</span>
            <Metric value={streakValue(summary, c.losses, c.wins)} label={c.streak} />
            <Metric value={summary.behavior.adherenceRate == null ? "—" : `${summary.behavior.adherenceRate}%`} label={c.adherence} />
            <Metric value={riskValue(summary)} label={c.riskBaseline} />
            <Metric value={String(summary.behavior.tradesToday)} label={c.today} />
          </section>
          {strongest || weakest ? (
            <div className="police-intelligence-patterns">
              {strongest ? <Pattern title={c.strongest} item={strongest} tone="positive" sample={c.sample} /> : null}
              {weakest ? <Pattern title={c.weakest} item={weakest} tone="negative" sample={c.sample} /> : null}
            </div>
          ) : null}
        </>
      )}

      <details className="police-intelligence-disclosure">
        <summary><span>{c.open}</span><small>{c.close}</small><i aria-hidden="true">+</i></summary>
        <div className="police-intelligence-deep-content">
          <div className="police-intelligence-metrics">
            <Metric value={String(summary.closedTrades)} label={c.trades} />
            <Metric value={formatAverage(summary.averageR)} label={c.average} />
            <Metric value={String(summary.behavior.decisions)} label={c.decisions} />
            <Metric value={String(summary.behavior.activeDays)} label={c.activeDays} />
          </div>
          {summary.recommendations.length > 1 ? (
            <div className="police-intelligence-coaching">
              <h3>{c.moreCoaching}</h3>
              {summary.recommendations.slice(1, 6).map((item) => (
                <article key={item.id}>
                  <span className={`badge ${item.priority === "HIGH" ? "rejected" : "review"}`}>{item.priority}</span>
                  <div><strong>{item.title}</strong><p>{item.detail}</p></div>
                </article>
              ))}
            </div>
          ) : null}
          <DimensionTable dimensions={summary.dimensions} sample={c.sample} label={c.evidence} />
        </div>
      </details>

      <small className="police-intelligence-footnote">{c.automatic} · {summary.timezone} · {new Date(summary.generatedAt).toLocaleString(locale)}</small>
    </section>
  );
}

function formatAverage(value: number | null) {
  return value === null ? "—" : `${value >= 0 ? "+" : ""}${value}R`;
}

function streakValue(summary: LearningSummary, losses: string, wins: string) {
  if (summary.behavior.currentLossStreak) return `${summary.behavior.currentLossStreak} ${losses}`;
  if (summary.behavior.currentWinStreak) return `${summary.behavior.currentWinStreak} ${wins}`;
  return "—";
}

function riskValue(summary: LearningSummary) {
  const recent = summary.behavior.recentRiskPercent;
  const baseline = summary.behavior.averageRiskPercent;
  return recent == null || baseline == null ? "—" : `${recent}% / ${baseline}%`;
}

function formatPattern(item: LearningDimension, sample: string) {
  return `${item.averageR >= 0 ? "+" : ""}${item.averageR}R · ${item.trades} ${sample}`;
}

function Metric({ value, label }: { value: string; label: string }) {
  return <div><strong>{value}</strong><span>{label}</span></div>;
}

function Pattern({ title, item, tone, sample }: { title: string; item: LearningDimension; tone: "positive" | "negative"; sample: string }) {
  return <article className={tone}><span>{title}</span><strong>{item.label}</strong><small>{formatPattern(item, sample)}</small></article>;
}

function DimensionTable({ dimensions, sample, label }: { dimensions: LearningDimension[]; sample: string; label: string }) {
  if (!dimensions.length) return null;
  return (
    <details className="police-intelligence-details">
      <summary>{label}</summary>
      <div>
        {[...dimensions]
          .sort((a, b) => a.dimension.localeCompare(b.dimension) || b.averageR - a.averageR)
          .map((item) => (
            <p key={`${item.dimension}:${item.key}`}>
              <span>{item.dimension} · {item.label}</span>
              <strong>{item.averageR >= 0 ? "+" : ""}{item.averageR}R</strong>
              <small>{item.trades} {sample} · {item.winRate}%</small>
            </p>
          ))}
      </div>
    </details>
  );
}
