import React from 'react';

interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  color: string;
  isActive: boolean;
  lastSeen: number;
}

interface UserPresenceProps {
  users: User[];
  showCursors: boolean;
  showSelections: boolean;
  canvasRef: React.RefObject<HTMLElement>;
}

const formatLastSeen = (lastSeen: number): string => {
  const seconds = Math.max(0, Math.round((Date.now() - lastSeen) / 1000));
  if (seconds < 5) return 'active now';
  if (seconds < 60) return `active ${seconds}s ago`;
  return `active ${Math.floor(seconds / 60)}m ago`;
};

const UserPresence: React.FC<UserPresenceProps> = ({ users }) => {
  const active = users.filter(user => user.isActive);
  if (active.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none" aria-label={`${active.length} collaborator${active.length === 1 ? '' : 's'} online`}>
      {active.map(user => (
        <div key={user.id} className="absolute left-2 top-2 flex items-center gap-2 rounded-full border border-border bg-background/90 py-1 pl-1 pr-3 shadow-sm" style={{ color: user.color }} title={`${user.name} (${user.email}) — ${formatLastSeen(user.lastSeen)}`}>
          {user.avatar ? (
            <img src={user.avatar} alt={user.name} className="h-6 w-6 rounded-full" />
          ) : (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-semibold" style={{ backgroundColor: `${user.color}22` }}>
              {user.name.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="text-xs font-medium text-foreground">{user.name}</span>
        </div>
      ))}
    </div>
  );
};

export default UserPresence;