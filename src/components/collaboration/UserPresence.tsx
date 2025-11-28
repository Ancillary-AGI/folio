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

const UserPresence: React.FC<UserPresenceProps> = ({ users }) => {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {users.map(user => (
        <div key={user.id} className="absolute" style={{ color: user.color }}>
          {/* Placeholder for user presence indicators */}
        </div>
      ))}
    </div>
  );
};

export default UserPresence;