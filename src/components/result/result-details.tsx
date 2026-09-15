interface ResultDetailItem {
  label: string;
  text: string;
}

interface ResultDetailsProps {
  title: string;
  subtitle: string;
  items: ResultDetailItem[];
  quote?: string;
}

export function ResultDetails({ title, subtitle, items, quote }: ResultDetailsProps) {
  if (!items.length && !quote) return null;

  return (
    <section className="press-result-details atlas-result-details" aria-labelledby="result-details-heading">
      <div className="atlas-result-details-heading">
        <h2 id="result-details-heading">{title}</h2>
        <p>{subtitle}</p>
      </div>
      {items.length > 0 && (
        <div className="atlas-result-details-grid">
          {items.map((item) => (
            <article key={`${item.label}-${item.text}`} className="atlas-result-details-item">
              <h3>{item.label}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      )}
      {quote && <blockquote className="atlas-result-details-quote">“{quote}”</blockquote>}
    </section>
  );
}
