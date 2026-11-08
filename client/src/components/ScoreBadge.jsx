export default function ScoreBadge({ score, size = 'md', className = '' }) {
  if (score === null || score === undefined) return null;
  const raw = Number(score);
  if (Number.isNaN(raw)) return null;

  const clamped = Math.max(0, Math.min(100, Math.round(raw)));

  let variant;
  if (clamped <= 22) variant = 'f1';
  else if (clamped <= 37) variant = 'f2';
  else if (clamped <= 57) variant = 'f3';
  else if (clamped <= 80) variant = 'f4';
  else variant = 'f5';

  return (
    <span className={`score-pill score-${variant} score-${size} ${className}`}>
      {clamped}
    </span>
  );
}
