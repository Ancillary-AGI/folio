import { useState } from 'react';
import { X, Monitor, Palette, Grid3X3, Save, RotateCcw, Globe, Zap, Check, BookOpen, Ruler } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { useAppStore } from '../stores/useAppStore';
import { useTheme } from '../lib/theme/useTheme';
import { contrastRatio, THEME_DESCRIPTORS, THEMES } from '../lib/theme/tokens';
import { hasCompletedOnboarding, resetOnboarding } from '../lib/onboarding/onboardingStorage';

interface SettingsPanelProps {
  onClose: () => void;
}

/**
 * Settings.
 *
 * Every control here writes to `useAppStore.settings` (or the theme controller)
 * and therefore has a visible effect. There are deliberately no decorative
 * toggles: a setting that does nothing is worse than no setting at all.
 */
export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { settings, updateSettings } = useAppStore();
  const { preference, theme: resolvedTheme, setPreference } = useTheme();
  const [draft, setDraft] = useState(settings);
  const [dirty, setDirty] = useState(false);
  const [guideReset, setGuideReset] = useState(() => !hasCompletedOnboarding());

  const patch = (updates: Partial<typeof settings>) => {
    setDraft((current) => ({ ...current, ...updates }));
    setDirty(true);
  };

  const save = () => {
    updateSettings(draft);
    setDirty(false);
  };

  const discard = () => {
    setDraft(settings);
    setDirty(false);
  };

  /*
   * Theme options come from the token module, so the picker cannot offer a
   * preference the controller does not implement. The contrast figure is the
   * same maths the unit tests assert, so it can never overstate legibility.
   */
  const themeOptions = THEME_DESCRIPTORS.map((descriptor) => {
    const previewTheme = descriptor.id === 'system' ? resolvedTheme : descriptor.id;
    const tokens = THEMES[previewTheme];
    return {
      ...descriptor,
      contrast: contrastRatio(tokens['--foreground'], tokens['--background']),
    };
  });

  const languages = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Español' },
    { code: 'fr', name: 'Français' },
    { code: 'de', name: 'Deutsch' },
    { code: 'zh', name: '中文' },
    { code: 'ja', name: '日本語' },
  ];

  /** Small, honest preview of a theme drawn from that theme's own tokens. */
  const renderSwatch = (id: string, active: boolean) => {
    const tokens = THEMES[id === 'system' ? resolvedTheme : (id as keyof typeof THEMES)];
    return (
      <span
        aria-hidden="true"
        className="grid h-10 w-14 shrink-0 grid-cols-2 gap-1 rounded-md border-2 p-1"
        style={{
          background: `hsl(${tokens['--background']})`,
          borderColor: active ? `hsl(${tokens['--primary']})` : `hsl(${tokens['--border']})`,
        }}
      >
        <span className="rounded-sm" style={{ background: `hsl(${tokens['--card']})` }} />
        <span className="rounded-sm" style={{ background: `hsl(${tokens['--primary']})` }} />
        <span className="rounded-sm" style={{ background: `hsl(${tokens['--foreground']})` }} />
        <span className="rounded-sm" style={{ background: `hsl(${tokens['--muted']})` }} />
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/70 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="app-panel flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border shadow-2xl"
      >
        {/* Header */}
        <div className="app-chrome app-chrome-divider flex shrink-0 items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-2">
            <Monitor className="h-5 w-5 text-primary" />
            <h2 id="settings-title" className="text-lg font-semibold text-surface-foreground">
              Settings
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {dirty && (
              <>
                <Button variant="outline" size="sm" onClick={discard}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Discard
                </Button>
                <Button size="sm" onClick={save}>
                  <Save className="mr-2 h-4 w-4" />
                  Save changes
                </Button>
              </>
            )}
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close settings">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* ── Appearance ── */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Palette className="h-4 w-4" />
                  Appearance
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <fieldset>
                  <legend className="mb-2 block text-sm font-medium text-card-foreground">Theme</legend>
                  <div className="grid grid-cols-1 gap-2" role="radiogroup" aria-label="Theme">
                    {themeOptions.map((option) => {
                      const active = preference === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => setPreference(option.id)}
                          className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                            active
                              ? 'border-primary bg-primary/10'
                              : 'border-border hover:border-primary/60 hover:bg-accent'
                          }`}
                        >
                          {renderSwatch(option.id, active)}
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2 text-sm font-medium text-card-foreground">
                              {option.label}
                              {active && <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" />}
                            </span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {option.description}
                            </span>
                            <span className="mt-0.5 block text-[11px] text-muted-foreground">
                              Text contrast {option.contrast.toFixed(1)}:1
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Theme changes apply immediately; the other settings below apply when saved.
                  </p>
                </fieldset>

                <label className="flex items-center justify-between gap-4">
                  <span className="text-sm text-card-foreground">
                    Interface animations
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      Turn off for reduced-motion preferences.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[hsl(var(--primary))]"
                    checked={draft.animations}
                    onChange={(event) => patch({ animations: event.target.checked })}
                  />
                </label>
              </CardContent>
            </Card>

            {/* ── Canvas & grid ── */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Grid3X3 className="h-4 w-4" />
                  Canvas &amp; grid
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label htmlFor="grid-size" className="mb-1 block text-sm font-medium text-card-foreground">
                    Grid pitch ({draft.units === 'metric' ? 'mm' : 'mil'})
                  </label>
                  <input
                    id="grid-size"
                    type="number"
                    min={1}
                    max={100}
                    value={draft.gridSize}
                    onChange={(event) => patch({ gridSize: Number(event.target.value) || 1 })}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                  />
                </div>

                {(
                  [
                    ['snapToGrid', 'Snap to grid', 'Constrain placement and wires to the grid.'],
                    ['showGrid', 'Show grid', 'Draw the grid on schematic and PCB canvases.'],
                    ['showRulers', 'Show rulers', 'Display coordinate rulers along the sheet edges.'],
                  ] as const
                ).map(([key, label, hint]) => (
                  <label key={key} className="flex items-center justify-between gap-4">
                    <span className="text-sm text-card-foreground">
                      {label}
                      <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
                    </span>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[hsl(var(--primary))]"
                      checked={draft[key]}
                      onChange={(event) => patch({ [key]: event.target.checked } as Partial<typeof settings>)}
                    />
                  </label>
                ))}
              </CardContent>
            </Card>

            {/* ── Workspace ── */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Globe className="h-4 w-4" />
                  Workspace
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label htmlFor="units" className="mb-1 block text-sm font-medium text-card-foreground">
                    Measurement units
                  </label>
                  <select
                    id="units"
                    value={draft.units}
                    onChange={(event) => patch({ units: event.target.value as typeof settings.units })}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                  >
                    <option value="metric">Metric (mm, mm², g)</option>
                    <option value="imperial">Imperial (mil, in, oz)</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="language" className="mb-1 block text-sm font-medium text-card-foreground">
                    Interface language
                  </label>
                  <select
                    id="language"
                    value={draft.language}
                    onChange={(event) => patch({ language: event.target.value })}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                  >
                    {languages.map((language) => (
                      <option key={language.code} value={language.code}>
                        {language.name}
                      </option>
                    ))}
                  </select>
                </div>

                <label className="flex items-center justify-between gap-4">
                  <span className="text-sm text-card-foreground">
                    Autosave
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      Write a checkpoint on the interval below.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[hsl(var(--primary))]"
                    checked={draft.autoSave}
                    onChange={(event) => patch({ autoSave: event.target.checked })}
                  />
                </label>

                <div>
                  <label htmlFor="autosave-interval" className="mb-1 block text-sm font-medium text-card-foreground">
                    Autosave interval (seconds)
                  </label>
                  <input
                    id="autosave-interval"
                    type="number"
                    min={10}
                    max={600}
                    step={5}
                    disabled={!draft.autoSave}
                    value={Math.round(draft.autoSaveInterval / 1000)}
                    onChange={(event) =>
                      patch({ autoSaveInterval: (Number(event.target.value) || 30) * 1000 })
                    }
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground disabled:opacity-50"
                  />
                </div>
              </CardContent>
            </Card>

            {/* ── Environment & help ── */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Zap className="h-4 w-4" />
                  Environment
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Resolved theme</dt>
                    <dd className="font-medium text-card-foreground">{resolvedTheme}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Preference</dt>
                    <dd className="font-medium text-card-foreground">{preference}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Text on background</dt>
                    <dd className="inline-flex items-center gap-1 font-medium text-card-foreground">
                      <Ruler className="h-3.5 w-3.5" aria-hidden="true" />
                      {contrastRatio(
                        THEMES[resolvedTheme]['--foreground'],
                        THEMES[resolvedTheme]['--background'],
                      ).toFixed(1)}
                      :1
                    </dd>
                  </div>
                </dl>

                <div className="rounded-md border border-border bg-muted/50 p-3">
                  <p className="text-sm font-medium text-card-foreground">Getting-started guide</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {guideReset
                      ? 'The guide is currently marked as seen.'
                      : 'The guide has not been completed yet.'}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => {
                      resetOnboarding();
                      setGuideReset(true);
                    }}
                  >
                    <BookOpen className="mr-2 h-4 w-4" />
                    {guideReset ? 'Reset the guide' : 'Already reset'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Footer */}
        {dirty && (
          <div className="app-chrome flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-3">
            <p className="text-sm text-muted-foreground">You have unsaved changes.</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={discard}>
                Discard
              </Button>
              <Button size="sm" onClick={save}>
                Save settings
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
