import React, { useState, useEffect } from 'react';
import { iotDeviceManagement, IoTDevice, IoTAlert, IoTCommand } from '../../lib/iot/iotDeviceManagement';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';

export const IoTDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState('devices');
  const [devices, setDevices] = useState<IoTDevice[]>([]);
  const [alerts, setAlerts] = useState<IoTAlert[]>([]);
  const [commands, setCommands] = useState<IoTCommand[]>([]);
  const [metrics, setMetrics] = useState<any>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = () => {
    setDevices(iotDeviceManagement.getAllDevices());
    setAlerts(iotDeviceManagement.getActiveAlerts());
    setCommands(Array.from(new Set(
      devices.flatMap(device => iotDeviceManagement.getDeviceCommands(device.id))
    )));
    setMetrics(iotDeviceManagement.getDashboardMetrics());
  };

  const registerDevice = () => {
    iotDeviceManagement.registerDevice({
      name: 'New IoT Device',
      type: 'sensor',
      category: 'environmental',
      model: 'ENV-001',
      manufacturer: 'IoT Corp',
      firmwareVersion: '1.0.0',
      hardwareVersion: '1.0',
      serialNumber: `SN${Date.now()}`,
      macAddress: `00:11:22:33:44:${Math.floor(Math.random() * 256).toString(16).padStart(2, '0')}`,
      location: {},
      capabilities: ['temperature', 'humidity'],
      status: 'online',
      configuration: {},
      security: {
        authentication: true,
        encryption: true,
        certificates: []
      }
    });
    loadData();
  };

  const sendCommand = (deviceId: string) => {
    iotDeviceManagement.sendCommand(deviceId, 'restart', {});
    loadData();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'bg-green-500';
      case 'offline': return 'bg-red-500';
      case 'maintenance': return 'bg-yellow-500';
      case 'error': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-500';
      case 'high': return 'bg-orange-500';
      case 'medium': return 'bg-yellow-500';
      case 'low': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <div className="w-full h-full p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">IoT Device Management</h1>
        <div className="flex gap-2">
          <Button onClick={registerDevice}>Register Device</Button>
        </div>
      </div>

      {metrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{metrics.totalDevices}</div>
              <div className="text-sm text-muted-foreground">Total Devices</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{metrics.onlineDevices}</div>
              <div className="text-sm text-muted-foreground">Online</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{metrics.alertsCount}</div>
              <div className="text-sm text-muted-foreground">Active Alerts</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{metrics.commandsPending}</div>
              <div className="text-sm text-muted-foreground">Pending Commands</div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="border-b border-gray-200 mb-4">
        <nav className="flex space-x-8">
          <button
            onClick={() => setActiveTab('devices')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'devices'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Devices
          </button>
          <button
            onClick={() => setActiveTab('alerts')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'alerts'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Alerts
          </button>
          <button
            onClick={() => setActiveTab('commands')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'commands'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Commands
          </button>
        </nav>
      </div>

      {activeTab === 'devices' && (
        <div className="space-y-4">
          <div className="grid gap-4">
            {devices.map(device => (
              <Card key={device.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">{device.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        {device.manufacturer} {device.model} • {device.serialNumber}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Last seen: {device.lastSeen.toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 rounded text-xs text-white ${getStatusColor(device.status)}`}>
                        {device.status}
                      </span>
                      <Badge variant="outline">{device.type}</Badge>
                      <Button size="sm" onClick={() => sendCommand(device.id)}>
                        Send Command
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="font-medium">Capabilities:</span> {device.capabilities.join(', ')}
                    </div>
                    <div>
                      <span className="font-medium">Firmware:</span> {device.firmwareVersion}
                    </div>
                  </div>
                  {device.batteryLevel !== undefined && (
                    <div className="mt-3">
                      <div className="flex justify-between text-sm mb-1">
                        <span>Battery</span>
                        <span>{device.batteryLevel}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-green-600 h-2 rounded-full"
                          style={{ width: `${device.batteryLevel}%` }}
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'alerts' && (
        <div className="space-y-4">
          <div className="grid gap-4">
            {alerts.map(alert => {
              const device = devices.find(d => d.id === alert.deviceId);
              return (
                <Card key={alert.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold">{alert.message}</h3>
                        <p className="text-sm text-muted-foreground">
                          Device: {device?.name || alert.deviceId}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {alert.timestamp.toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={getSeverityColor(alert.severity)}>
                          {alert.severity}
                        </Badge>
                        <Badge variant="outline">{alert.type}</Badge>
                      </div>
                    </div>
                    {alert.value && (
                      <div className="mt-3">
                        <div className="text-sm">
                          <strong>Value:</strong> {String(alert.value)}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'commands' && (
        <div className="space-y-4">
          <div className="grid gap-4">
            {commands.map(command => {
              const device = devices.find(d => d.id === command.deviceId);
              return (
                <Card key={command.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold">{command.command}</h3>
                        <p className="text-sm text-muted-foreground">
                          Device: {device?.name || command.deviceId}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Sent: {command.sentAt.toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={
                          command.status === 'executed' ? 'default' :
                          command.status === 'failed' ? 'destructive' : 'secondary'
                        }>
                          {command.status}
                        </Badge>
                      </div>
                    </div>
                    {command.parameters && Object.keys(command.parameters).length > 0 && (
                      <div className="mt-3">
                        <div className="text-sm">
                          <strong>Parameters:</strong> {JSON.stringify(command.parameters)}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};