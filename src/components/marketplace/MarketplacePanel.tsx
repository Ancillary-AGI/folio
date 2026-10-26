import { useState } from 'react';
import { designMarketplace } from '../../lib/marketplace/designMarketplace';
import type { DemoMarketplaceBundle } from '../../lib/demo/demoMarketplace';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { useDemoRequest } from '../workspace/useDemoRequest';

export default function MarketplacePanel() {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState(designMarketplace.search());
  const [installed, setInstalled] = useState(designMarketplace.getInstalled());
  const [verdict, setVerdict] = useState<DemoMarketplaceBundle | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  const search = (value: string) => {
    setQuery(value);
    setItems(designMarketplace.search(value));
  };

  const install = (id: string) => {
    designMarketplace.install(id);
    setInstalled(designMarketplace.getInstalled());
    setItems(designMarketplace.search(query));
  };

  const publishDemoBundle = () => {
    setPublishError(null);
    void import('../../lib/demo/demoMarketplace')
      .then((m) => {
        const result = m.buildDemoMarketplaceBundle(designMarketplace);
        setVerdict(result);
        setInstalled(designMarketplace.getInstalled());
        setQuery('rectifier');
        setItems(designMarketplace.search('rectifier'));
      })
      .catch((error: unknown) => {
        setVerdict(null);
        setPublishError(error instanceof Error ? error.message : 'Publish round-trip failed.');
      });
  };

  useDemoRequest('marketplace-bundle', publishDemoBundle);

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      <h2 className="text-xl font-semibold">Design marketplace</h2>
      <input
        className="w-full border rounded-md p-2 bg-background"
        placeholder="Search PCB, robotics, plugins…"
        value={query}
        onChange={(e) => search(e.target.value)}
      />
      <div className="grid md:grid-cols-2 gap-4">
        {items.map((item) => (
          <Card key={item.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <span>{item.title}</span>
                <Badge>{item.category}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-muted-foreground">{item.description}</p>
              <p>{item.author} · v{item.version} · ★ {item.rating} · {item.downloads} installs</p>
              <Button size="sm" onClick={() => install(item.id)}>Install into project</Button>
            </CardContent>
          </Card>
        ))}
      </div>
      {installed.length > 0 && (
        <p className="text-sm text-muted-foreground">Installed: {installed.map((i) => i.title).join(', ')}</p>
      )}
      <Card>
        <CardContent className="space-y-2 p-4 text-sm">
          <p className="text-muted-foreground">
            Publish the proven rectifier bundle (schematic + fab data + firmware) as a versioned listing.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={publishDemoBundle}
          >
            Publish rectifier bundle
          </Button>
          {publishError && <p role="alert" className="text-destructive">{publishError}</p>}
        </CardContent>
      </Card>
      {verdict && (
        <Card>
          <CardContent role="status" aria-label="Publish verdict" className="space-y-1 p-4 text-sm">
            <p className={verdict.installedOk ? 'font-medium text-success' : 'font-medium text-destructive'}>
              {verdict.verdict}
            </p>
            <p className="text-muted-foreground">
              Listing <span className="font-mono">{verdict.listingId}</span> · {verdict.parts} parts ·{' '}
              {verdict.sketchBytes} firmware bytes · round-trip {verdict.installedOk ? 'byte-identical' : 'failed'}.
            </p>
            <p className="text-xs text-muted-foreground">
              The listing and its install state live in this browser's local marketplace; nothing was uploaded.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
