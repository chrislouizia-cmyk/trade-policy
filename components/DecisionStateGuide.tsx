import type { Locale } from '@/lib/i18n/config';

const copy = {
  en: { eyebrow:'DECISION LANGUAGE', title:'Three states. No hidden meaning.', intro:'Every result tells you what the rules found and what should happen next.', ready:['READY','Required evidence is present. Continue to the final risk check.'], wait:['WAIT','Required evidence is still missing. Pause or skip the setup.'], blocked:['BLOCKED','A mandatory rule or risk control failed. The trade is not authorized.'], note:'A state describes rule compliance at that moment. It is not a prediction or profit guarantee.' },
  es: { eyebrow:'LENGUAJE DE DECISIÓN', title:'Tres estados. Sin significados ocultos.', intro:'Cada resultado muestra qué encontraron las reglas y qué debe ocurrir después.', ready:['READY','La evidencia obligatoria está presente. Continúa al control final de riesgo.'], wait:['WAIT','Aún falta evidencia obligatoria. Espera o descarta el setup.'], blocked:['BLOCKED','Falló una regla obligatoria o un control de riesgo. El trade no está autorizado.'], note:'El estado describe el cumplimiento de las reglas en ese momento. No es una predicción ni una garantía de ganancia.' },
  fr: { eyebrow:'LANGAGE DE DÉCISION', title:'Trois états. Aucun sens caché.', intro:'Chaque résultat indique ce que les règles ont trouvé et la prochaine étape.', ready:['READY','Les preuves obligatoires sont présentes. Passez au contrôle final du risque.'], wait:['WAIT','Des preuves obligatoires manquent encore. Attendez ou ignorez le setup.'], blocked:['BLOCKED','Une règle obligatoire ou un contrôle du risque a échoué. Le trade n’est pas autorisé.'], note:'L’état décrit le respect des règles à cet instant. Ce n’est ni une prédiction ni une garantie de gain.' },
} as const;

export default function DecisionStateGuide({ locale, compact=false }: { locale:Locale; compact?:boolean }) {
  const c=copy[locale];
  return <section className={`decision-state-guide ${compact?'compact':''}`} aria-labelledby={`decision-state-guide-${compact?'compact':'full'}`}>
    <header><div><p className="eyebrow">{c.eyebrow}</p><h2 id={`decision-state-guide-${compact?'compact':'full'}`}>{c.title}</h2></div><p>{c.intro}</p></header>
    <div className="decision-state-grid">
      <article className="state-ready"><span>✓</span><div><strong>{c.ready[0]}</strong><p>{c.ready[1]}</p></div></article>
      <article className="state-wait"><span>•••</span><div><strong>{c.wait[0]}</strong><p>{c.wait[1]}</p></div></article>
      <article className="state-blocked"><span>×</span><div><strong>{c.blocked[0]}</strong><p>{c.blocked[1]}</p></div></article>
    </div>
    <small>{c.note}</small>
  </section>;
}
