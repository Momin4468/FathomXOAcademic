"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Input, cx } from "./ui";

export interface PickItem {
  id: string;
  label: string;
  sub?: string;
}

/**
 * Capture-first type-ahead: pick-don't-type. Debounced search; optional
 * create-on-the-fly (e.g. a provisional course) when nothing matches.
 */
export function EntityPicker({
  placeholder,
  search,
  onPick,
  onCreate,
}: {
  placeholder?: string;
  search: (q: string) => Promise<PickItem[]>;
  onPick: (item: PickItem | null) => void;
  onCreate?: (raw: string) => Promise<PickItem>;
}) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<PickItem[]>([]);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<PickItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (picked || q.trim().length < 1) {
      setItems([]);
      setSearching(false);
      return;
    }
    const mine = ++seq.current;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await search(q.trim());
        if (mine === seq.current) {
          setItems(res);
          setOpen(true);
        }
      } catch {
        if (mine === seq.current) setItems([]);
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q, picked, search]);

  // Close on outside click.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function choose(item: PickItem) {
    setPicked(item);
    setOpen(false);
    setQ("");
    onPick(item);
  }
  function clear() {
    setPicked(null);
    onPick(null);
  }

  if (picked) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-ink-700 bg-ink-850 px-3 py-2">
        <span className="text-sm text-slate-100">{picked.label}</span>
        <button type="button" className="text-xs text-slate-400 hover:underline" onClick={clear}>
          change
        </button>
      </div>
    );
  }

  const typed = q.trim();
  const exact = items.some((i) => i.label.toLowerCase() === typed.toLowerCase());
  const showDropdown = open && typed.length > 0 && (searching || items.length > 0 || !!onCreate);
  return (
    <div className="relative" ref={boxRef}>
      <Input
        placeholder={placeholder}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => typed && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          else if (e.key === "Enter" && items[0]) {
            e.preventDefault();
            choose(items[0]); // pick the top match
          }
        }}
      />
      {showDropdown && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-ink-700 bg-ink-850 shadow-sm">
          {searching && <li className="px-3 py-2 text-xs text-slate-500">Searching…</li>}
          {!searching && items.length === 0 && !onCreate && (
            <li className="px-3 py-2 text-xs text-slate-500">No matches</li>
          )}
          {items.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                className={cx("flex min-h-[44px] w-full items-center justify-between px-3 py-2 text-left text-sm text-slate-100 hover:bg-ink-800")}
                onClick={() => choose(i)}
              >
                <span>{i.label}</span>
                {i.sub && <span className="text-xs text-slate-500">{i.sub}</span>}
              </button>
            </li>
          ))}
          {onCreate && q.trim() && !exact && (
            <li className="border-t border-ink-800">
              <button
                type="button"
                disabled={busy}
                className="flex min-h-[44px] w-full items-center px-3 py-2 text-left text-sm text-slate-300 hover:bg-ink-800 disabled:opacity-60"
                onClick={async () => {
                  setBusy(true);
                  try {
                    choose(await onCreate(q.trim()));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                + Add &ldquo;{q.trim()}&rdquo; <span className="text-xs text-slate-500">(new, provisional)</span>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
