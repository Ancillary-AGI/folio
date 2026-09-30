import { useState } from 'react';
import { designMarketplace } from '../../lib/marketplace/designMarketplace';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';

export default function MarketplacePanel() {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState(designMarketplace.search());
  const [installed, setInstalled] = useState(designMarketplace.getInstalled());

  const search = (value: string) => {
    setQuery(value);
    setItems(designMarketplace.search(value));
  };

  const install = (id: string) => {
    designMarketplace.install(id);
    setInstalled(designMarketplace.getInstalled());
    setItems(designMarketplace.search(query));
  };

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
    </div>
  );
}
