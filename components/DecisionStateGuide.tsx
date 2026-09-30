import type { Locale } from '@/lib/i18n/config';

const copy = {
  en: { eyebrow:'THREE SIMPLE ANSWERS', title:'Know what to do at a glance.', intro:'Trade Police checks your rules first, then gives you one clear next step.', ready:['SETUP FOUND','Your required setup rules passed. Run the final risk check before entering.'], wait:['WAIT','Something is still missing. Do not enter yet.'], blocked:["DON’T TAKE IT",'A required rule or risk control failed. Skip this trade.'], note:'“Setup found” is not permission to enter until the final risk check also passes. No result predicts profit.' },
  es: { eyebrow:'TRES RESPUESTAS SIMPLES', title:'Entiende qué hacer de un vistazo.', intro:'Trade Police revisa tus reglas y te da un solo siguiente paso.', ready:['SETUP ENCONTRADO','Pasaron las reglas obligatorias del setup. Ejecuta el control final de riesgo antes de entrar.'], wait:['ESPERA','Todavía falta algo. No entres aún.'], blocked:['NO LO TOMES','Falló una regla obligatoria o un control de riesgo. Descarta este trade.'], note:'“Setup encontrado” no autoriza la entrada hasta que también pase el control final de riesgo. Ningún resultado predice ganancias.' },
  fr: { eyebrow:'TROIS RÉPONSES SIMPLES', title:'Comprenez quoi faire en un coup d’œil.', intro:'Trade Police vérifie vos règles puis vous donne une seule prochaine étape.', ready:['SETUP TROUVÉ','Les règles obligatoires sont validées. Lancez le contrôle final du risque avant d’entrer.'], wait:['ATTENDEZ','Il manque encore un élément. N’entrez pas encore.'], blocked:['NE LE PRENEZ PAS','Une règle obligatoire ou un contrôle du risque a échoué. Ignorez ce trade.'], note:'« Setup trouvé » n’autorise pas l’entrée avant la validation finale du risque. Aucun résultat ne prédit un gain.' },
} as const;

export default function DecisionStateGuide({ locale, compact=false }: { locale:Locale; compact?:boolean }) {
  const c=copy[locale];
  return <section className={`decision-state-guide ${compact?'compact':''}`} aria-labelledby={`decision-state-guide-${compact?'compact':'full'}`}>
    <header><div><p className="eyebrow">{c.eyebrow}</p><h2 id={`decision-state-guide-${compact?'compact':'full'}`}>{c.title}</h2></div><p>{c.intro}</p></header>
    <div className="decision-state-grid">
      <article className="state-ready"><span>✓</span><div><strong>{c.ready[0]}</strong><small>READY</small><p>{c.ready[1]}</p></div></article>
      <article className="state-wait"><span>•••</span><div><strong>{c.wait[0]}</strong><small>WAIT</small><p>{c.wait[1]}</p></div></article>
      <article className="state-blocked"><span>×</span><div><strong>{c.blocked[0]}</strong><small>BLOCKED</small><p>{c.blocked[1]}</p></div></article>
    </div>
    <small>{c.note}</small>
  </section>;
}
