export function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const cls = value >= 0.6 ? "badge-matched" : value >= 0.3 ? "badge-uncertain" : "badge-unresolved";
  return (
    <span className={`badge ${cls} figure`} title={`${pct}% match confidence`}>
      {pct}%
    </span>
  );
}
