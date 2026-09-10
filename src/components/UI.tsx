import type { ReactNode } from "react";

export function PageHead({ eyebrow, title, subtitle, action }: { eyebrow?: string; title: string; subtitle?: string; action?: ReactNode }) {
  return <div className="page-head">
    <div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
    {action && <div>{action}</div>}
  </div>
}

export function Metric({ label, value, suffix, detail }: { label: string; value: ReactNode; suffix?: string; detail?: string }) {
  return <div className="metric-block"><span>{label}</span><strong>{value}{suffix && <small>{suffix}</small>}</strong>{detail && <em>{detail}</em>}</div>
}

export function Section({ title, caption, children, className="" }: { title: string; caption?: string; children: ReactNode; className?: string }) {
  return <section className={`section-block ${className}`}><div className="section-title"><h2>{title}</h2>{caption && <p>{caption}</p>}</div>{children}</section>
}

export function Badge({ children, tone="neutral" }: { children: ReactNode; tone?: "neutral"|"good"|"warn"|"bad" }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
