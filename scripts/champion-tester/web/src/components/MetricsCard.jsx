const COLOR_MAP = {
  blue: 'border-blue-500 text-blue-400',
  green: 'border-green-500 text-green-400',
  red: 'border-red-500 text-red-400',
  yellow: 'border-yellow-500 text-yellow-400',
};

function MetricsCard({ label, value, subtitle, color = 'blue' }) {
  const colorClasses = COLOR_MAP[color] || COLOR_MAP.blue;
  const [borderClass, textClass] = colorClasses.split(' ');

  return (
    <div className={`rounded-lg bg-gray-800 p-4 border-l-4 ${borderClass}`}>
      <p className="text-xs text-gray-400 uppercase">{label}</p>
      <p className={`text-2xl font-bold ${textClass}`}>{value}</p>
      {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
    </div>
  );
}

export default MetricsCard;
