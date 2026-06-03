"use client";

export default function AdminStats({
  totalUsers,
  activeTrades,
  volume24h,
  housePnl24h,
}: {
  totalUsers: number;
  activeTrades: number;
  volume24h: number;
  housePnl24h: number;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card label="Users" value={String(totalUsers)} />
      <Card label="Active trades" value={String(activeTrades)} />
      <Card label="24h volume" value={`₵${volume24h.toFixed(2)}`} />
      <Card label="24h house P&L" value={`₵${housePnl24h.toFixed(2)}`} color={housePnl24h >= 0 ? "text-up" : "text-down"} />
    </div>
  );
}

function Card({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted uppercase">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color ?? ""}`}>{value}</div>
    </div>
  );
}
