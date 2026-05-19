const COLOR_MAP = {
  blue: { border: 'border-blue-500/30', text: 'text-blue-400', bg: 'bg-blue-500/5' },
  green: { border: 'border-success/30', text: 'text-success', bg: 'bg-success/5' },
  red: { border: 'border-error/30', text: 'text-error', bg: 'bg-error/5' },
  yellow: { border: 'border-warning/30', text: 'text-warning', bg: 'bg-warning/5' },
  cyan: { border: 'border-info/30', text: 'text-info', bg: 'bg-info/5' },
};

function MetricsCard({ label, value, subtitle, color = 'blue', compact = false }) {
  const colors = COLOR_MAP[color] || COLOR_MAP.blue;

  if (compact) {
    return (
      <div className={`rounded-lg ${colors.bg} border ${colors.border} px-3 py-2`}>
        <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">{label}</p>
        <p className={`text-lg font-bold ${colors.text} mt-0.5 font-mono`}>{value ?? '—'}</p>
        {subtitle && <p className="text-[10px] text-gray-600">{subtitle}</p>}
      </div>
    );
  }

  return (
    <div className={`rounded-xl ${colors.bg} border ${colors.border} p-4 transition-all hover:shadow-md`}>
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold ${colors.text} mt-1 font-mono`}>{value ?? '—'}</p>
      {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
    </div>
  );
}

export default MetricsCard;
