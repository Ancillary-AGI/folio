import React, { useState, useEffect } from 'react';
import { cybersecurityTools, SecurityScan, SecurityFinding, SecurityMetrics, IncidentResponse } from '../../lib/cybersecurity/cybersecurityTools';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';

export const CybersecurityDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState('overview');
  const [scans, setScans] = useState<SecurityScan[]>([]);
  const [findings, setFindings] = useState<SecurityFinding[]>([]);
  const [incidents, setIncidents] = useState<IncidentResponse[]>([]);
  const [metrics, setMetrics] = useState<SecurityMetrics | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = () => {
    setScans(cybersecurityTools.getAllSecurityScans());
    setFindings(cybersecurityTools.getAllSecurityFindings());
    setIncidents(cybersecurityTools.getAllIncidents());
    setMetrics(cybersecurityTools.calculateSecurityMetrics());
  };

  const runVulnerabilityScan = async () => {
    await cybersecurityTools.performVulnerabilityScan('localhost');
    loadData();
  };

  const createSecurityIncident = () => {
    cybersecurityTools.createIncident({
      title: 'Suspicious Network Activity',
      description: 'Unusual outbound connections detected',
      severity: 'high',
      status: 'detected',
      detectedAt: new Date(),
      affectedSystems: ['web-server-01'],
      indicators: ['suspicious.exe', 'malicious-domain.com'],
      timeline: [],
      containmentActions: [],
      eradicationActions: [],
      recoveryActions: []
    });
    loadData();
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'bg-red-500';
      case 'in_progress': return 'bg-blue-500';
      case 'resolved': return 'bg-green-500';
      case 'running': return 'bg-blue-500';
      case 'completed': return 'bg-green-500';
      case 'failed': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <div className="w-full h-full p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Cybersecurity Management</h1>
        <div className="flex gap-2">
          <Button onClick={runVulnerabilityScan}>Run Vulnerability Scan</Button>
          <Button onClick={createSecurityIncident}>Create Incident</Button>
        </div>
      </div>

      {metrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{metrics.overallRiskScore.toFixed(1)}</div>
              <div className="text-sm text-muted-foreground">Risk Score</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{metrics.criticalVulnerabilities}</div>
              <div className="text-sm text-muted-foreground">Critical Vulns</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{metrics.openIncidents}</div>
              <div className="text-sm text-muted-foreground">Open Incidents</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{metrics.complianceScore.toFixed(1)}%</div>
              <div className="text-sm text-muted-foreground">Compliance</div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="border-b border-gray-200 mb-4">
        <nav className="flex space-x-8">
          <button
            onClick={() => setActiveTab('overview')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'overview'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('scans')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'scans'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Security Scans
          </button>
          <button
            onClick={() => setActiveTab('findings')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'findings'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Findings
          </button>
          <button
            onClick={() => setActiveTab('incidents')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'incidents'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Incidents
          </button>
        </nav>
      </div>

      {activeTab === 'overview' && (
        <div className="grid gap-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Risk Assessment</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span>Overall Risk Score</span>
                    <span className="font-bold">{metrics?.overallRiskScore.toFixed(1) || 0}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-red-600 h-2 rounded-full"
                      style={{ width: `${Math.min(metrics?.overallRiskScore || 0, 100)}%` }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Compliance Status</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span>Compliance Score</span>
                    <span className="font-bold">{metrics?.complianceScore.toFixed(1) || 0}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-green-600 h-2 rounded-full"
                      style={{ width: `${metrics?.complianceScore || 0}%` }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {findings.slice(0, 5).map(finding => (
                  <div key={finding.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                    <div>
                      <div className="font-medium">{finding.title}</div>
                      <div className="text-sm text-muted-foreground">{finding.category}</div>
                    </div>
                    <Badge className={getSeverityColor(finding.severity)}>
                      {finding.severity}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'scans' && (
        <div className="space-y-4">
          <div className="grid gap-4">
            {scans.map(scan => (
              <Card key={scan.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">{scan.type} Scan</h3>
                      <p className="text-sm text-muted-foreground">Target: {scan.target}</p>
                      <p className="text-xs text-muted-foreground">
                        Started: {scan.startTime.toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 rounded text-xs text-white ${getStatusColor(scan.status)}`}>
                        {scan.status}
                      </span>
                      <span className="text-sm font-medium">Risk: {scan.riskScore}</span>
                    </div>
                  </div>
                  {scan.findings.length > 0 && (
                    <div className="mt-3">
                      <div className="text-sm text-muted-foreground mb-2">
                        Findings: {scan.findings.length}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'findings' && (
        <div className="space-y-4">
          <div className="grid gap-4">
            {findings.map(finding => (
              <Card key={finding.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">{finding.title}</h3>
                      <p className="text-sm text-muted-foreground">{finding.description}</p>
                      <p className="text-xs text-muted-foreground">
                        Category: {finding.category} • CVE: {finding.cve || 'N/A'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={getSeverityColor(finding.severity)}>
                        {finding.severity}
                      </Badge>
                      <Badge variant={finding.status === 'open' ? 'destructive' : 'default'}>
                        {finding.status}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="text-sm">
                      <strong>Remediation:</strong> {finding.remediation}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'incidents' && (
        <div className="space-y-4">
          <div className="grid gap-4">
            {incidents.map(incident => (
              <Card key={incident.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">{incident.title}</h3>
                      <p className="text-sm text-muted-foreground">{incident.description}</p>
                      <p className="text-xs text-muted-foreground">
                        Detected: {incident.detectedAt.toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={getSeverityColor(incident.severity)}>
                        {incident.severity}
                      </Badge>
                      <Badge variant={incident.status === 'resolved' ? 'default' : 'destructive'}>
                        {incident.status}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="text-sm text-muted-foreground">
                      Affected Systems: {incident.affectedSystems.join(', ')}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};