import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import {
  DEFAULT_SETTINGS,
  useSettingsStore,
  type AppSettings,
  type GraphGroup,
} from "../../store/settingsStore";
import { Toggle } from "../ui/Toggle";

type GraphSettings = AppSettings["graph"];

interface GraphControlsProps {
  search: string;
  onSearchChange: (query: string) => void;
  local: boolean;
  onAnimate: () => void;
}

function PanelSection({
  title,
  children,
  initiallyOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <section className="graph-panel-section">
      <button
        type="button"
        className="graph-panel-section-title"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <span>{title}</span>
      </button>
      {open && <div className="graph-panel-section-body">{children}</div>}
    </section>
  );
}

function PanelToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="graph-panel-row">
      <span>{label}</span>
      <Toggle checked={checked} onChange={onChange} ariaLabel={label} />
    </div>
  );
}

function PanelSlider({
  label,
  value,
  min,
  max,
  step,
  digits = 0,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  digits?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="graph-panel-slider">
      <span className="graph-panel-slider-label">
        <span>{label}</span>
        <output>{value.toFixed(digits)}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function groupId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `group-${Date.now()}-${Math.random()}`;
}

export function GraphControls({
  search,
  onSearchChange,
  local,
  onAnimate,
}: GraphControlsProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(true);
  const settings = useSettingsStore((state) => state.settings.graph);
  const setSettings = useSettingsStore((state) => state.setSettings);
  const setGraph = (partial: Partial<GraphSettings>) =>
    setSettings({ graph: { ...settings, ...partial } });

  const updateGroup = (id: string, partial: Partial<GraphGroup>) => {
    setGraph({
      groups: settings.groups.map((group) =>
        group.id === id ? { ...group, ...partial } : group,
      ),
    });
  };

  if (collapsed) {
    return (
      <button
        type="button"
        className="graph-panel-collapsed"
        title={t("graph.settings")}
        aria-label={t("graph.settings")}
        onClick={() => setCollapsed(false)}
      >
        <Settings size={17} strokeWidth={1.75} />
      </button>
    );
  }

  return (
    <aside className="graph-panel" aria-label={t("graph.settings")}>
      <header className="graph-panel-header">
        <span>{t("graph.settings")}</span>
        <div className="graph-panel-header-actions">
          <button
            type="button"
            title={t("graph.restoreDefaults")}
            aria-label={t("graph.restoreDefaults")}
            onClick={() => setSettings({ graph: DEFAULT_SETTINGS.graph })}
          >
            <RotateCcw size={15} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            title={t("graph.collapse")}
            aria-label={t("graph.collapse")}
            onClick={() => setCollapsed(true)}
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>
      </header>

      <PanelSection title={t("graph.filters")}>
        {local && (
          <PanelSlider
            label={t("graph.depth")}
            value={settings.localDepth}
            min={1}
            max={6}
            step={1}
            onChange={(localDepth) => setGraph({ localDepth })}
          />
        )}
        <label className="graph-panel-search">
          <Search size={14} strokeWidth={1.75} />
          <input
            type="search"
            value={search}
            placeholder={t("graph.searchPlaceholder")}
            spellCheck={false}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </label>
        <PanelToggle
          label={t("graph.tags")}
          checked={settings.showTags}
          onChange={(showTags) => setGraph({ showTags })}
        />
        <PanelToggle
          label={t("graph.attachments")}
          checked={settings.showAttachments}
          onChange={(showAttachments) => setGraph({ showAttachments })}
        />
        <PanelToggle
          label={t("graph.existingFilesOnly")}
          checked={settings.existingFilesOnly}
          onChange={(existingFilesOnly) => setGraph({ existingFilesOnly })}
        />
        <PanelToggle
          label={t("graph.orphans")}
          checked={settings.showOrphans}
          onChange={(showOrphans) => setGraph({ showOrphans })}
        />
      </PanelSection>

      <PanelSection title={t("graph.groups")} initiallyOpen={false}>
        {settings.groups.map((group) => (
          <div className="graph-group" key={group.id}>
            <input
              className="graph-group-color"
              type="color"
              value={group.color}
              aria-label={t("graph.groupColor")}
              onChange={(event) => updateGroup(group.id, { color: event.target.value })}
            />
            <input
              className="graph-group-query"
              value={group.query}
              placeholder={t("graph.groupQuery")}
              spellCheck={false}
              onChange={(event) => updateGroup(group.id, { query: event.target.value })}
            />
            <button
              type="button"
              title={t("graph.removeGroup")}
              aria-label={t("graph.removeGroup")}
              onClick={() =>
                setGraph({ groups: settings.groups.filter((item) => item.id !== group.id) })
              }
            >
              <Trash2 size={14} strokeWidth={1.75} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="graph-add-group"
          onClick={() =>
            setGraph({
              groups: [
                ...settings.groups,
                { id: groupId(), query: "", color: "#d97757" },
              ],
            })
          }
        >
          <Plus size={14} strokeWidth={1.75} />
          {t("graph.newGroup")}
        </button>
      </PanelSection>

      <PanelSection title={t("graph.display")} initiallyOpen={false}>
        <PanelToggle
          label={t("graph.arrows")}
          checked={settings.showArrows}
          onChange={(showArrows) => setGraph({ showArrows })}
        />
        <PanelSlider
          label={t("graph.textFadeThreshold")}
          value={settings.textFadeThreshold}
          min={-3}
          max={3}
          step={0.1}
          digits={1}
          onChange={(textFadeThreshold) => setGraph({ textFadeThreshold })}
        />
        <PanelSlider
          label={t("graph.nodeSize")}
          value={settings.nodeSize}
          min={0.1}
          max={5}
          step={0.1}
          digits={1}
          onChange={(nodeSize) => setGraph({ nodeSize })}
        />
        <PanelSlider
          label={t("graph.linkThickness")}
          value={settings.linkThickness}
          min={0.1}
          max={5}
          step={0.1}
          digits={1}
          onChange={(linkThickness) => setGraph({ linkThickness })}
        />
        <button type="button" className="graph-animate" onClick={onAnimate}>
          <Play size={14} strokeWidth={1.75} />
          {t("graph.animate")}
        </button>
      </PanelSection>

      <PanelSection title={t("graph.forces")} initiallyOpen={false}>
        <PanelSlider
          label={t("graph.centerForce")}
          value={settings.centerStrength}
          min={0}
          max={1}
          step={0.01}
          digits={2}
          onChange={(centerStrength) => setGraph({ centerStrength })}
        />
        <PanelSlider
          label={t("graph.repelForce")}
          value={settings.repulsion}
          min={0}
          max={20}
          step={0.25}
          digits={2}
          onChange={(repulsion) => setGraph({ repulsion })}
        />
        <PanelSlider
          label={t("graph.linkForce")}
          value={settings.linkStrength}
          min={0}
          max={1}
          step={0.01}
          digits={2}
          onChange={(linkStrength) => setGraph({ linkStrength })}
        />
        <PanelSlider
          label={t("graph.linkDistance")}
          value={settings.linkDistance}
          min={30}
          max={500}
          step={1}
          onChange={(linkDistance) => setGraph({ linkDistance })}
        />
      </PanelSection>
    </aside>
  );
}
