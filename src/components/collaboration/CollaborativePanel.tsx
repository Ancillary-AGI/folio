import React from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

interface CollaborativePanelProps {
  onClose: () => void;
}

const CollaborativePanel: React.FC<CollaborativePanelProps> = ({ onClose }) => {
  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Collaboration</CardTitle>
        <Button variant="ghost" size="sm" onClick={onClose}>×</Button>
      </CardHeader>
      <CardContent className="flex-1">
        <p>Collaborative editing interface placeholder</p>
      </CardContent>
    </Card>
  );
};

export default CollaborativePanel;