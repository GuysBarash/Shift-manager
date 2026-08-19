"use client";

import { useState } from "react";
import type { Profile } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ChevronDown, Eraser } from "lucide-react";

export type Brush = "erase" | string | null;

export function BrushToolbar({
  profiles,
  colorAssignments,
  brush,
  onSelect,
  editMode,
  onToggleEditMode,
  onSave,
  onDiscard,
  saving,
}: {
  profiles: Profile[];
  colorAssignments: Map<string, { name: string; hex: string }>;
  brush: Brush;
  onSelect: (b: Brush) => void;
  editMode: boolean;
  onToggleEditMode: (on: boolean) => void;
  onSave: () => void;
  onDiscard: () => void;
  saving: boolean;
}) {
  const [open, setOpen] = useState(false);

  const selectedProfile = brush && brush !== "erase" ? (profiles.find((p) => p.id === brush) ?? null) : null;
  const selectedColor = selectedProfile ? colorAssignments.get(selectedProfile.id) : null;

  function EraseButton() {
    return (
      <button
        type="button"
        onClick={() => onSelect(brush === "erase" ? null : "erase")}
        className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-start text-xs whitespace-nowrap transition-colors ${
          brush === "erase"
            ? "bg-destructive/15 text-destructive ring-1 ring-destructive/60"
            : "text-muted-foreground hover:bg-accent"
        }`}
      >
        <Eraser className="size-4" />
        מחיקה
      </button>
    );
  }

  function EditModeControls() {
    return (
      <>
        <label className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
          <Switch checked={editMode} onCheckedChange={onToggleEditMode} />
          מצב עריכה
        </label>
        {editMode && (
          <div className="flex gap-1 px-1">
            <Button size="sm" onClick={onSave} disabled={saving} className="flex-1">
              {saving ? "שומר..." : "שמור"}
            </Button>
            <Button size="sm" variant="ghost" onClick={onDiscard} disabled={saving} className="flex-1">
              התעלם
            </Button>
          </div>
        )}
      </>
    );
  }

  function PersonButtons() {
    return (
      <>
        {profiles.map((p) => {
          const color = colorAssignments.get(p.id);
          const selected = brush === p.id;
          return (
            <button
              type="button"
              key={p.id}
              onClick={() => onSelect(selected ? null : p.id)}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-start text-xs whitespace-nowrap transition-colors hover:bg-accent"
              style={{
                backgroundColor: selected && color ? `${color.hex}22` : undefined,
                boxShadow: selected && color ? `0 0 0 1px ${color.hex}` : undefined,
              }}
            >
              <span
                className="size-3 shrink-0 rounded-full"
                style={{
                  backgroundColor: color?.hex,
                  boxShadow: color ? `0 0 6px ${color.hex}` : undefined,
                }}
              />
              <span style={{ color: color?.hex }}>{p.full_name || "?"}</span>
            </button>
          );
        })}
      </>
    );
  }

  return (
    <>
      {/* Mobile: frozen, collapsible bar above the table */}
      <div className="sticky top-0 z-40 rounded-md border border-border/60 bg-card shadow-sm md:hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-2 px-3 py-2"
        >
          <span className="flex items-center gap-2 text-xs">
            {brush === "erase" ? (
              <>
                <Eraser className="size-3.5 text-destructive" />
                <span className="text-destructive">מחיקה</span>
              </>
            ) : selectedProfile ? (
              <>
                <span
                  className="size-3 shrink-0 rounded-full"
                  style={{
                    backgroundColor: selectedColor?.hex,
                    boxShadow: selectedColor ? `0 0 6px ${selectedColor.hex}` : undefined,
                  }}
                />
                <span style={{ color: selectedColor?.hex }}>{selectedProfile.full_name || "?"}</span>
              </>
            ) : (
              <span className="text-muted-foreground">מברשת: בחר צבע</span>
            )}
          </span>
          <ChevronDown
            className={`size-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
        {open && (
          <div className="border-t border-border/60 p-2">
            <div className="mb-1 flex flex-col gap-1 border-b border-border/60 pb-2">
              <EditModeControls />
            </div>
            <div className="flex flex-wrap gap-1">
              <EraseButton />
              <PersonButtons />
            </div>
          </div>
        )}
      </div>

      {/* Desktop: vertical sidebar next to the table */}
      <div className="sticky top-4 hidden shrink-0 flex-col gap-1 self-start rounded-md border border-border/60 bg-card p-2 md:flex">
        <EditModeControls />
        <div className="my-1 h-px bg-border/60" />
        <EraseButton />
        <div className="my-1 h-px bg-border/60" />
        <PersonButtons />
      </div>
    </>
  );
}
