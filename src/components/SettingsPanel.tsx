import HoverHelp from './ui/HoverHelp'
import { useModalFocus } from './ui/useModalFocus'
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Book,
  Box,
  Check,
  CircuitBoard,
  Code2,
  Copy,
  FileOutput,
  Keyboard,
  LayoutGrid,
  Monitor,
  Palette,
  RotateCcw,
  Save,
  Search,
  MessageSquare,
  X,
} from 'lucide-react';
import { Button } from './ui/button';
import { RangeControl } from './ui/range-control';
import { useAppStore } from '../stores/useAppStore';
import type { AppSettings } from '../stores/useAppStore';
import { useTheme } from '../lib/theme/useTheme';
import { contrastRatio, THEME_DESCRIPTORS, THEMES, type ThemeId, type ThemePreference } from '../lib/theme/tokens';
import {
  DEFAULT_SETTINGS,
  SETTING_CATEGORIES,
  SETTING_DEFINITIONS,
  type SettingCategory,
  type SettingDefinition,
} from '../lib/settings/registry';
import ShortcutEditor from './help/ShortcutEditor';
import ModelSettingsPanel from './ecad/agent/ModelSettingsPanel';

interface SettingsPanelProps {
  onClose: () => void;
  onRestartOnboarding: () => void;
}

/** Rail entries that host a whole surface instead of a list of rows. */
const EMBEDDED_SECTIONS = [
  {
    id: 'shortcuts',
    title: 'Keyboard shortcuts',
    blurb: 'Every binding the shell answers to, editable. This is the live registry, not a poster of one.',
    icon: Keyboard,
    keywords: ['key', 'binding', 'hotkey', 'ctrl', 'shortcut'],
  },
  {
    id: 'models',
    title: 'Copilot models',
    blurb:
      'Bring your own key or point at a local model for Copilot\'s tool plans. Keys stay in this browser and are never written into a design, a snapshot or a transcript.',
    icon: MessageSquare,
    keywords: ['byok', 'api', 'key', 'openai', 'anthropic', 'ollama', 'llm', 'provider', 'agent'],
  },
] as const;

type RailId = SettingCategory | (typeof EMBEDDED_SECTIONS)[number]['id'];

const CATEGORY_ICONS: Record<SettingCategory, typeof Palette> = {
  general: Palette,
  drafting: LayoutGrid,
  board: CircuitBoard,
  simulation: Activity,
  viewport: Box,
  editor: Code2,
  output: FileOutput,
  saving: Save,
};

/** A row is wide when its control belongs under the text rather than to the right of it. */
const isWideRow = (definition: SettingDefinition): boolean =>
  definition.control.kind === 'slider' || definition.control.kind === 'theme';

function matchesQuery(definition: SettingDefinition, needle: string): boolean {
  const categoryName = SETTING_CATEGORIES.find((category) => category.id === definition.category)?.title ?? '';
  return [definition.title, definition.description, definition.category, categoryName, ...(definition.keywords ?? [])]
    .join(' ')
    .toLowerCase()
    .includes(needle);
}

/**
 * Settings.
 *
 * The IDE shape: a rail of sections, a search that finds a setting by any word
 * attached to it, and live application — there is no Save button, because a
 * preference that only takes effect after a second action is one people mis-trust.
 * Each row writes the same field the rest of the app reads, so the tool rail, a
 * viewport HUD and this page cannot disagree, and a reset here and a reset on a
 * row mean the same thing.
 *
 * The registry decides what appears: a setting with no consumer is not offered,
 * because a toggle that changes a number nobody reads teaches the user that
 * settings in this app are decorative.
 */
export default function SettingsPanel({ onClose, onRestartOnboarding }: SettingsPanelProps) {
  const settings = useAppStore((state) => state.settings);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const resetSettings = useAppStore((state) => state.resetSettings);
  const { preference, theme: resolvedTheme, setPreference } = useTheme();
  const [activeSection, setActiveSection] = useState<RailId>('general');
  const [query, setQuery] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const needle = query.trim().toLowerCase();
  const searching = needle.length > 0;

  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /*
   * The modal contract: focus arrives on the search field, Tab circulates
   * inside the panel, Escape closes, focus returns to whatever opened it.
   */
  useModalFocus(panelRef, onClose, { initialFocus: searchRef });

  const visibleDefinitions = useMemo(
    () =>
      SETTING_DEFINITIONS.filter((definition) =>
        searching ? matchesQuery(definition, needle) : definition.category === activeSection,
      ),
    [activeSection, needle, searching],
  );

  const visibleEmbedded = useMemo(
    () =>
      EMBEDDED_SECTIONS.filter((section) =>
        searching
          ? [section.title, section.blurb, ...section.keywords].join(' ').toLowerCase().includes(needle)
          : section.id === activeSection,
      ),
    [activeSection, needle, searching],
  );

  const changedKeys = (Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>).filter(
    (key) => settings[key] !== DEFAULT_SETTINGS[key],
  );

  /** One write path for every control; the store clamps the value on the way in. */
  const write = (key: keyof AppSettings, value: unknown) => {
    const patch: Partial<Record<keyof AppSettings, unknown>> = { [key]: value };
    updateSettings(patch as Partial<AppSettings>);
  };

  const copyTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    },
    [],
  );

  const copyAsJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(settings, null, 2));
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    // One pending reset only: an earlier copy's timer must not flip a later
    // copy back to idle mid-window, and no timer outlives the panel.
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => {
      copyTimerRef.current = null;
      setCopyState('idle');
    }, 2500);
  };

  /*
   * Theme options come from the token module, so the picker cannot offer a
   * preference the controller does not implement. The contrast figure is the same
   * maths the unit tests assert, so it can never overstate legibility.
   */
  const themeOptions = THEME_DESCRIPTORS.map((descriptor) => {
    const previewTheme: ThemeId = descriptor.id === 'system' ? resolvedTheme : descriptor.id;
    const tokens = THEMES[previewTheme];
    return {
      ...descriptor,
      contrast: contrastRatio(tokens['--foreground'], tokens['--background']),
    };
  });

  /** Small, honest preview of a theme drawn from that theme's own tokens. */
  const renderSwatch = (id: string, active: boolean) => {
    const tokens = THEMES[id === 'system' ? resolvedTheme : (id as ThemeId)];
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

  const renderThemePicker = () => (
    <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Theme">
      {themeOptions.map((option) => {
        const active = preference === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setPreference(option.id as ThemePreference)}
            className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
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
              <span className="mt-0.5 block text-xs text-muted-foreground">{option.description}</span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                Text contrast {option.contrast.toFixed(1)}:1
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );

  const renderControl = (definition: SettingDefinition) => {
    const value = settings[definition.key];
    const control = definition.control;
    const disabled = definition.dependsOn !== undefined && settings[definition.dependsOn] === false;

    if (control.kind === 'theme') return renderThemePicker();

    if (control.kind === 'toggle') {
      const on = Boolean(value);
      return (
        <HoverHelp title={definition.title} description={`Turn ${definition.title} on or off.`}>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={definition.title}
            disabled={disabled}
            onClick={() => write(definition.key, !on)}
            className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${
              on ? 'border-primary/50 bg-primary/30' : 'border-border bg-background'
            } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
          >
          {/* The knob carries its own edge so it survives forced-colours mode. */}
          <span
            aria-hidden="true"
            className={`absolute top-0.5 left-0 h-4 w-4 rounded-full transition-transform ${
              on ? 'bg-primary' : 'bg-muted-foreground'
            }`}
            style={{ transform: on ? 'translateX(18px)' : 'translateX(2px)' }}
          />
          </button>
        </HoverHelp>
      );
    }

    if (control.kind === 'select') {
      return (
        <select
          id={`setting-${definition.key}`}
          aria-label={definition.title}
          disabled={disabled}
          value={String(value)}
          onChange={(event) => {
            const option = control.options.find((candidate) => String(candidate.value) === event.target.value);
            write(definition.key, option?.value);
          }}
          className={`cad-form-select ${isWideRow(definition) ? 'w-full' : ''}`}
        >
          {control.options.map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.hint ? `${option.label} — ${option.hint}` : option.label}
            </option>
          ))}
        </select>
      );
    }

    if (control.kind === 'slider') {
      return (
        <RangeControl
          label={definition.title}
          value={Number(value)}
          min={control.min}
          max={control.max}
          step={control.step}
          compact
          disabled={disabled}
          format={control.format}
          onValueChange={(next) => write(definition.key, next)}
        />
      );
    }

    return (
      <span className="cad-form-field w-32 shrink-0" data-disabled={disabled || undefined}>
        <input
          id={`setting-${definition.key}`}
          type="number"
          aria-label={definition.title}
          aria-describedby={control.unit ? `setting-${definition.key}-unit` : undefined}
          min={control.min}
          max={control.max}
          step={control.step}
          disabled={disabled}
          value={Number(value)}
          onChange={(event) => write(definition.key, event.target.valueAsNumber)}
          className="cad-form-input"
        />
        {control.unit && (
          <span id={`setting-${definition.key}-unit`} className="cad-form-unit">
            {control.unit}
          </span>
        )}
      </span>
    );
  };

  const renderRow = (definition: SettingDefinition) => {
    const modified = settings[definition.key] !== DEFAULT_SETTINGS[definition.key];
    const wide = isWideRow(definition);
    const control = definition.control;
    /*
     * The reset control keeps its slot whether or not it is showing. Without the
     * placeholder, a row that has been touched slides its field 36px left of every
     * row that has not, and a column of settings stops lining up — the user sees a
     * page that appears to be misaligned rather than one that is honestly reactive.
     */
    const resetSlot = modified ? (
      <HoverHelp title={`Reset ${definition.title}`} description="Restore the default value for this setting.">
        <Button
          variant="ghost"
          size="bar-icon"
          aria-label={`Reset ${definition.title} to default`}
          onClick={() => resetSettings([definition.key])}
        >
        <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      </HoverHelp>
    ) : (
      <span aria-hidden="true" className="h-7 w-7 shrink-0" />
    );
    return (
      <div
        key={definition.key}
        className={`border-b border-border/60 py-3 last:border-b-0 ${
          wide ? 'space-y-2' : 'flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6'
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-card-foreground">{definition.title}</span>
            {modified && <span className="cad-chip">modified</span>}
          </div>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{definition.description}</p>
          {definition.alsoIn && (
            <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
              Also reachable in {definition.alsoIn}.
            </p>
          )}
        </div>
        {wide ? (
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">{renderControl(definition)}</div>
            {control.kind === 'slider' && (
              <span className="cad-slider-value shrink-0">{control.format(Number(settings[definition.key]))}</span>
            )}
            {resetSlot}
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-2">
            {renderControl(definition)}
            {resetSlot}
          </div>
        )}
      </div>
    );
  };

  const railItem = (id: RailId, title: string, Icon: typeof Palette, modifiedCount: number) => {
    const active = !searching && activeSection === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => {
          setActiveSection(id);
          setQuery('');
        }}
        aria-current={active ? 'true' : undefined}
        className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors ${
          active
            ? 'bg-primary/15 font-medium text-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground'
        }`}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {modifiedCount > 0 && (
          <>
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
            <span className="sr-only">{modifiedCount} changed from default</span>
          </>
        )}
      </button>
    );
  };

  return (
    <div
      className="modal-scrim"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="app-panel animate-rise-in flex h-[min(92vh,760px)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border shadow-2xl"
      >
        {/* Header: the page and the search that drives it */}
        <div className="app-chrome app-chrome-divider flex shrink-0 flex-wrap items-center gap-3 px-5 py-3">
          <div className="flex items-center gap-2">
            <Monitor className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 id="settings-title" className="text-base font-semibold text-surface-foreground">
              Settings
            </h2>
          </div>
          <div className="cad-search ml-auto flex h-7 w-full max-w-xs items-center gap-2 rounded-md border border-input bg-background px-2.5 sm:w-64">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search settings"
              aria-label="Search settings"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none"
            />
            {query && (
              <HoverHelp title="Clear the search" description="Empty the search box.">
                <button
                  type="button"
                  aria-label="Clear the search"
                  onClick={() => setQuery('')}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </HoverHelp>
            )}
          </div>
          <HoverHelp title="Close settings. Every change you made is already applied." description="Close settings. Every change you made is already applied.">
<Button variant="ghost" size="bar-icon" onClick={onClose} aria-label="Close settings">
            <X className="h-3.5 w-3.5" />
          </Button>
</HoverHelp>
        </div>

        <div className="flex min-h-0 flex-1">
          <nav
            aria-label="Settings sections"
            className="scrollbar-thin hidden w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-2 sm:flex"
          >
            {SETTING_CATEGORIES.map((category) =>
              railItem(
                category.id,
                category.title,
                CATEGORY_ICONS[category.id],
                SETTING_DEFINITIONS.filter(
                  (definition) =>
                    definition.category === category.id &&
                    settings[definition.key] !== DEFAULT_SETTINGS[definition.key],
                ).length,
              ),
            )}
            <div className="my-1 border-t border-border" aria-hidden="true" />
            {EMBEDDED_SECTIONS.map((section) => railItem(section.id, section.title, section.icon, 0))}
          </nav>

          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <p className="mb-1 text-xs text-muted-foreground">
              {searching
                ? visibleDefinitions.length + visibleEmbedded.length === 0
                  ? `Nothing matches “${query}”.`
                  : `${visibleDefinitions.length + visibleEmbedded.length} result(s) for “${query}”.`
                : SETTING_CATEGORIES.find((category) => category.id === activeSection)?.blurb ??
                  EMBEDDED_SECTIONS.find((section) => section.id === activeSection)?.blurb}
            </p>

            {visibleDefinitions.map((definition) => renderRow(definition))}

            {visibleEmbedded.map((section) => (
              <section key={section.id} className="mt-4 first:mt-0">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-surface-foreground">
                  <section.icon className="h-4 w-4 text-primary" aria-hidden="true" />
                  {section.title}
                </h3>
                {section.id === 'shortcuts' ? <ShortcutEditor query="" /> : <ModelSettingsPanel />}
              </section>
            ))}

            {!searching && activeSection === 'general' && (
              <div className="mt-4 rounded-lg border border-border bg-card/40 p-3">
                <h3 className="mb-2 text-xs font-medium text-muted-foreground">
                  Environment
                </h3>
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
                    <dd className="font-medium text-card-foreground">
                      {contrastRatio(THEMES[resolvedTheme]['--foreground'], THEMES[resolvedTheme]['--background']).toFixed(1)}
                      :1
                    </dd>
                  </div>
                </dl>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="outline" size="bar" onClick={onRestartOnboarding}>
                    <Book aria-hidden="true" />
                    Restart guided setup
                  </Button>
                  <Button variant="outline" size="bar" onClick={() => void copyAsJson()}>
                    <Copy aria-hidden="true" />
                    {copyState === 'copied'
                      ? 'Copied'
                      : copyState === 'failed'
                        ? 'Clipboard blocked'
                        : 'Copy settings as JSON'}
                  </Button>
                </div>
                <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                  The JSON is the same object the app acts on, so pasting it into a chat tells Copilot how you
                  work. It holds no keys and no project data.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="app-chrome flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
          <p className="text-xs text-muted-foreground">
            {changedKeys.length === 0
              ? 'Every setting is at its default.'
              : `${changedKeys.length} of ${Object.keys(DEFAULT_SETTINGS).length} changed from default. Changes apply as you make them.`}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="bar" disabled={changedKeys.length === 0} onClick={() => resetSettings()}>
              <RotateCcw aria-hidden="true" />
              Reset all
            </Button>
            <Button size="bar" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
