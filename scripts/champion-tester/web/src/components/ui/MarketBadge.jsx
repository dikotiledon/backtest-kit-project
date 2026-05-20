export default function MarketBadge({ market }) {
  const colors = {
    spot: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    usdm: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    coinm: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  };
  return (
    <span className={`px-2 py-0.5 text-[10px] font-bold rounded border ${colors[market] || colors.spot}`}>
      {market === 'usdm' ? 'USD-M' : market === 'coinm' ? 'COIN-M' : 'SPOT'}
    </span>
  );
}
