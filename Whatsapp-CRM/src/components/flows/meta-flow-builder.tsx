"use client";

/**
 * Meta WhatsApp Flows Builder
 *
 * 3-panel layout matching the Meta Flows Playground:
 *   LEFT  — Screens list (add / remove / reorder)
 *   CENTER — Component editor for the selected screen
 *   RIGHT  — Live phone preview
 */

import { useState, useCallback, useEffect, useRef, createContext, useContext } from "react";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Plus,
  GripVertical,
  X,
  ChevronDown,
  ChevronUp,
  Trash2,
  SmartphoneIcon,
  Copy,
  Settings,
  Upload,
  Send,
  Loader2,
  RefreshCw,
  Check,
  Play,
  RotateCcw,
  ChevronLeft as ChevronLeftIcon,
  CheckCircle2,
  ArrowRight,
  Flag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  COMPONENT_GROUPS,
  COMPONENT_META,
  defaultComponent,
  genScreenId,
  type ComponentType,
  type DataSourceItem,
  type ImageComp,
  type MetaFlowComponent,
  type MetaFlowDefinition,
  type MetaFlowScreen,
  type TextLabelComp,
} from "@/lib/flows/meta-flow-types";

// ─── Builder context ─────────────────────────────────────────────

interface SaveField { field_key: string; label: string; field_type: string }

const FlowBuilderContext = createContext<{
  flowId?: string
  saveTableId?: string
  saveTableFields: SaveField[]
}>({ saveTableFields: [] })

// ─── Main builder ────────────────────────────────────────────────

interface MetaFlowBuilderProps {
  value: MetaFlowDefinition;
  onChange: (def: MetaFlowDefinition) => void;
  flowId?: string;
  // Upload / Publish / Save callbacks from the parent page
  onSave?: () => void;
  onUpload?: () => Promise<void>;
  onPublish?: () => Promise<void>;
  saving?: boolean;
  uploading?: boolean;
  publishing?: boolean;
  metaFlowId?: string | null;
  flowStatus?: string;
}

export function MetaFlowBuilder({
  value, onChange,
  flowId,
  onSave, onUpload, onPublish,
  saving, uploading, publishing,
  metaFlowId, flowStatus,
}: MetaFlowBuilderProps) {
  const [selectedScreenId, setSelectedScreenId] = useState<string>(
    value.screens[0]?.id ?? "",
  );
  const [activeTab, setActiveTab] = useState<"edit" | "json">("edit");

  // ── DataStore save configuration ─────────────────────────────
  const [allTables, setAllTables] = useState<{ id: string; name: string }[]>([])
  const [saveTableFields, setSaveTableFields] = useState<SaveField[]>([])

  useEffect(() => {
    fetch('/api/data-tables').then(r => r.json()).then((d: { tables?: { id: string; name: string }[] }) => {
      setAllTables(d.tables ?? [])
    }).catch(() => {})
  }, [])

  useEffect(() => {
    // No table selected — consumers already gate on saveTableId being
    // truthy, so a stale saveTableFields value here is never rendered.
    if (!value._save_table_id) return
    fetch(`/api/data-tables/${value._save_table_id}`).then(r => r.json()).then((d: { table?: { fields?: SaveField[] } }) => {
      setSaveTableFields(d.table?.fields ?? [])
    }).catch(() => { setSaveTableFields([]) })
  }, [value._save_table_id])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const selectedScreen =
    value.screens.find((s) => s.id === selectedScreenId) ?? value.screens[0];

  // ── Screen CRUD ──────────────────────────────────────────────
  const addScreen = useCallback(() => {
    const n = value.screens.length + 1;
    const newScreen: MetaFlowScreen = {
      id: genScreenId(),
      title: `Screen ${n}`,
      components: [
        defaultComponent("TextHeading"),
        defaultComponent("Footer"),
      ],
    };
    const updated = { ...value, screens: [...value.screens, newScreen] };
    onChange(updated);
    setSelectedScreenId(newScreen.id);
  }, [value, onChange]);

  const removeScreen = useCallback(
    (id: string) => {
      if (value.screens.length === 1) return;
      const updated = {
        ...value,
        screens: value.screens.filter((s) => s.id !== id),
      };
      onChange(updated);
      if (selectedScreenId === id) {
        setSelectedScreenId(updated.screens[0]?.id ?? "");
      }
    },
    [value, onChange, selectedScreenId],
  );

  const duplicateScreen = useCallback(
    (id: string) => {
      const src = value.screens.find((s) => s.id === id);
      if (!src) return;
      const copy: MetaFlowScreen = {
        ...src,
        id: genScreenId(),
        title: `${src.title} copy`,
        components: src.components.map((c) => ({ ...c })),
      };
      const idx = value.screens.findIndex((s) => s.id === id);
      const screens = [...value.screens];
      screens.splice(idx + 1, 0, copy);
      onChange({ ...value, screens });
      setSelectedScreenId(copy.id);
    },
    [value, onChange],
  );

  const updateScreenTitle = useCallback(
    (id: string, title: string) => {
      onChange({
        ...value,
        screens: value.screens.map((s) =>
          s.id === id ? { ...s, title } : s,
        ),
      });
    },
    [value, onChange],
  );

  const updateScreenComponents = useCallback(
    (id: string, components: MetaFlowComponent[]) => {
      onChange({
        ...value,
        screens: value.screens.map((s) =>
          s.id === id ? { ...s, components } : s,
        ),
      });
    },
    [value, onChange],
  );

  // ── Screen drag reorder ──────────────────────────────────────
  function handleScreenDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = value.screens.findIndex((s) => s.id === String(active.id));
    const newIdx = value.screens.findIndex((s) => s.id === String(over.id));
    onChange({ ...value, screens: arrayMove(value.screens, oldIdx, newIdx) });
  }

  return (
    <FlowBuilderContext.Provider value={{ flowId, saveTableId: value._save_table_id, saveTableFields }}>
    <div className="flex h-full overflow-hidden bg-white">
      {/* ── LEFT: Screens list ──────────────────────────────── */}
      <div className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">Screens</h2>
          <button
            onClick={addScreen}
            className="flex h-5 w-5 items-center justify-center rounded text-slate-500 hover:text-primary transition-colors"
            title="Add screen"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleScreenDragEnd}
          >
            <SortableContext
              items={value.screens.map((s) => s.id)}
              strategy={verticalListSortingStrategy}
            >
              {value.screens.map((screen, idx) => (
                <SortableScreenItem
                  key={screen.id}
                  screen={screen}
                  allScreens={value.screens}
                  screenIndex={idx + 1}
                  isSelected={screen.id === selectedScreen?.id}
                  onSelect={() => setSelectedScreenId(screen.id)}
                  onRemove={() => removeScreen(screen.id)}
                  onDuplicate={() => duplicateScreen(screen.id)}
                  canRemove={value.screens.length > 1}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>

        <div className="border-t border-slate-200 px-4 py-2">
          <button
            onClick={addScreen}
            className="flex w-full items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            <Plus className="h-3.5 w-3.5" />
            Add new
          </button>
        </div>
      </div>

      {/* ── CENTER: Component editor ─────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden border-r border-slate-200">
        {/* Sub-header */}
        <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
          <h2 className="text-sm font-semibold text-slate-800">Edit content</h2>
          <div className="flex gap-0.5 rounded-md border border-slate-200 bg-slate-100 p-0.5 text-xs ml-1">
            {(["edit", "json"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={cn(
                  "rounded px-2.5 py-0.5 transition-colors capitalize",
                  activeTab === t
                    ? "bg-white text-slate-800 shadow-sm"
                    : "text-slate-500 hover:text-slate-800",
                )}
              >
                {t === "json" ? "JSON" : "Edit"}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          {/* Upload / Publish / Save buttons */}
          {onSave && (
            <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={onSave} disabled={saving}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Save
            </Button>
          )}
          {onUpload && (
            <Button size="sm" variant="outline" onClick={onUpload} disabled={uploading}
              className="h-7 gap-1.5 text-xs text-sky-500 border-sky-500/40 hover:bg-sky-500/10">
              {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
              {metaFlowId ? 'Update on Meta' : 'Upload to Meta'}
            </Button>
          )}
          {onPublish && metaFlowId && flowStatus !== 'active' && (
            <Button size="sm" variant="outline" onClick={onPublish} disabled={publishing}
              className="h-7 gap-1.5 text-xs text-emerald-500 border-emerald-500/40 hover:bg-emerald-500/10">
              {publishing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Publish to Meta
            </Button>
          )}
          {metaFlowId && flowStatus === 'active' && (
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-500">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live on Meta
            </span>
          )}
        </div>

        {activeTab === "json" ? (
          <div className="flex-1 overflow-auto bg-white p-4">
            <pre className="rounded-lg bg-slate-100 p-4 text-[11px] font-mono text-slate-800 overflow-x-auto">
              {JSON.stringify(value, null, 2)}
            </pre>
          </div>
        ) : (
          selectedScreen && (
            <ComponentEditorPanel
              screen={selectedScreen}
              allScreens={value.screens}
              onTitleChange={(t) => updateScreenTitle(selectedScreen.id, t)}
              onComponentsChange={(c) =>
                updateScreenComponents(selectedScreen.id, c)
              }
              allTables={allTables}
              saveTableId={value._save_table_id}
              onSaveTableChange={(id) => onChange({ ...value, _save_table_id: id || undefined })}
            />
          )
        )}
      </div>

      {/* ── RIGHT: Live preview ──────────────────────────────── */}
      <LivePreviewPanel screens={value.screens} selectedScreen={selectedScreen} />
    </div>
    </FlowBuilderContext.Provider>
  );
}

// ─── Sortable screen item ────────────────────────────────────────

function SortableScreenItem({
  screen,
  allScreens,
  screenIndex,
  isSelected,
  onSelect,
  onRemove,
  onDuplicate,
  canRemove,
}: {
  screen: MetaFlowScreen;
  allScreens: MetaFlowScreen[];
  screenIndex: number;
  isSelected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
  canRemove: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: screen.id });

  // Derive navigation info from Footer's on-click-action
  const footer = screen.components.find((c) => c.type === 'Footer') as
    | { type: 'Footer'; 'on-click-action': { name: string; next?: { name: string } } }
    | undefined;
  const action = footer?.['on-click-action'];
  const isTerminal = screen.terminal === true;
  let navBadge: { label: string; kind: 'navigate' | 'complete' | 'terminal' } | null = null;
  if (isTerminal) {
    navBadge = { label: 'Terminal', kind: 'terminal' };
  } else if (action?.name === 'navigate' && action.next?.name) {
    const targetScreen = allScreens.find((s) => s.id === action.next!.name);
    navBadge = { label: targetScreen?.title ?? action.next.name, kind: 'navigate' };
  } else if (action?.name === 'complete') {
    navBadge = { label: 'Complete', kind: 'complete' };
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group cursor-pointer px-3 py-2 text-sm transition-colors",
        isSelected
          ? "bg-primary/10 text-primary font-medium"
          : "text-slate-800 hover:bg-slate-100",
        isDragging && "opacity-50",
      )}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2">
        <span
          {...attributes}
          {...listeners}
          className="cursor-grab text-slate-500/40 hover:text-slate-500 active:cursor-grabbing shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>
        <span className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold",
          isSelected ? "bg-primary text-primary-foreground" : "bg-slate-100 text-slate-500",
        )}>
          {screenIndex}
        </span>
        <span className="flex-1 truncate text-xs font-medium">{screen.title}</span>
        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
          <button onClick={onDuplicate} className="rounded p-0.5 text-slate-500 hover:text-slate-800" title="Duplicate">
            <Copy className="h-3 w-3" />
          </button>
          {canRemove && (
            <button onClick={onRemove} className="rounded p-0.5 text-slate-500 hover:text-destructive" title="Remove">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
      {navBadge && (
        <div className={cn(
          "ml-[30px] mt-0.5 flex items-center gap-1 text-[10px]",
          navBadge.kind === 'navigate' && "text-blue-500",
          navBadge.kind === 'complete' && "text-emerald-500",
          navBadge.kind === 'terminal' && "text-amber-500",
        )}>
          {navBadge.kind === 'navigate' && <ArrowRight className="h-2.5 w-2.5 shrink-0" />}
          {navBadge.kind === 'complete' && <CheckCircle2 className="h-2.5 w-2.5 shrink-0" />}
          {navBadge.kind === 'terminal' && <Flag className="h-2.5 w-2.5 shrink-0" />}
          <span className="truncate">{navBadge.label}</span>
        </div>
      )}
    </div>
  );
}

// ─── Component editor panel ──────────────────────────────────────

function ComponentEditorPanel({
  screen,
  allScreens,
  onTitleChange,
  onComponentsChange,
  allTables,
  saveTableId,
  onSaveTableChange,
}: {
  screen: MetaFlowScreen;
  allScreens: MetaFlowScreen[];
  onTitleChange: (t: string) => void;
  onComponentsChange: (c: MetaFlowComponent[]) => void;
  allTables: { id: string; name: string }[];
  saveTableId?: string;
  onSaveTableChange: (id: string) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const [expandedId, setExpandedId] = useState<string | null>(null);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = screen.components.findIndex((c) => c.id === String(active.id));
    const newIdx = screen.components.findIndex((c) => c.id === String(over.id));
    onComponentsChange(arrayMove(screen.components, oldIdx, newIdx));
  }

  const addComponent = (type: ComponentType) => {
    const comp = defaultComponent(type);
    onComponentsChange([...screen.components, comp]);
    setExpandedId(comp.id);
  };

  const removeComponent = (id: string) => {
    onComponentsChange(screen.components.filter((c) => c.id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  const updateComponent = (updated: MetaFlowComponent) => {
    onComponentsChange(
      screen.components.map((c) => (c.id === updated.id ? updated : c)),
    );
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Screen title */}
      <div className="border-b border-slate-200">
        <button
          className="flex w-full items-center justify-between px-5 py-3 text-sm font-medium text-slate-800 hover:bg-slate-50 transition-colors"
          onClick={() => setExpandedId(expandedId === "__title" ? null : "__title")}
        >
          <span>Screen title</span>
          {expandedId === "__title" ? (
            <ChevronUp className="h-4 w-4 text-slate-500" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-500" />
          )}
        </button>
        {expandedId === "__title" && (
          <div className="border-t border-slate-200 bg-slate-100/20 px-5 py-4">
            <Input
              value={screen.title}
              onChange={(e) => onTitleChange(e.target.value)}
              className="h-9 bg-white text-sm"
              placeholder="Screen title…"
            />
          </div>
        )}
      </div>

      {/* Components list */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={screen.components.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          {screen.components.map((comp) => (
            <SortableComponentItem
              key={comp.id}
              comp={comp}
              allScreens={allScreens}
              isExpanded={expandedId === comp.id}
              onToggle={() =>
                setExpandedId(expandedId === comp.id ? null : comp.id)
              }
              onRemove={() => removeComponent(comp.id)}
              onUpdate={updateComponent}
            />
          ))}
        </SortableContext>
      </DndContext>

      {/* Add component button */}
      <div className="px-5 py-4">
        <AddComponentMenu onAdd={addComponent} />
      </div>

      {/* ── Save form data to DataStore — only shown when Footer uses data_exchange ── */}
      {screen.components.some(
        (c) => c.type === 'Footer' &&
          (c as unknown as { 'on-click-action'?: { name: string } })['on-click-action']?.name === 'data_exchange'
      ) && (
        <div className="border-t border-slate-200 px-5 py-4 space-y-3">
          <p className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
            💾 Save form data to
          </p>
          <select
            className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs"
            value={saveTableId ?? ''}
            onChange={(e) => onSaveTableChange(e.target.value)}
          >
            <option value="">— None —</option>
            {allTables.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          {saveTableId && (
            <SaveMappingTable screen={screen} onComponentsChange={onComponentsChange} />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Add component dropdown ──────────────────────────────────────

function AddComponentMenu({ onAdd }: { onAdd: (t: ComponentType) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium hover:bg-slate-100 transition-colors">
        <Plus className="h-3.5 w-3.5" />
        Add content
        <ChevronDown className="h-3.5 w-3.5 ml-auto" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {COMPONENT_GROUPS.map((group) => {
          const types = (
            Object.entries(COMPONENT_META) as [ComponentType, (typeof COMPONENT_META)[ComponentType]][]
          ).filter(([, m]) => m.group === group);
          if (types.length === 0) return null;
          return (
            <div key={group}>
              <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {group}
              </p>
              {types.map(([type, meta]) => (
                <DropdownMenuItem key={type} onClick={() => onAdd(type)} className="text-xs">
                  <span className={cn("mr-2 rounded px-1.5 py-0.5 text-[9px] font-semibold", meta.color)}>
                    {meta.label.charAt(0)}
                  </span>
                  {meta.label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Sortable component item ─────────────────────────────────────

function SortableComponentItem({
  comp,
  allScreens,
  isExpanded,
  onToggle,
  onRemove,
  onUpdate,
}: {
  comp: MetaFlowComponent;
  allScreens: MetaFlowScreen[];
  isExpanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onUpdate: (c: MetaFlowComponent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: comp.id });

  const meta = COMPONENT_META[comp.type];

  const preview = getCompPreview(comp);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("border-b border-slate-200", isDragging && "opacity-50")}
    >
      {/* Header row */}
      <div
        className="group flex cursor-pointer items-center gap-2 px-5 py-3 hover:bg-slate-50 transition-colors"
        onClick={onToggle}
      >
        <span
          {...attributes}
          {...listeners}
          className="cursor-grab text-slate-500/40 hover:text-slate-500 active:cursor-grabbing"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>
        <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-semibold shrink-0", meta.color)}>
          {meta.label}
        </span>
        {preview && (
          <span className="flex-1 truncate text-xs text-slate-500">
            · {preview}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
          <button onClick={onRemove} className="rounded p-0.5 text-slate-500 hover:text-destructive">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 text-slate-500 shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-slate-500 shrink-0" />
        )}
      </div>

      {/* Expanded form */}
      {isExpanded && (
        <div className="border-t border-slate-200 bg-slate-100/10 px-5 py-4">
          <ComponentForm comp={comp} allScreens={allScreens} onUpdate={onUpdate} />
        </div>
      )}
    </div>
  );
}

function getCompPreview(comp: MetaFlowComponent): string {
  switch (comp.type) {
    case 'TextHeading': case 'TextSubheading': case 'TextBody': case 'TextCaption':
      return comp.text || ''
    case 'TextInput': case 'TextArea': case 'RadioButtonsGroup':
    case 'CheckboxGroup': case 'Dropdown': case 'DatePicker':
      return (comp as {label: string}).label || ''
    case 'Footer':
      return comp.label || ''
    case 'Image':
      return comp.src ? 'Image (uploaded)' : '(no image)'
    default:
      return ''
  }
}

// ─── Module-level field primitives ──────────────────────────────────
// MUST be at module scope — NOT nested inside ComponentForm.
// Nested component definitions are recreated on every render, causing inputs
// to unmount/remount and lose cursor position on every keystroke.

function CompTextField({ label, value, onChange, placeholder, multiline = false }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; multiline?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {multiline ? (
        <Textarea
          className="min-h-[60px] resize-none text-xs"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <Input
          className="h-8 text-xs"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
    </div>
  );
}

function CompToggle({ label, value, onChange }: {
  label: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <Label className="text-xs">{label}</Label>
      <Switch checked={value ?? false} onCheckedChange={onChange} />
    </div>
  );
}

interface TableInfo { id: string; name: string }
interface TableField { field_key: string; label: string; field_type: string }

// ── Form input types (components that produce submitted values) ────
const FORM_INPUT_TYPES = new Set([
  'TextInput', 'TextArea', 'Dropdown', 'RadioButtonsGroup', 'CheckboxGroup', 'DatePicker',
])

interface FormInputMeta {
  name: string
  label: string
  type: string
  _save_field_key?: string
}

function collectFormInputs(components: MetaFlowComponent[]): FormInputMeta[] {
  const result: FormInputMeta[] = []
  for (const comp of components) {
    const raw = comp as unknown as Record<string, unknown>
    if (FORM_INPUT_TYPES.has(comp.type) && raw.name) {
      result.push({
        name: raw.name as string,
        label: (raw.label as string) || (raw.name as string),
        type: comp.type,
        _save_field_key: raw._save_field_key as string | undefined,
      })
    }
    // Walk Form container children (Meta Flows Form component)
    if (raw.type === 'Form' && Array.isArray(raw.children)) {
      result.push(...collectFormInputs(raw.children as MetaFlowComponent[]))
    }
  }
  return result
}

// Type compatibility: DataStore field_type × Flow component type
function getTypeCompat(fieldType: string, compType: string): 'ok' | 'warn' | 'error' {
  const rules: Record<string, Record<string, 'ok' | 'warn' | 'error'>> = {
    // text field accepts any component that submits a string value
    text:    { TextInput: 'ok', TextArea: 'ok', Dropdown: 'ok', RadioButtonsGroup: 'ok', CheckboxGroup: 'warn', DatePicker: 'warn' },
    // date field — only DatePicker gives a proper ISO date string
    date:    { DatePicker: 'ok', TextInput: 'warn', TextArea: 'error', Dropdown: 'error', RadioButtonsGroup: 'error', CheckboxGroup: 'error' },
    // number field — TextInput with number type works; others submit strings
    number:  { TextInput: 'ok', TextArea: 'warn', Dropdown: 'error', RadioButtonsGroup: 'error', CheckboxGroup: 'error', DatePicker: 'error' },
    // select field — choice components are a natural match; TextInput works but unusual
    select:  { Dropdown: 'ok', RadioButtonsGroup: 'ok', CheckboxGroup: 'ok', TextInput: 'warn', TextArea: 'warn' },
    // boolean — checkbox/radio group submit selected values; TextInput is a stretch
    boolean: { CheckboxGroup: 'ok', RadioButtonsGroup: 'ok', TextInput: 'warn', Dropdown: 'warn', TextArea: 'error', DatePicker: 'error' },
  }
  return rules[fieldType]?.[compType] ?? 'warn'
}

const COMPAT_ICONS: Record<'ok' | 'warn' | 'error', { icon: string; cls: string; tip: string }> = {
  ok:    { icon: '✓', cls: 'text-emerald-500', tip: 'Types are compatible' },
  warn:  { icon: '⚠', cls: 'text-amber-500',   tip: 'Types may not match — value will be saved as-is' },
  error: { icon: '✗', cls: 'text-red-500',      tip: 'Type mismatch — this mapping will likely produce incorrect data' },
}

// ── Unified save mapping table ────────────────────────────────────
function SaveMappingTable({
  screen,
  onComponentsChange,
}: {
  screen: MetaFlowScreen
  onComponentsChange: (c: MetaFlowComponent[]) => void
}) {
  const { saveTableId, saveTableFields } = useContext(FlowBuilderContext)
  if (!saveTableId || saveTableFields.length === 0) return null

  const formInputs = collectFormInputs(screen.components)

  // Build reverse map: field_key → component name (current mapping)
  const currentMapping: Record<string, string> = {}
  for (const inp of formInputs) {
    if (inp._save_field_key) currentMapping[inp._save_field_key] = inp.name
  }

  const handleChange = (fieldKey: string, compName: string) => {
    // Walk all components (including nested), set/clear _save_field_key
    function applyToComps(comps: MetaFlowComponent[]): MetaFlowComponent[] {
      return comps.map((comp) => {
        const raw = comp as unknown as Record<string, unknown>
        const name = raw.name as string | undefined

        // Recurse into Form.children
        if (raw.type === 'Form' && Array.isArray(raw.children)) {
          return { ...comp, children: applyToComps(raw.children as MetaFlowComponent[]) } as unknown as MetaFlowComponent
        }

        if (!name) return comp
        if (name === compName) {
          return { ...comp, _save_field_key: fieldKey || undefined } as MetaFlowComponent
        }
        // Clear from the previous holder of this fieldKey
        if ((raw._save_field_key as string | undefined) === fieldKey && fieldKey !== '') {
          const updated = { ...raw }
          delete updated._save_field_key
          return updated as unknown as MetaFlowComponent
        }
        return comp
      })
    }
    onComponentsChange(applyToComps(screen.components))
  }

  function autoMap() {
    // For each table field, find the best-matching form input by label similarity
    function similarity(a: string, b: string) {
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
      const na = norm(a); const nb = norm(b)
      if (na === nb) return 1
      if (na.includes(nb) || nb.includes(na)) return 0.8
      return 0
    }
    let comps = [...screen.components]
    const newMapping: Record<string, string> = {} // fieldKey → compName
    for (const field of saveTableFields) {
      let bestComp: FormInputMeta | null = null
      let bestScore = 0
      for (const inp of formInputs) {
        if (Object.values(newMapping).includes(inp.name)) continue // already claimed
        const score = Math.max(similarity(field.label, inp.label), similarity(field.field_key, inp.name))
        if (score > bestScore) { bestScore = score; bestComp = inp }
      }
      if (bestComp && bestScore > 0) newMapping[field.field_key] = bestComp.name
    }
    // Apply mapping to components
    function applyAll(c: MetaFlowComponent[]): MetaFlowComponent[] {
      return c.map((comp) => {
        const raw = comp as unknown as Record<string, unknown>
        if (raw.type === 'Form' && Array.isArray(raw.children)) {
          return { ...comp, children: applyAll(raw.children as MetaFlowComponent[]) } as unknown as MetaFlowComponent
        }
        const name = raw.name as string | undefined
        if (!name) return comp
        // Find if this comp is mapped to a field
        const fieldKey = Object.entries(newMapping).find(([, cn]) => cn === name)?.[0]
        if (fieldKey) return { ...comp, _save_field_key: fieldKey } as MetaFlowComponent
        // Clear previous mapping if not in new mapping
        const updated = { ...raw }
        delete updated._save_field_key
        return updated as unknown as MetaFlowComponent
      })
    }
    comps = applyAll(comps)
    onComponentsChange(comps)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-slate-800">Field Mapping</p>
        <button
          type="button"
          onClick={autoMap}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
          title="Auto-match fields by name"
        >
          <RefreshCw className="h-2.5 w-2.5" /> Auto-map
        </button>
      </div>
      <div className="rounded-lg border border-slate-200 overflow-hidden text-xs">
        <div className="grid grid-cols-[1fr_1fr_20px] bg-slate-100 border-b border-slate-200 px-3 py-1.5 gap-2">
          <span className="font-medium text-slate-500">Table field</span>
          <span className="font-medium text-slate-500">Form input</span>
          <span />
        </div>
        {saveTableFields.map((field) => {
          const mappedName = currentMapping[field.field_key] ?? ''
          const mappedComp = formInputs.find((c) => c.name === mappedName)
          const compat = mappedComp ? getTypeCompat(field.field_type, mappedComp.type) : null
          const compatInfo = compat ? COMPAT_ICONS[compat] : null

          return (
            <div key={field.field_key} className="grid grid-cols-[1fr_1fr_20px] items-center gap-2 px-3 py-2 border-b border-slate-200/50 last:border-0 hover:bg-slate-100/20">
              <div>
                <div className="font-medium text-slate-800 truncate">{field.label}</div>
                <div className="text-[10px] text-slate-500 capitalize">{field.field_type}</div>
              </div>
              <select
                className="h-7 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
                value={mappedName}
                onChange={(e) => handleChange(field.field_key, e.target.value)}
              >
                <option value="">— None —</option>
                {formInputs.map((inp) => (
                  <option key={inp.name} value={inp.name}>
                    {inp.label} ({inp.type.replace(/Comp$/, '')})
                  </option>
                ))}
              </select>
              <div className="text-center">
                {compatInfo && (
                  <span
                    title={compatInfo.tip}
                    className={`text-sm font-bold ${compatInfo.cls}`}
                  >
                    {compatInfo.icon}
                  </span>
                )}
              </div>
            </div>
          )
        })}
        {formInputs.length === 0 && (
          <div className="px-3 py-3 text-[10px] text-slate-500 text-center">
            No form inputs found on this screen. Add TextInput, DatePicker, or Dropdown components.
          </div>
        )}
      </div>
      <div className="flex gap-3 text-[10px] text-slate-500">
        <span className="text-emerald-500 font-bold">✓</span> Types match &nbsp;
        <span className="text-amber-500 font-bold">⚠</span> Saved as-is &nbsp;
        <span className="text-red-500 font-bold">✗</span> Type mismatch
      </div>
    </div>
  )
}

function CompDataSource({
  items,
  onChange,
  sourceTableId,
  sourceFieldKey,
  onSourceChange,
}: {
  items: DataSourceItem[];
  onChange: (items: DataSourceItem[]) => void;
  sourceTableId?: string;
  sourceFieldKey?: string;
  /** Called once with both source metadata AND the new items so the parent can merge in a single set() call */
  onSourceChange?: (tableId: string, fieldKey: string, items: DataSourceItem[]) => void;
}) {
  const { flowId } = useContext(FlowBuilderContext);
  const [mode, setMode] = useState<'manual' | 'table'>(sourceTableId ? 'table' : 'manual');
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [tableFields, setTableFields] = useState<TableField[]>([]);
  const [selectedTable, setSelectedTable] = useState(sourceTableId ?? '');
  const [selectedField, setSelectedField] = useState(sourceFieldKey ?? '');
  const [loadingFields, setLoadingFields] = useState(false);
  const [liveCount, setLiveCount] = useState<number | null>(null); // null = not yet loaded

  // Stable refs so the polling interval never goes stale. Synced in an
  // effect (not directly during render) — mutating a ref during render is
  // not allowed under React's rules, since render must stay pure.
  const selectedTableRef = useRef(selectedTable);
  const selectedFieldRef = useRef(selectedField);
  const itemsRef = useRef(items);
  const onSourceChangeRef = useRef(onSourceChange);
  useEffect(() => {
    selectedTableRef.current = selectedTable;
    selectedFieldRef.current = selectedField;
    itemsRef.current = items;
    onSourceChangeRef.current = onSourceChange;
  });

  // Load tables list once
  useEffect(() => {
    fetch('/api/data-tables').then((r) => r.json()).then((d) => setTables(d.tables ?? [])).catch(() => {});
  }, []);

  // Load fields when table changes. No explicit reset needed when
  // selectedTable is empty — the field picker is only rendered when
  // selectedTable is truthy, so a stale tableFields value is never shown.
  useEffect(() => {
    if (!selectedTable) return;
    setLoadingFields(true);
    fetch(`/api/data-tables/${selectedTable}`)
      .then((r) => r.json())
      .then((d) => setTableFields(
        (d.table?.fields ?? []).filter(
          (f: TableField) => !['section_header', 'html_block', 'signature', 'file', 'image'].includes(f.field_type)
        )
      ))
      .catch(() => setTableFields([]))
      .finally(() => setLoadingFields(false));
  }, [selectedTable]);

  // Live polling — fetch values every 3 s, silently update when data changes
  useEffect(() => {
    if (mode !== 'table' || !selectedTable || !selectedField) {
      setLiveCount(null);
      return;
    }

    const poll = async () => {
      const tbl = selectedTableRef.current;
      const fld = selectedFieldRef.current;
      if (!tbl || !fld) return;
      try {
        const res = await fetch(
          `/api/data-tables/${tbl}/field-values?field_key=${encodeURIComponent(fld)}`,
        );
        if (!res.ok) return;
        const d = await res.json() as { values?: string[] };
        const values = d.values ?? [];
        const newItems: DataSourceItem[] = values.map((v) => ({
          id: `ds_${v.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
          title: v,
        }));
        setLiveCount(newItems.length);

        // Only push update when content actually changed
        const currentItems = Array.isArray(itemsRef.current) ? itemsRef.current : []
        const prev = (currentItems as DataSourceItem[]).map((i) => i.title).sort().join('\0');
        const next = values.slice().sort().join('\0');
        if (prev !== next) {
          onSourceChangeRef.current?.(tbl, fld, newItems);
        }
      } catch { /* silent — don't disrupt the user */ }
    };

    poll(); // immediate first fetch
    const id = setInterval(poll, 3000); // poll every 3 s
    return () => clearInterval(id);
  }, [mode, selectedTable, selectedField]);

  return (
    <div className="space-y-2">
      <Label className="text-xs">Options</Label>

      {/* Mode toggle */}
      <div className="flex gap-0.5 rounded-lg border border-slate-200 bg-slate-100 p-0.5">
        {(['manual', 'table'] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)}
            className={cn(
              'flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-all',
              mode === m ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800',
            )}>
            {m === 'manual' ? 'Manual' : '⚡ Network Request'}
          </button>
        ))}
      </div>

      {mode === 'manual' && (
        <>
          {items.map((item, i) => (
            <div key={item.id} className="flex gap-1.5">
              <Input
                className="h-7 flex-1 text-xs"
                value={item.title}
                onChange={(e) => onChange(items.map((it, j) => j === i ? { ...it, title: e.target.value } : it))}
                placeholder="Option label"
              />
              <button onClick={() => onChange(items.filter((_, j) => j !== i))}
                disabled={items.length <= 1}
                className="text-slate-500 hover:text-destructive disabled:opacity-30">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <Button size="sm" variant="outline" className="h-7 w-full gap-1 text-xs"
            onClick={() => onChange([...items, { id: `opt_${Date.now()}`, title: 'New option' }])}>
            <Plus className="h-3 w-3" /> Add option
          </Button>
        </>
      )}

      {mode === 'table' && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="space-y-1.5">
            <label className="text-[11px] text-slate-500">Select Table</label>
            <select
              className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs"
              value={selectedTable}
              onChange={(e) => { setSelectedTable(e.target.value); setSelectedField(''); }}
            >
              <option value="">Choose a table…</option>
              {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          {selectedTable && (
            <div className="space-y-1.5">
              <label className="text-[11px] text-slate-500">Use Field Values as Options</label>
              {loadingFields ? (
                <div className="flex items-center gap-1.5 text-[11px] text-slate-500 py-1">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading fields…
                </div>
              ) : (
                <select
                  className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs"
                  value={selectedField}
                  onChange={(e) => setSelectedField(e.target.value)}
                >
                  <option value="">Choose a field…</option>
                  {tableFields.map((f) => <option key={f.field_key} value={f.field_key}>{f.label}</option>)}
                </select>
              )}
            </div>
          )}

          {/* Live options preview — polls every 3 s, updates automatically */}
          {selectedTable && selectedField && (
            <div className="rounded-md border border-slate-200 bg-white px-2.5 py-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {liveCount === null ? (
                    <Loader2 className="h-3 w-3 animate-spin text-slate-500" />
                  ) : (
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                    </span>
                  )}
                  <span className="text-[10px] font-medium text-slate-800">
                    {liveCount === null
                      ? 'Loading…'
                      : liveCount === 0
                        ? 'No records found'
                        : `${liveCount} live option${liveCount > 1 ? 's' : ''}`}
                  </span>
                </div>
                <span className="text-[9px] text-slate-400">preview</span>
              </div>

              {liveCount === null ? (
                <div className="flex gap-1 pt-0.5">
                  {[1, 2, 3].map((n) => (
                    <span key={n} className="h-5 w-14 animate-pulse rounded-full bg-slate-100" />
                  ))}
                </div>
              ) : items.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {items.slice(0, 8).map((it) => (
                    <span key={it.id} className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] text-violet-600">
                      {it.title}
                    </span>
                  ))}
                  {items.length > 8 && (
                    <span className="text-[10px] text-slate-500">+{items.length - 8} more</span>
                  )}
                </div>
              ) : (
                <p className="text-[10px] text-slate-400">
                  Add records to the &quot;{tableFields.find(f => f.field_key === selectedField)?.label ?? selectedField}&quot; field to see options here.
                </p>
              )}
            </div>
          )}

          {/* Webhook URL — shown when a DB field is selected */}
          {selectedTable && selectedField && flowId && (
            <WebhookUrlCard flowId={flowId} />
          )}
        </div>
      )}
    </div>
  );
}

// ── CompLabelSource ───────────────────────────────────────────────────────────
// Simplified table+field picker for TextLabel Network Request mode.
function CompLabelSource({
  tableId,
  fieldKey,
  onSourceChange,
}: {
  tableId?: string
  fieldKey?: string
  onSourceChange: (tableId: string, fieldKey: string) => void
}) {
  const [tables, setTables] = useState<TableInfo[]>([])
  const [tableFields, setTableFields] = useState<TableField[]>([])
  const [selectedTable, setSelectedTable] = useState(tableId ?? '')
  const [selectedField, setSelectedField] = useState(fieldKey ?? '')
  const [loadingFields, setLoadingFields] = useState(false)

  useEffect(() => {
    fetch('/api/data-tables').then((r) => r.json()).then((d) => setTables(d.tables ?? [])).catch(() => {})
  }, [])

  useEffect(() => {
    // No explicit reset needed — the field picker below is only rendered
    // when selectedTable is truthy, so a stale tableFields value is never shown.
    if (!selectedTable) return
    setLoadingFields(true)
    fetch(`/api/data-tables/${selectedTable}`)
      .then((r) => r.json())
      .then((d) => setTableFields(
        (d.table?.fields ?? []).filter(
          (f: TableField) => !['section_header', 'html_block', 'signature', 'file', 'image'].includes(f.field_type)
        )
      ))
      .catch(() => setTableFields([]))
      .finally(() => setLoadingFields(false))
  }, [selectedTable])

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        <Label className="text-xs">Table</Label>
        <select
          className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs"
          value={selectedTable}
          onChange={(e) => {
            setSelectedTable(e.target.value)
            setSelectedField('')
          }}
        >
          <option value="">— choose table —</option>
          {tables.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>
      {selectedTable && (
        <div className="space-y-1.5">
          <Label className="text-xs">Field</Label>
          {loadingFields
            ? <p className="text-[10px] text-slate-500">Loading fields…</p>
            : (
              <select
                className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs"
                value={selectedField}
                onChange={(e) => {
                  setSelectedField(e.target.value)
                  if (e.target.value) onSourceChange(selectedTable, e.target.value)
                }}
              >
                <option value="">— choose field —</option>
                {tableFields.map((f) => (
                  <option key={f.field_key} value={f.field_key}>{f.label}</option>
                ))}
              </select>
            )
          }
        </div>
      )}
      {selectedTable && selectedField && (
        <p className="text-[10px] text-teal-600">
          ✓ Fetches first matching value from <span className="font-mono">{selectedField}</span>
        </p>
      )}
    </div>
  )
}

// ── FilterParentPicker ────────────────────────────────────────────────────────
// Lists every component across all screens marked as a filter "PARENT"
// (_filter_trigger === true), by its human label. Prevents the class of bug
// where a child's _filter_form_name is hand-typed/pasted and ends up
// pointing at the wrong dropdown's internal name (or a name that no longer
// matches any parent) with no way to notice from the UI.
function FilterParentPicker({
  allScreens,
  value,
  onChange,
}: {
  allScreens: MetaFlowScreen[]
  value: string
  onChange: (name: string) => void
}) {
  const options: { name: string; label: string }[] = []
  for (const s of allScreens) {
    for (const c of s.components) {
      const rec = c as unknown as Record<string, unknown>
      if (rec._filter_trigger === true && typeof rec.name === 'string' && rec.name) {
        options.push({ name: rec.name, label: (rec.label as string) || rec.name })
      }
    }
  }
  // The saved value may not match any current PARENT (stale reference, or
  // typed before this picker existed) — keep it selectable so it's visible
  // rather than silently reverting to blank.
  const hasUnknownValue = value && !options.some((o) => o.name === value)

  return (
    <select
      className="h-7 w-full rounded-md border border-input bg-white px-2 text-xs"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">— pick a parent dropdown —</option>
      {hasUnknownValue && (
        <option value={value}>⚠ {value} (not found — check it&apos;s marked PARENT)</option>
      )}
      {options.map((o) => (
        <option key={o.name} value={o.name}>{o.label} [{o.name}]</option>
      ))}
    </select>
  )
}

// ── FilterFieldPicker ─────────────────────────────────────────────────────────
// Loads fields from a DataStore table and shows a select so the user picks the
// exact field_key (which may differ from the label due to slugify rules).
function FilterFieldPicker({
  tableId,
  value,
  onChange,
}: {
  tableId: string
  value: string
  onChange: (fieldKey: string) => void
}) {
  const [fields, setFields] = useState<TableField[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    // Parent only mounts this component once tableId is truthy, so this
    // is defensive only — no need to reset fields here.
    if (!tableId) return
    setLoading(true)
    fetch(`/api/data-tables/${tableId}`)
      .then((r) => r.json())
      .then((d) => setFields(
        (d.table?.fields ?? []).filter(
          (f: TableField) => !['section_header', 'html_block', 'signature', 'file', 'image'].includes(f.field_type)
        )
      ))
      .catch(() => setFields([]))
      .finally(() => setLoading(false))
  }, [tableId])

  if (loading) return <p className="text-[10px] text-slate-500">Loading columns…</p>

  return (
    <select
      className="h-7 w-full rounded-md border border-input bg-white px-2 text-xs font-mono"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">— pick a column —</option>
      {fields.map((f) => (
        <option key={f.field_key} value={f.field_key}>
          {f.label}  [{f.field_key}]
        </option>
      ))}
    </select>
  )
}

const BASE_URL_KEY = 'meta_flow_base_url'

function sanitizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/api\/.*$/, '').replace(/\/$/, '')
}

function WebhookUrlCard({ flowId }: { flowId: string }) {
  const currentOrigin = typeof window !== 'undefined' ? sanitizeBaseUrl(window.location.origin) : ''

  const [baseUrl, setBaseUrl] = useState<string>(() => {
    if (typeof window === 'undefined') return ''
    const stored = localStorage.getItem(BASE_URL_KEY)
    // If nothing stored, or stored value's hostname differs from current origin, auto-use current origin
    if (!stored) return currentOrigin
    const storedClean = sanitizeBaseUrl(stored)
    try {
      const storedHost = new URL(storedClean).hostname
      const currentHost = new URL(currentOrigin).hostname
      if (storedHost !== currentHost) return currentOrigin
    } catch { /* ignore URL parse errors */ }
    return storedClean
  })
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(baseUrl)

  const path = `/api/flows/${flowId}/webhook`
  const fullUrl = baseUrl.replace(/\/$/, '') + path

  function saveBase(val: string) {
    const clean = sanitizeBaseUrl(val)
    setBaseUrl(clean)
    localStorage.setItem(BASE_URL_KEY, clean)
    setEditing(false)
  }

  function syncToCurrentOrigin() {
    saveBase(currentOrigin)
    setDraft(currentOrigin)
  }

  return (
    <div className="rounded-md border border-sky-500/30 bg-sky-500/5 px-2.5 py-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[9px] font-bold text-sky-600">⚡ LIVE</span>
        <span className="text-[10px] font-medium text-slate-800">Options fetched from database at runtime</span>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-slate-500">
          Meta &rsaquo; Flow Settings &rsaquo; Endpoint URI:
        </p>
        {baseUrl !== currentOrigin && currentOrigin && (
          <button
            type="button"
            onClick={syncToCurrentOrigin}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-medium bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 transition-colors"
            title={`Auto-detect: use ${currentOrigin}`}
          >
            <RefreshCw className="h-2.5 w-2.5" /> Sync URL
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-1">
          <p className="text-[10px] text-slate-400">Enter your public URL (ngrok, domain…)</p>
          <div className="flex gap-1">
            <Input
              className="h-7 flex-1 text-[11px] font-mono"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="https://xxxx.ngrok.io"
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveBase(draft)
                if (e.key === 'Escape') setEditing(false)
              }}
              autoFocus
            />
            <button
              type="button"
              onClick={() => saveBase(draft)}
              className="rounded px-2 text-[10px] bg-sky-500/20 text-sky-700 hover:bg-sky-500/30 transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <code className="flex-1 truncate rounded bg-slate-100 px-2 py-1 text-[10px] font-mono text-slate-800">
            {fullUrl}
          </code>
          <button
            type="button"
            onClick={() => { setDraft(baseUrl); setEditing(true); }}
            className="rounded p-1 text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors shrink-0"
            title="Change base URL (e.g. ngrok)"
          >
            <Settings className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(fullUrl).then(() => toast.success('Endpoint URL copied'))}
            className="rounded p-1 text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors shrink-0"
            title="Copy endpoint URL"
          >
            <Copy className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  )
}

function CompFooterAction({ action, allScreens, onChange }: {
  action: { name: string; next?: { name: string }; payload?: Record<string, unknown> } | undefined;
  allScreens: MetaFlowScreen[];
  onChange: (a: Record<string, unknown>) => void;
}) {
  const currentName = action?.name ?? 'complete';
  return (
    <div className="space-y-2">
      <Label className="text-xs">Action type</Label>
      <div className="flex flex-col gap-1">
        {(['navigate', 'complete', 'data_exchange'] as const).map((act) => (
          <label key={act} className="flex cursor-pointer items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-xs hover:bg-slate-50">
            <input
              type="radio"
              className="h-3 w-3 accent-[#25D366]"
              checked={currentName === act}
              onChange={() => {
                if (act === 'navigate') {
                  onChange({ name: 'navigate', next: { type: 'screen', name: allScreens[0]?.id ?? '' }, payload: {} });
                } else {
                  onChange({ name: act, payload: {} });
                }
              }}
            />
            <span>{act === 'data_exchange' ? 'Data exchange (API)' : act === 'navigate' ? 'Navigate to screen' : 'Complete (close flow)'}</span>
          </label>
        ))}
      </div>
      {currentName === 'navigate' && (
        <div className="space-y-1.5 pt-1">
          <Label className="text-xs">Navigate to screen</Label>
          <select
            className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs"
            value={action?.next?.name ?? ''}
            onChange={(e) => onChange({ name: 'navigate', next: { type: 'screen', name: e.target.value }, payload: {} })}
          >
            {allScreens.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

// ─── Image upload form ───────────────────────────────────────────

function CompImageForm({
  comp,
  onUpdate,
}: {
  comp: ImageComp;
  onUpdate: (c: MetaFlowComponent) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const set = (patch: Partial<ImageComp>) => onUpdate({ ...comp, ...patch });

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Image</Label>
        {comp.src ? (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={comp.src} alt={comp['alt-text'] ?? ''} className="w-full rounded-md border border-slate-200 object-cover max-h-28" />
            <button
              onClick={() => set({ src: '' })}
              className="absolute right-1 top-1 rounded bg-black/60 p-0.5 text-white hover:bg-black/80"
              title="Remove image"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <label className={cn(
            "flex h-20 w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-slate-200 bg-slate-50 text-xs text-slate-500 transition-colors",
            uploading ? "opacity-60 cursor-not-allowed" : "hover:border-primary/50 hover:text-primary",
          )}>
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
            <span>{uploading ? 'Uploading…' : 'Click to upload image'}</span>
            <span className="text-[10px] text-slate-400">PNG, JPG, WEBP (hosted on your server)</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              disabled={uploading}
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                e.target.value = ''
                setUploading(true)
                try {
                  const formData = new FormData()
                  formData.set('file', file)
                  const res = await fetch('/api/upload', { method: 'POST', body: formData })
                  if (!res.ok) {
                    const err = await res.json().catch(() => ({}))
                    toast.error(err.error ?? 'Upload failed')
                    return
                  }
                  const { url } = await res.json()
                  set({ src: url })
                } catch {
                  toast.error('Upload failed')
                } finally {
                  setUploading(false)
                }
              }}
            />
          </label>
        )}
      </div>
      <CompTextField label="Alt text" value={comp['alt-text'] ?? ''} onChange={(v) => set({ 'alt-text': v })} placeholder="Description…" />
      <div className="space-y-1.5">
        <Label className="text-xs">Scale type</Label>
        <select
          className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs"
          value={comp['scale-type'] ?? 'contain'}
          onChange={(e) => set({ 'scale-type': e.target.value as 'cover' | 'contain' })}
        >
          <option value="contain">Contain</option>
          <option value="cover">Cover</option>
        </select>
      </div>
    </div>
  );
}

// ─── Component-specific form ─────────────────────────────────────

function ComponentForm({
  comp,
  allScreens,
  onUpdate,
}: {
  comp: MetaFlowComponent;
  allScreens: MetaFlowScreen[];
  onUpdate: (c: MetaFlowComponent) => void;
}) {
  function set(changes: Record<string, unknown>) {
    onUpdate({ ...(comp as unknown as Record<string, unknown>), ...changes } as unknown as MetaFlowComponent);
  }

  switch (comp.type) {
    case 'TextHeading':
    case 'TextSubheading':
    case 'TextBody':
    case 'TextCaption':
      return (
        <CompTextField
          label="Text"
          value={comp.text}
          onChange={(v) => set({ text: v })}
          multiline={comp.type === 'TextBody' || comp.type === 'TextCaption'}
        />
      );

    case 'TextInput':
      return (
        <div className="space-y-3">
          <CompTextField label="Label" value={comp.label} onChange={(v) => set({ label: v })} />
          <CompTextField label="Variable name (internal)" value={comp.name} onChange={(v) => set({ name: v })} placeholder="field_name" />
          <div className="space-y-1.5">
            <Label className="text-xs">Input type</Label>
            <select
              className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs"
              value={comp['input-type'] ?? 'text'}
              onChange={(e) => set({ 'input-type': e.target.value })}
            >
              {['text', 'number', 'email', 'password', 'phone', 'passcode'].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <CompTextField label="Helper text (optional)" value={comp['helper-text'] ?? ''} onChange={(v) => set({ 'helper-text': v })} />
          <CompToggle label="Required" value={comp.required ?? false} onChange={(v) => set({ required: v })} />
        </div>
      );

    case 'TextArea':
      return (
        <div className="space-y-3">
          <CompTextField label="Label" value={comp.label} onChange={(v) => set({ label: v })} />
          <CompTextField label="Variable name (internal)" value={comp.name} onChange={(v) => set({ name: v })} placeholder="field_name" />
          <CompTextField label="Helper text (optional)" value={comp['helper-text'] ?? ''} onChange={(v) => set({ 'helper-text': v })} />
          <div className="space-y-1.5">
            <Label className="text-xs">Max length (characters)</Label>
            <Input
              type="number" className="h-8 text-xs"
              value={Number(comp['max-length'] ?? 600)}
              onChange={(e) => set({ 'max-length': Number(e.target.value) })}
              min={1} max={4096}
            />
          </div>
          <CompToggle label="Required" value={comp.required ?? false} onChange={(v) => set({ required: v })} />
        </div>
      );

    case 'TextLabel': {
      const tl = comp as TextLabelComp
      const sourceMode = tl._source_mode ?? (tl._source_table_id ? 'network' : 'static')
      const hasSource = sourceMode === 'network'
      const filterFormName = tl._filter_form_name ?? ''
      const filterByField = tl._filter_by_field ?? ''
      return (
        <div className="space-y-3">
          <CompTextField
            label="Variable name (internal)"
            value={tl.name}
            onChange={(v) => set({ name: v })}
            placeholder="label_name"
          />

          {/* Mode toggle */}
          <div className="space-y-1.5">
            <Label className="text-xs">Data source</Label>
            <div className="flex gap-0.5 rounded-lg border border-slate-200 bg-slate-100 p-0.5">
              {(['static', 'network'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    if (m === 'static') {
                      set({ _source_mode: 'static', _source_table_id: undefined, _source_field_key: undefined,
                            _filter_form_name: undefined, _filter_by_field: undefined })
                    } else {
                      set({ _source_mode: 'network' })
                    }
                  }}
                  className={cn(
                    "flex-1 rounded-md px-3 py-1 text-[11px] font-medium transition-colors",
                    (m === 'static' ? !hasSource : hasSource)
                      ? "bg-white shadow-sm text-slate-800"
                      : "text-slate-500 hover:text-slate-700",
                  )}
                >
                  {m === 'static' ? 'Static text' : '⚡ Network Request'}
                </button>
              ))}
            </div>
          </div>

          {!hasSource && (
            <CompTextField label="Text" value={tl.text} onChange={(v) => set({ text: v })} multiline />
          )}

          {hasSource && (
            <CompLabelSource
              tableId={tl._source_table_id}
              fieldKey={tl._source_field_key}
              onSourceChange={(tableId, fieldKey) =>
                set({ _source_table_id: tableId, _source_field_key: fieldKey })
              }
            />
          )}

          {/* Dynamic filter — label can only be a CHILD (filtered by a parent Dropdown) */}
          {hasSource && (
            <div className="rounded-md border border-slate-200 bg-slate-50 overflow-hidden">
              <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-slate-200">
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Dynamic Filter</span>
              </div>
              <div className="px-2.5 py-2.5 space-y-2.5">
                <div className="space-y-1">
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-bold text-slate-500 bg-slate-100 rounded-full h-4 w-4 flex items-center justify-center">1</span>
                    <p className="text-[10px] font-medium text-slate-800">Parent field name</p>
                  </div>
                  <FilterParentPicker
                    allScreens={allScreens}
                    value={filterFormName}
                    onChange={(v) => set({ _filter_form_name: v || undefined })}
                  />
                  <p className="text-[9px] text-slate-500">
                    Pick the dropdown marked <em>PARENT</em> whose selection should trigger this label.
                  </p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-bold text-slate-500 bg-slate-100 rounded-full h-4 w-4 flex items-center justify-center">2</span>
                    <p className="text-[10px] font-medium text-slate-800">Filter column (from DB table)</p>
                  </div>
                  {tl._source_table_id ? (
                    <FilterFieldPicker
                      tableId={tl._source_table_id}
                      value={filterByField}
                      onChange={(v) => set({ _filter_by_field: v || undefined })}
                    />
                  ) : (
                    <Input
                      className="h-7 text-xs font-mono"
                      value={filterByField}
                      onChange={(e) => set({ _filter_by_field: e.target.value || undefined })}
                      placeholder="e.g. month"
                    />
                  )}
                  <p className="text-[9px] text-slate-500">
                    Column whose value must match the parent dropdown&apos;s selection.
                  </p>
                </div>
                {filterFormName && filterByField && (
                  <div className="rounded bg-teal-500/8 border border-teal-400/30 p-2 text-[9px] text-teal-700 leading-relaxed">
                    <span className="font-semibold block mb-0.5">Filter rule:</span>
                    Fetch row where <code className="font-mono bg-teal-100 px-1 rounded">{filterByField}</code> = value from <code className="font-mono bg-teal-100 px-1 rounded">{filterFormName}</code>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )
    }

    case 'RadioButtonsGroup':
    case 'CheckboxGroup':
    case 'Dropdown': {
      // data-source may be a template string "${data.xxx}" after Meta upload —
      // treat it as empty array so CompDataSource doesn't crash on .map()
      const rawDs = (comp as unknown as Record<string, unknown>)['data-source']
      const safeItems: DataSourceItem[] = Array.isArray(rawDs) ? (rawDs as DataSourceItem[]) : []
      const cRec = comp as unknown as Record<string, unknown>
      const hasDbSource = !!cRec._source_table_id
      const isFilterTrigger = cRec._filter_trigger === true
      const filterFormName = (cRec._filter_form_name as string) ?? ''
      const filterByField = (cRec._filter_by_field as string) ?? ''
      return (
        <div className="space-y-3">
          <CompTextField label="Label" value={comp.label} onChange={(v) => set({ label: v })} />
          <CompTextField label="Variable name (internal)" value={comp.name} onChange={(v) => set({ name: v })} placeholder="field_name" />
          <CompDataSource
            items={safeItems}
            onChange={(items) => set({ 'data-source': items })}
            sourceTableId={(comp as {_source_table_id?: string})._source_table_id}
            sourceFieldKey={(comp as {_source_field_key?: string})._source_field_key}
            onSourceChange={(tableId, fieldKey, items) =>
              set({ 'data-source': items, _source_table_id: tableId, _source_field_key: fieldKey })
            }
          />
          <CompToggle label="Required" value={comp.required ?? false} onChange={(v) => set({ required: v })} />

          {/* ── Dynamic Filter (only when a DB source is connected) ── */}
          {hasDbSource && (
            <div className="rounded-md border border-slate-200 bg-slate-50 overflow-hidden">
              {/* Header */}
              <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-slate-200 bg-slate-50">
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Dynamic Filter</span>
              </div>

              <div className="px-2.5 py-2.5 space-y-3">
                {/* These two roles are independent — a middle field in a chain
                    (e.g. Month → Programme → Date) needs to be BOTH a trigger
                    for its own children AND filtered by its own parent. */}

                {/* Trigger role — other fields can filter by this one's selection */}
                <CompToggle
                  label="Other fields can filter by this selection"
                  value={isFilterTrigger}
                  onChange={(v) => set({ _filter_trigger: v || undefined })}
                />
                {isFilterTrigger && (
                  <div className="rounded-md bg-blue-500/8 border border-blue-400/30 p-2.5 space-y-1.5">
                    <p className="text-[10px] font-semibold text-blue-600 dark:text-blue-400">
                      ✓ This triggers filtering in other fields
                    </p>
                    <p className="text-[10px] text-slate-500">
                      When the user picks a value here, fields pointing at this as their parent refresh automatically.
                    </p>
                    <div className="space-y-0.5">
                      <p className="text-[9px] text-slate-500">Pick this as the parent on the child field:</p>
                      <div className="flex items-center gap-1.5">
                        <code className="flex-1 text-[11px] font-mono text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/40 px-2 py-1 rounded">
                          {comp.name || '(set a field name above)'}
                        </code>
                        {comp.name && (
                          <button
                            onClick={() => { navigator.clipboard.writeText(comp.name) }}
                            className="text-[9px] text-blue-500 hover:text-blue-700 px-1.5 py-1 rounded border border-blue-300 dark:border-blue-700"
                          >
                            Copy
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Child role — this field's own options are filtered by a parent */}
                <div className="space-y-2.5 border-t border-slate-200 pt-3">
                  <p className="text-[10px] font-semibold text-slate-600">
                    Filter this field&apos;s options by a parent (optional)
                  </p>
                  {/* Step 1 */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] font-bold text-slate-500 bg-slate-100 rounded-full h-4 w-4 flex items-center justify-center">1</span>
                      <p className="text-[10px] font-medium text-slate-800">Parent field name</p>
                    </div>
                    <FilterParentPicker
                      allScreens={allScreens}
                      value={filterFormName}
                      onChange={(v) => set({ _filter_form_name: v || undefined })}
                    />
                    <p className="text-[9px] text-slate-500">
                      Pick the field marked as a trigger whose selection should filter this one.
                    </p>
                  </div>

                  {/* Step 2 */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] font-bold text-slate-500 bg-slate-100 rounded-full h-4 w-4 flex items-center justify-center">2</span>
                      <p className="text-[10px] font-medium text-slate-800">Filter column (from DB table)</p>
                    </div>
                    {cRec._source_table_id ? (
                      <FilterFieldPicker
                        tableId={cRec._source_table_id as string}
                        value={filterByField}
                        onChange={(v) => set({ _filter_by_field: v || undefined })}
                      />
                    ) : (
                      <Input
                        className="h-7 text-xs font-mono"
                        value={filterByField}
                        onChange={(e) => set({ _filter_by_field: e.target.value || undefined })}
                        placeholder="e.g. month"
                      />
                    )}
                    <p className="text-[9px] text-slate-500">
                      The column that stores the parent&apos;s value (e.g. month column in Training table).
                    </p>
                  </div>

                  {/* Live rule preview */}
                  {filterFormName && filterByField && (
                    <div className="rounded bg-emerald-500/8 border border-emerald-400/30 p-2 text-[9px] text-emerald-700 dark:text-emerald-400 leading-relaxed">
                      <span className="font-semibold block mb-0.5">Filter rule:</span>
                      Fetch rows where <code className="font-mono bg-emerald-100 dark:bg-emerald-900/30 px-1 rounded">{filterByField}</code> = value selected in <code className="font-mono bg-emerald-100 dark:bg-emerald-900/30 px-1 rounded">{filterFormName}</code>
                    </div>
                  )}

                  {filterFormName && !filterByField && (
                    <p className="text-[9px] text-amber-600 dark:text-amber-400">
                      ↑ Pick a DB column to complete the filter setup
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    case 'DatePicker':
      return (
        <div className="space-y-3">
          <CompTextField label="Label" value={comp.label} onChange={(v) => set({ label: v })} />
          <CompTextField label="Variable name (internal)" value={comp.name} onChange={(v) => set({ name: v })} placeholder="field_name" />
          <CompTextField label="Helper text (optional)" value={comp['helper-text'] ?? ''} onChange={(v) => set({ 'helper-text': v })} />
          <CompToggle label="Required" value={comp.required ?? false} onChange={(v) => set({ required: v })} />
        </div>
      );

    case 'Image':
      return <CompImageForm comp={comp} onUpdate={onUpdate} />;

    case 'Footer':
      return (
        <div className="space-y-3">
          <CompTextField label="Button label" value={comp.label} onChange={(v) => set({ label: v })} />
          <CompFooterAction
            action={comp['on-click-action'] as { name: string; next?: { name: string }; payload?: Record<string, unknown> }}
            allScreens={allScreens}
            onChange={(a) => set({ 'on-click-action': a })}
          />
          <CompTextField label="Left caption (optional)" value={comp['left-caption'] ?? ''} onChange={(v) => set({ 'left-caption': v })} />
          <CompTextField label="Center caption (optional)" value={comp['center-caption'] ?? ''} onChange={(v) => set({ 'center-caption': v })} />
        </div>
      );

    default:
      return <p className="text-xs text-slate-500">No form for this component type.</p>;
  }
}

// ─── Live preview panel ──────────────────────────────────────────

function sanitizeId(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'SCREEN'
}

// ── Client-side filter helper for the preview (mirrors webhook fetchOptions logic) ─
function slugifyPreview(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}
async function fetchFilteredPreviewOptions(
  tableId: string, fieldKey: string, filterByField: string, filterValue: string,
): Promise<DataSourceItem[] | null> {
  try {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
    const [recRes, tblRes] = await Promise.all([
      fetch(`/api/data-tables/${tableId}/records?pageSize=500`),
      fetch(`/api/data-tables/${tableId}`),
    ])
    if (!recRes.ok || !tblRes.ok) {
      console.warn('[preview filter] API error:', recRes.status, tblRes.status)
      return null
    }

    const recData = await recRes.json() as { records?: Array<{ data: unknown }> }
    const tblData = await tblRes.json() as { table?: { fields?: Array<{ field_key: string; label: string }> } }
    const records = recData.records ?? []
    const fields = tblData.table?.fields ?? []

    // Resolve filterByField → actual field_key (labels may differ from keys due to slugify)
    let resolvedField = filterByField
    const exactMatch = fields.find((f) => f.field_key === filterByField)
    if (!exactMatch) {
      const match = fields.find((f) => norm(f.label) === norm(filterByField) || norm(f.field_key) === norm(filterByField))
      if (match) resolvedField = match.field_key
    }

    // CompDataSource generates option IDs with "ds_" prefix (e.g. "ds_april").
    // Strip the prefix before comparing against slugified DataStore record values.
    const cleanFilterValue = filterValue.replace(/^ds_/, '')
    const filterSlug = slugifyPreview(cleanFilterValue)
    console.log(`[preview filter] filterBy="${resolvedField}" filterValue="${filterValue}" filterSlug="${filterSlug}" fieldKey="${fieldKey}" records=${records.length}`)
    if (records[0]) console.log('[preview filter] first record keys:', Object.keys(records[0].data as object ?? {}))

    const seen = new Set<string>()
    const opts: DataSourceItem[] = []
    for (const r of records) {
      const d = r.data as Record<string, unknown>
      const filterRaw = d[resolvedField]
      if (filterRaw == null) continue
      const filterVals = (Array.isArray(filterRaw) ? filterRaw : [filterRaw]).map((v) => slugifyPreview(String(v).trim()))
      if (!filterVals.includes(filterSlug)) continue
      const raw = d[fieldKey]
      if (raw == null) continue
      for (const rv of (Array.isArray(raw) ? raw : [raw])) {
        const val = String(rv).trim()
        if (val && !seen.has(val)) { seen.add(val); opts.push({ id: slugifyPreview(val) || `opt_${seen.size}`, title: val }) }
      }
    }
    console.log('[preview filter] result:', opts.length, 'options', opts.map(o => o.title))
    return opts
  } catch (err) {
    console.error('[preview filter] fetch error:', err)
    return null
  }
}

/** Fetches a single label value from DataStore for TextLabel preview. */
async function fetchPreviewLabelValue(
  tableId: string, fieldKey: string, filterByField?: string, filterValue?: string,
): Promise<string | null> {
  try {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
    const [recRes, tblRes] = await Promise.all([
      fetch(`/api/data-tables/${tableId}/records?pageSize=500`),
      fetch(`/api/data-tables/${tableId}`),
    ])
    if (!recRes.ok || !tblRes.ok) return null
    const recData = await recRes.json() as { records?: Array<{ data: unknown }> }
    const tblData = await tblRes.json() as { table?: { fields?: Array<{ field_key: string; label: string }> } }
    const records = recData.records ?? []
    const fields = tblData.table?.fields ?? []

    let resolvedFilter = filterByField
    if (filterByField) {
      const exact = fields.find((f) => f.field_key === filterByField)
      if (!exact) {
        const match = fields.find((f) => norm(f.label) === norm(filterByField) || norm(f.field_key) === norm(filterByField))
        if (match) resolvedFilter = match.field_key
      }
    }

    for (const r of records) {
      const d = r.data as Record<string, unknown>
      if (resolvedFilter && filterValue) {
        const cleanVal = filterValue.replace(/^ds_/, '')
        const filterSlug = slugifyPreview(cleanVal)
        const filterRaw = d[resolvedFilter]
        if (filterRaw == null) continue
        const filterVals = (Array.isArray(filterRaw) ? filterRaw : [filterRaw]).map((v) => slugifyPreview(String(v).trim()))
        if (!filterVals.includes(filterSlug)) continue
      }
      const raw = d[fieldKey]
      if (raw != null) return String(Array.isArray(raw) ? raw[0] : raw).trim()
    }
    return ''
  } catch { return null }
}

function LivePreviewPanel({
  screens,
  selectedScreen,
}: {
  screens: MetaFlowScreen[];
  selectedScreen: MetaFlowScreen | undefined;
}) {
  const [simMode, setSimMode] = useState(false);
  const [simScreenId, setSimScreenId] = useState<string>('');
  const [history, setHistory] = useState<string[]>([]);
  const [completed, setCompleted] = useState(false);
  const [simValues, setSimValues] = useState<Record<string, string>>({});
  // previewData: comp.id → filtered options (array) | label value (string) | null (error) | undefined (not yet fetched)
  const [previewData, setPreviewData] = useState<Record<string, DataSourceItem[] | string | null>>({});

  // build a sanitized-ID → screen map
  const screenMap = Object.fromEntries(
    screens.map((s) => [sanitizeId(s.id), s])
  );

  const startSim = () => {
    const first = screens[0];
    if (!first) return;
    setSimScreenId(sanitizeId(first.id));
    setHistory([]);
    setCompleted(false);
    setSimValues({});
    setPreviewData({});
    setSimMode(true);
  };

  const stopSim = () => { setSimMode(false); setCompleted(false); };

  const currentSimScreen = simMode ? screenMap[simScreenId] : undefined;

  // When simValues changes, check if any filter trigger changed and prefetch child options
  useEffect(() => {
    if (!simMode) return
    for (const screen of screens) {
      for (const comp of screen.components) {
        const c = comp as unknown as Record<string, unknown>
        if (c._filter_trigger !== true || !c.name) continue
        const triggerName = c.name as string
        const triggerValue = simValues[triggerName]
        if (!triggerValue) {
          // Reset children to undefined (waiting) when parent is cleared —
          // collect ids first so this is a single batched update, not one
          // setState call per matching child.
          const idsToClear: string[] = []
          for (const s2 of screens) {
            for (const comp2 of s2.components) {
              const c2 = comp2 as unknown as Record<string, unknown>
              if (c2._filter_form_name !== triggerName) continue
              idsToClear.push(comp2.id as string)
            }
          }
          if (idsToClear.length > 0) {
            setPreviewData((prev) => {
              const next = { ...prev }
              for (const id of idsToClear) delete next[id]
              return next
            })
          }
          continue
        }
        console.log('[preview filter] trigger:', triggerName, '=', triggerValue)
        // Find all filter children across all screens
        for (const s2 of screens) {
          for (const comp2 of s2.components) {
            const c2 = comp2 as unknown as Record<string, unknown>
            if (c2._filter_form_name !== triggerName) { continue }
            if (!c2._source_table_id || !c2._source_field_key || !c2._filter_by_field) {
              console.warn('[preview filter] child', comp2.id, 'missing _source_table_id/_source_field_key/_filter_by_field:', {
                tableId: c2._source_table_id, fieldKey: c2._source_field_key, filterBy: c2._filter_by_field,
              })
              continue
            }
            console.log('[preview filter] child:', comp2.id, 'type:', c2.type, 'tableId:', c2._source_table_id, 'fieldKey:', c2._source_field_key, 'filterBy:', c2._filter_by_field)
            if (c2.type === 'TextLabel' && c2.name) {
              fetchPreviewLabelValue(
                c2._source_table_id as string,
                c2._source_field_key as string,
                c2._filter_by_field as string,
                triggerValue,
              ).then((val) => setPreviewData((prev) => ({ ...prev, [comp2.id as string]: val })))
            } else {
              fetchFilteredPreviewOptions(
                c2._source_table_id as string,
                c2._source_field_key as string,
                c2._filter_by_field as string,
                triggerValue,
              ).then((opts) => setPreviewData((prev) => ({ ...prev, [comp2.id as string]: opts })))
            }
          }
        }
      }
    }
  }, [simValues, simMode, screens])

  // Fetch initial values for non-filtered TextLabel components when simulation starts
  useEffect(() => {
    if (!simMode) return
    for (const screen of screens) {
      for (const comp of screen.components) {
        const c = comp as unknown as Record<string, unknown>
        if (c.type !== 'TextLabel' || !c._source_table_id || !c._source_field_key) continue
        if (c._filter_form_name) continue  // filtered: wait for parent dropdown
        fetchPreviewLabelValue(
          c._source_table_id as string,
          c._source_field_key as string,
        ).then((val) => setPreviewData((prev) => ({ ...prev, [comp.id as string]: val })))
      }
    }
  }, [simMode, screens])

  // Handle footer button click in simulation
  const handleFooterClick = (action: Record<string, unknown>) => {
    if (action.name === 'navigate') {
      const targetName = (action.next as Record<string, unknown>)?.name as string;
      if (targetName && screenMap[targetName]) {
        setHistory((h) => [...h, simScreenId]);
        setSimScreenId(targetName);
      }
    } else if (action.name === 'complete' || action.name === 'data_exchange') {
      setCompleted(true);
    }
  };

  const handleBack = () => {
    const prev = history[history.length - 1];
    if (prev) {
      setHistory((h) => h.slice(0, -1));
      setSimScreenId(prev);
      setCompleted(false);
    }
  };

  const displayScreen = simMode ? currentSimScreen : selectedScreen;

  return (
    <div className="flex w-[340px] shrink-0 flex-col bg-white">
      {/* Panel header */}
      <div className="flex h-11 items-center justify-between border-b border-slate-200 px-4">
        <div className="flex items-center gap-2">
          <SmartphoneIcon className="h-3.5 w-3.5 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-800">
            {simMode ? 'Live Simulation' : 'Preview'}
          </h2>
          {simMode && (
            <span className="flex h-4 items-center rounded-full bg-emerald-500/15 px-1.5 text-[9px] font-semibold text-emerald-500">
              LIVE
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {simMode ? (
            <>
              <button
                onClick={() => { startSim(); }}
                className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
                title="Restart simulation"
              >
                <RotateCcw className="h-3 w-3" /> Restart
              </button>
              <button
                onClick={stopSim}
                className="flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
              >
                <X className="h-3 w-3" /> Stop
              </button>
            </>
          ) : (
            <button
              onClick={startSim}
              disabled={screens.length === 0}
              className="flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-600 hover:bg-emerald-500/20 disabled:opacity-40 transition-colors"
            >
              <Play className="h-3 w-3" /> Simulate
            </button>
          )}
        </div>
      </div>

      {/* Screen crumb */}
      {simMode && !completed && (
        <div className="flex items-center gap-1 border-b border-slate-200 bg-slate-50 px-4 py-1.5">
          {history.length > 0 && (
            <button onClick={handleBack} className="rounded p-0.5 text-slate-500 hover:text-slate-800">
              <ChevronLeftIcon className="h-3.5 w-3.5" />
            </button>
          )}
          <div className="flex items-center gap-1 text-[10px] text-slate-500 overflow-x-auto">
            {history.map((hid, i) => (
              <span key={i} className="shrink-0">{screenMap[hid]?.title ?? hid} › </span>
            ))}
            <span className="shrink-0 font-medium text-slate-800">{currentSimScreen?.title}</span>
          </div>
        </div>
      )}

      {/* Phone frame */}
      <div className="flex-1 overflow-y-auto p-4">
        {completed ? (
          <div className="mx-auto max-w-[280px]">
            <div className="overflow-hidden rounded-[2rem] border-4 border-gray-800 bg-white shadow-2xl">
              <div className="bg-gray-800 px-4 py-1 text-center text-[9px] text-white/60">9:41 AM</div>
              <div className="bg-[#075E54] flex items-center gap-2 px-3 py-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-400/30">
                  <span className="text-[9px] text-white font-bold">B</span>
                </div>
                <p className="flex-1 text-[10px] font-semibold text-white">WhatsApp Flow</p>
              </div>
              <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 bg-white p-6">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
                  <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                </div>
                <p className="text-center text-[13px] font-semibold text-gray-900">Flow Completed</p>
                <p className="text-center text-[11px] text-gray-500">The user has submitted the form.</p>
                {Object.keys(simValues).length > 0 && (
                  <div className="w-full rounded-lg bg-gray-50 p-3 space-y-1">
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Collected data</p>
                    {Object.entries(simValues).map(([k, v]) => (
                      <div key={k} className="flex items-baseline justify-between gap-2">
                        <span className="text-[10px] text-gray-500">{k}</span>
                        <span className="text-[10px] font-medium text-gray-800 truncate max-w-[120px]">{v}</span>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  onClick={() => startSim()}
                  className="text-[10px] text-emerald-600 hover:underline"
                >
                  ↩ Start over
                </button>
              </div>
            </div>
          </div>
        ) : displayScreen ? (
          <SimPhonePreview
            screen={displayScreen}
            simMode={simMode}
            simValues={simValues}
            onValueChange={(name, val) => setSimValues((v) => ({ ...v, [name]: val }))}
            onFooterClick={handleFooterClick}
            previewData={previewData}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs text-slate-500">Select a screen to preview</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Phone preview (with optional sim interactivity) ─────────────

function SimPhonePreview({
  screen,
  simMode,
  simValues,
  onValueChange,
  onFooterClick,
  previewData,
}: {
  screen: MetaFlowScreen;
  simMode: boolean;
  simValues: Record<string, string>;
  onValueChange: (name: string, val: string) => void;
  onFooterClick: (action: Record<string, unknown>) => void;
  previewData: Record<string, DataSourceItem[] | string | null>;
}) {
  const footer = screen.components.find((c) => c.type === 'Footer') as
    | (MetaFlowComponent & { type: 'Footer'; label: string; 'on-click-action'?: Record<string, unknown> }) | undefined;
  const bodyComponents = screen.components.filter((c) => c.type !== 'Footer');

  return (
    <div className="mx-auto max-w-[280px]">
      <div className="overflow-hidden rounded-[2rem] border-4 border-gray-800 bg-white shadow-2xl">
        <div className="bg-gray-800 px-4 py-1 text-center text-[9px] text-white/60">9:41 AM</div>
        <div className="flex items-center gap-2 bg-[#075E54] px-3 py-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-400/30">
            <span className="text-[9px] text-white font-bold">B</span>
          </div>
          <div className="flex-1">
            <p className="text-[10px] font-semibold text-white">{screen.title}</p>
          </div>
          <X className="h-3.5 w-3.5 text-white/70" />
        </div>
        <div className="flex min-h-[420px] flex-col overflow-hidden bg-white">
          <div className="border-b border-gray-100 px-4 py-3">
            <p className="text-[13px] font-semibold text-gray-900">{screen.title}</p>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {bodyComponents.map((comp) => (
              <SimPreviewComponent
                key={comp.id}
                comp={comp}
                simMode={simMode}
                simValues={simValues}
                onValueChange={onValueChange}
                previewData={previewData}
              />
            ))}
          </div>
          {footer && (
            <div className="border-t border-gray-100 px-4 py-3">
              <button
                onClick={() => simMode && footer['on-click-action'] && onFooterClick(footer['on-click-action'])}
                className={cn(
                  'w-full rounded-full py-2.5 text-[12px] font-semibold text-white transition-all',
                  simMode
                    ? 'bg-[#0ACC73] hover:bg-[#00b96b] active:scale-95 cursor-pointer shadow-md'
                    : 'bg-[#0ACC73] opacity-60 cursor-not-allowed',
                )}
              >
                {footer.label}
              </button>
              {(footer as MetaFlowComponent & {'center-caption'?: string})['center-caption'] && (
                <p className="mt-1.5 text-center text-[9px] text-gray-400">
                  {(footer as MetaFlowComponent & {'center-caption'?: string})['center-caption']}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
      <p className="mt-3 text-center text-[10px] text-slate-500">
        Managed by the business. <span className="text-[#25D366]">Learn more</span>
      </p>
    </div>
  );
}

function SimPreviewComponent({
  comp,
  simMode,
  simValues,
  onValueChange,
  previewData,
}: {
  comp: MetaFlowComponent;
  simMode: boolean;
  simValues: Record<string, string>;
  onValueChange: (name: string, val: string) => void;
  previewData: Record<string, DataSourceItem[] | string | null>;
}) {
  const req = (comp as { required?: boolean }).required === true
  switch (comp.type) {
    case 'TextHeading':
      return <p className="text-[15px] font-bold text-gray-900">{comp.text || <span className="text-gray-300">Heading</span>}</p>;
    case 'TextSubheading':
      return <p className="text-[13px] font-semibold text-gray-800">{comp.text || <span className="text-gray-300">Subheading</span>}</p>;
    case 'TextBody':
      return <p className="text-[12px] text-gray-700 leading-relaxed">{comp.text || <span className="text-gray-300">Body text</span>}</p>;
    case 'TextCaption':
      return <p className="text-[10px] text-gray-500">{comp.text || <span className="text-gray-300">Caption</span>}</p>;

    case 'TextInput': {
      const ti = comp as { name: string; label: string; 'helper-text'?: string };
      return (
        <div className="space-y-1">
          <label><FieldLabel label={ti.label} required={req} /></label>
          {simMode ? (
            <input
              className="h-8 w-full rounded border border-gray-300 bg-white px-2 text-[11px] text-gray-800 focus:border-[#25D366] focus:outline-none"
              placeholder={ti['helper-text'] ?? ti.label}
              value={simValues[ti.name] ?? ''}
              onChange={(e) => onValueChange(ti.name, e.target.value)}
            />
          ) : (
            <div className="h-8 rounded border border-gray-300 bg-gray-50 px-2 flex items-center">
              <span className="text-[10px] text-gray-400">{ti['helper-text'] ?? ti.label}</span>
            </div>
          )}
        </div>
      );
    }

    case 'TextArea': {
      const ta = comp as { name: string; label: string; 'max-length'?: number };
      return (
        <div className="space-y-1">
          <label><FieldLabel label={ta.label} required={req} /></label>
          {simMode ? (
            <textarea
              className="h-16 w-full resize-none rounded border border-gray-300 bg-white p-2 text-[11px] text-gray-800 focus:border-[#25D366] focus:outline-none"
              placeholder={ta.label}
              value={simValues[ta.name] ?? ''}
              onChange={(e) => onValueChange(ta.name, e.target.value)}
              maxLength={ta['max-length'] ?? 600}
            />
          ) : (
            <div className="h-16 rounded border border-gray-300 bg-gray-50 p-2">
              <span className="text-[10px] text-gray-400">Leave a comment (optional)</span>
            </div>
          )}
          <p className="text-right text-[9px] text-gray-400">
            {simMode ? (simValues[ta.name] ?? '').length : 0} / {ta['max-length'] ?? 600}
          </p>
        </div>
      );
    }

    case 'RadioButtonsGroup': {
      const r = comp as { name: string; label: string; 'data-source': DataSourceItem[] };
      const selected = simValues[r.name] ?? '';
      return (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-gray-800">{r.label}{req && <span className="ml-0.5 text-red-500">*</span>}</p>
          {(Array.isArray(r['data-source']) ? r['data-source'] : []).map((opt) => (
            <label
              key={opt.id}
              className={cn(
                'flex items-center justify-between py-1 border-b border-gray-100 last:border-0 transition-colors',
                simMode && 'cursor-pointer hover:bg-gray-50',
              )}
              onClick={() => simMode && onValueChange(r.name, opt.id)}
            >
              <span className="text-[11px] text-gray-700">{opt.title}</span>
              <div className={cn(
                'h-4 w-4 rounded-full border-2 transition-all',
                selected === opt.id ? 'border-[#25D366] bg-[#25D366]' : 'border-gray-400',
              )} />
            </label>
          ))}
        </div>
      );
    }

    case 'CheckboxGroup': {
      const cb = comp as { name: string; label: string; 'data-source': DataSourceItem[] };
      const selectedIds = (simValues[cb.name] ?? '').split(',').filter(Boolean);
      const toggleCb = (id: string) => {
        if (!simMode) return;
        const next = selectedIds.includes(id)
          ? selectedIds.filter((x) => x !== id)
          : [...selectedIds, id];
        onValueChange(cb.name, next.join(','));
      };
      return (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-gray-800">{cb.label}{req && <span className="ml-0.5 text-red-500">*</span>}</p>
          {(Array.isArray(cb['data-source']) ? cb['data-source'] : []).map((opt) => (
            <label
              key={opt.id}
              className={cn('flex items-center gap-2 py-1 border-b border-gray-100 last:border-0', simMode && 'cursor-pointer hover:bg-gray-50')}
              onClick={() => toggleCb(opt.id)}
            >
              <div className={cn(
                'h-4 w-4 rounded border-2 flex items-center justify-center transition-all',
                selectedIds.includes(opt.id) ? 'border-[#25D366] bg-[#25D366]' : 'border-gray-400',
              )}>
                {selectedIds.includes(opt.id) && <Check className="h-2.5 w-2.5 text-white" />}
              </div>
              <span className="text-[11px] text-gray-700">{opt.title}</span>
            </label>
          ))}
        </div>
      );
    }

    case 'Dropdown': {
      const dd = comp as { name: string; label: string; 'data-source': DataSourceItem[]; _filter_form_name?: string };
      // Use live-filtered options from previewData if this is a filter-child dropdown
      const hasFilterParent = !!(dd._filter_form_name)
      // filteredOpts is undefined = not yet fetched, null = fetch error, [] = loaded but empty, [...] = has results
      const rawPreviewVal = previewData[comp.id]
      const filteredOpts = Array.isArray(rawPreviewVal) ? rawPreviewVal : (rawPreviewVal === null ? null : undefined)
      const isWaitingForFilter = hasFilterParent && filteredOpts === undefined
      const isFilterEmpty = hasFilterParent && Array.isArray(filteredOpts) && filteredOpts.length === 0
      const ddOptions = Array.isArray(filteredOpts) ? filteredOpts : (Array.isArray(dd['data-source']) ? dd['data-source'] : [])
      return (
        <div className="space-y-1">
          <label><FieldLabel label={dd.label} required={req} /></label>
          {simMode ? (
            isWaitingForFilter ? (
              <div className="flex h-8 items-center justify-between rounded border border-gray-300 bg-gray-50 px-2">
                <span className="text-[10px] text-gray-400 italic">Select a value above first…</span>
                <ChevronDown className="h-3 w-3 text-gray-400" />
              </div>
            ) : isFilterEmpty ? (
              <div className="flex h-8 items-center justify-between rounded border border-orange-200 bg-orange-50 px-2">
                <span className="text-[10px] text-orange-500 italic">No options for selected value</span>
                <ChevronDown className="h-3 w-3 text-orange-400" />
              </div>
            ) : (
              <select
                className="h-8 w-full rounded border border-gray-300 bg-white px-2 text-[11px] text-gray-800 focus:border-[#25D366] focus:outline-none"
                value={simValues[dd.name] ?? ''}
                onChange={(e) => onValueChange(dd.name, e.target.value)}
              >
                <option value="">Select an option</option>
                {ddOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>{opt.title}</option>
                ))}
              </select>
            )
          ) : (
            <div className="flex h-8 items-center justify-between rounded border border-gray-300 bg-gray-50 px-2">
              <span className="text-[10px] text-gray-400">
                {hasFilterParent ? 'Filtered by parent selection' : 'Select an option'}
              </span>
              <ChevronDown className="h-3 w-3 text-gray-400" />
            </div>
          )}
        </div>
      );
    }

    case 'DatePicker': {
      const dp = comp as { name: string; label: string };
      return (
        <div className="space-y-1">
          <label><FieldLabel label={dp.label} required={req} /></label>
          {simMode ? (
            <input
              type="date"
              className="h-8 w-full rounded border border-gray-300 bg-white px-2 text-[11px] text-gray-800 focus:border-[#25D366] focus:outline-none"
              value={simValues[dp.name] ?? ''}
              onChange={(e) => onValueChange(dp.name, e.target.value)}
            />
          ) : (
            <div className="flex h-8 items-center justify-between rounded border border-gray-300 bg-gray-50 px-2">
              <span className="text-[10px] text-gray-400">MM / DD / YYYY</span>
              <span className="text-gray-400 text-xs">📅</span>
            </div>
          )}
        </div>
      );
    }

    case 'TextLabel': {
      const tl = comp as { text?: string; _source_table_id?: string; _filter_form_name?: string }
      const hasSource = !!(tl._source_table_id)
      const hasFilter = !!(tl._filter_form_name)
      const rawVal = previewData[comp.id]
      let displayText: string | React.ReactNode
      if (hasSource) {
        if (rawVal === undefined && hasFilter) {
          displayText = <span className="italic text-gray-400">(select above to load)</span>
        } else if (rawVal === undefined) {
          displayText = <span className="italic text-gray-400">Loading…</span>
        } else if (rawVal === null) {
          displayText = <span className="italic text-orange-400">(load failed)</span>
        } else if (typeof rawVal === 'string') {
          displayText = rawVal || <span className="italic text-gray-400">(empty)</span>
        } else {
          displayText = tl.text || <span className="italic text-gray-400">Label</span>
        }
      } else {
        displayText = tl.text || <span className="text-gray-300">Label text</span>
      }
      return <p className="text-[12px] text-gray-700 leading-relaxed">{displayText}</p>
    }

    case 'Image': {
      const img = comp as { src: string; 'alt-text'?: string };
      return img.src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img.src} alt={img['alt-text'] ?? ''} className="w-full rounded object-cover max-h-32" />
      ) : (
        <div className="flex h-16 items-center justify-center rounded border-2 border-dashed border-gray-300 text-[10px] text-gray-400">
          No image URL set
        </div>
      );
    }

    default:
      return null;
  }
}

function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <span className="text-[10px] font-medium text-gray-600">
      {label}{required && <span className="ml-0.5 text-red-500">*</span>}
    </span>
  )
}
