import Link from 'next/link';
export default function OperationsLoadError({title,message}:{title:string;message:string}){return <section className="card operations-load-error" role="alert"><span className="eyebrow">OPERATIONS UNAVAILABLE</span><h1>{title}</h1><p>{message}</p><Link className="button-link primary" href="/hq/system">Retry</Link></section>}
