/**
 * Your own LoRAs: a chip that adds any LoRA the engine sees (character,
 * style, motion) to a take, and a row of the ones added with their strength.
 * The server reads each file's family from its tensor keys, so the menu only
 * lists LoRAs made for the model the app is running (server/loras.ts).
 */
import { useEffect, useRef, useState } from 'react';
import { Icon, useClickAway } from './ui';

export type LoraFamily = 'ltx' | 'h3' | 'qwen' | 'flux2' | 'flux' | 'wan' | 'other';
export interface UserLora { name: string; family: LoraFamily | null; trigger?: string }
export interface LoraPick { name: string; strength: number }

const MAX = 4;
let cache: Promise<UserLora[]> | null = null;

/** The engine's LoRAs, fetched once per page load (re-fetched when the menu opens). */
function fetchLoras(fresh = false): Promise<UserLora[]> {
  if (!cache || fresh) {
    cache = fetch('/api/loras').then((r) => r.json()).then((d) => (d.loras ?? []) as UserLora[]).catch(() => []);
  }
  return cache;
}

const short = (name: string) => name.split(/[\\/]/).pop()!.replace(/\.safetensors$/i, '');

/** Remembered per model family, so a character LoRA stays on across takes. */
export function useLoraPicks(family: LoraFamily): [LoraPick[], (v: LoraPick[]) => void] {
  const key = `openfield.loras.${family}`;
  const read = (): LoraPick[] => {
    try { return JSON.parse(localStorage.getItem(key) ?? '[]'); } catch { return []; }
  };
  // Picks are tied to the family they were read for. On the render where the
  // family changes, the stored picks for the new family are read right away:
  // handing the old family's picks to LoraChips for one render would let its
  // "drop what doesn't fit" pass save an empty list over the new family's picks.
  const [state, setState] = useState(() => ({ key, picks: read() }));
  const picks = state.key === key ? state.picks : read();
  useEffect(() => { if (state.key !== key) setState({ key, picks: read() }); }, [key]);
  const set = (v: LoraPick[]) => {
    setState({ key, picks: v });
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private window */ }
  };
  return [picks, set];
}

export function LoraChips({ family, value, onChange, dir = 'up' }: {
  family: LoraFamily; value: LoraPick[]; onChange: (v: LoraPick[]) => void; dir?: 'up' | 'down';
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [all, setAll] = useState<UserLora[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, () => setOpen(false), open);
  useEffect(() => { void fetchLoras().then(setAll); }, []);
  useEffect(() => { if (open) void fetchLoras(true).then(setAll); else setQuery(''); }, [open]);

  const fits = all.filter((l) => l.family === family || l.family === null);
  // Drop picks the engine no longer has once the list has loaded.
  useEffect(() => {
    if (!all.length) return;
    const ok = value.filter((p) => fits.some((l) => l.name === p.name));
    if (ok.length !== value.length) onChange(ok);
  }, [all, family]);

  const add = (name: string) => { onChange([...value, { name, strength: 1 }].slice(0, MAX)); setOpen(false); };
  const nudge = (i: number, d: number) =>
    onChange(value.map((p, j) => (j === i ? { ...p, strength: Math.round(Math.max(-2, Math.min(2, p.strength + d)) * 10) / 10 } : p)));
  const free = fits.filter((l) => !value.some((p) => p.name === l.name));
  // Every word must appear in the file name or its trigger, in any order.
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = words.length ? free.filter((l) => words.every((w) => `${l.name} ${l.trigger ?? ''}`.toLowerCase().includes(w))) : free;

  return (
    <>
      <div className="pop-wrap" ref={ref}>
        <button type="button" className={`chip ${value.length ? 'on' : ''}`} onClick={() => setOpen(!open)}
          title="Add your own LoRA: a character, a style, a motion">
          <Icon name="bolt" size={14} />
          <span>{value.length ? `LoRA ${value.length}` : 'LoRA'}</span>
        </button>
        {open && (
          <div className={`popover ${dir}`} style={{ left: 0, maxHeight: 340, overflowY: 'auto', minWidth: 260 }}>
            <div className="pop-title label">Your LoRAs{fits.length > 8 ? ` · ${shown.length} of ${free.length}` : ''}</div>
            {fits.length > 8 && (
              <input type="search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your LoRAs"
                style={{ width: '100%', boxSizing: 'border-box', margin: '2px 0 6px' }} aria-label="Search your LoRAs" />
            )}
            {shown.map((l) => (
              <button key={l.name} type="button" className="pop-item" disabled={value.length >= MAX} onClick={() => add(l.name)}>
                <span>{short(l.name)}</span>
                {(l.trigger || l.family === null) && <small>{l.trigger ? `trigger: ${l.trigger}` : 'could not read its model'}</small>}
              </button>
            ))}
            {free.length > 0 && !shown.length && (
              <div className="pop-item" style={{ cursor: 'default' }}><small>No LoRA matches "{query}".</small></div>
            )}
            {!free.length && (
              <div className="pop-item" style={{ cursor: 'default' }}>
                <small>{fits.length ? 'All added.' : "No LoRAs for this model yet. Put .safetensors files in ComfyUI's models/loras folder; they show up without a restart."}</small>
              </div>
            )}
          </div>
        )}
      </div>
      {value.map((p, i) => (
        <span key={p.name} className="chip on lora-pick" title={p.name}>
          <span className="lora-name">{short(p.name)}</span>
          <button type="button" onClick={() => nudge(i, -0.1)} aria-label="weaker"><Icon name="minus" size={11} /></button>
          <span className="lora-w">{p.strength.toFixed(1)}</span>
          <button type="button" onClick={() => nudge(i, 0.1)} aria-label="stronger"><Icon name="plus" size={11} /></button>
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="remove"><Icon name="x" size={11} /></button>
        </span>
      ))}
    </>
  );
}
