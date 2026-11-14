import React from 'react';
import Avatar from '../Avatar';
import HoverHelp from '../ui/HoverHelp';

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
}

const formatLastSeen = (lastSeen: number): string => {
  const seconds = Math.max(0, Math.round((Date.now() - lastSeen) / 1000));
  if (seconds < 5) return 'active now';
  if (seconds < 60) return `active ${seconds}s ago`;
  return `active ${Math.floor(seconds / 60)}m ago`;
};

/**
 * The people else in this project, as a stacked avatar group in the header.
 *
 * One entry per person, overlapping by a few pixels so five collaborators cost
 * the bar two avatar widths rather than five. Each carries its own colour, which
 * is the same colour its selections wear on the sheet. Hover shows who it is.
 */
const UserPresence: React.FC<UserPresenceProps> = ({ users }) => {
  const active = users.filter(user => user.isActive);
  if (active.length === 0) return null;

  return (
    <div
      className="flex min-w-0 items-center -space-x-2"
      role="group"
      aria-label={`${active.length} other ${active.length === 1 ? 'collaborator' : 'collaborators'} in this project`}
    >
      {active.map(user => (
        <HoverHelp
          key={user.id}
          title={user.name}
          description={`${user.email} — ${formatLastSeen(user.lastSeen)}`}
        >
          <span
            className="relative flex h-6 w-6 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-background"
            style={{ backgroundColor: `${user.color}33`, color: user.color }}
          >
            {user.avatar ? (
              <img src={user.avatar} alt={user.name} className="h-6 w-6 object-cover" />
            ) : (
              <Avatar name={user.name} size={24} className="h-6 w-6" />
            )}
          </span>
        </HoverHelp>
      ))}
    </div>
  );
};

export default UserPresence;
