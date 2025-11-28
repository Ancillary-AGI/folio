import React from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

interface PluginPanelProps {
  onClose: () => void;
}

const PluginPanel: React.FC<PluginPanelProps> = ({ onClose }) => {
  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Plugin Manager</CardTitle>
        <Button variant="ghost" size="sm" onClick={onClose}>×</Button>
      </CardHeader>
      <CardContent className="flex-1">
        <p>Plugin management interface placeholder</p>
      </CardContent>
    </Card>
  );
};

export default PluginPanel;