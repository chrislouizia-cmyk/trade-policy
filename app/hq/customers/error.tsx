'use client';
export default function CustomerDirectoryError({reset}:{error:Error&{digest?:string};reset:()=>void}){return <section className="card directory-error-state"><strong>Customer directory could not be loaded.</strong><p>Please retry. If the problem continues, verify the HQ customer-directory migration and permissions.</p><button type="button" onClick={reset}>Retry</button></section>}
