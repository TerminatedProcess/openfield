/**
 * The Qwen-Image model chip (Image, Director): stock, fine-tunes, GGUF and
 * Nunchaku quantizations the engine sees (server/qwenModels.ts). '' runs the
 * server's default (OPENFIELD_QWEN_IMAGE_MODEL, else stock). Remembered across pages.
 */
import { useEffect, useState } from 'react';
import { ChipMenu } from './ui';

interface QwenModel { name: string; loader: 'unet' | 'gguf' | 'nunchaku'; isDefault: boolean }
interface QwenModels { models: QwenModel[]; nunchakuLoras: boolean }

const KEY = 'openfield.qwenModel';
let cache: Promise<QwenModels> | null = null;
const fetchModels = () =>
  (cache ??= fetch('/api/qwen-models').then((r) => r.json() as Promise<QwenModels>).catch(() => ({ models: [], nunchakuLoras: false })));

const short = (n: string) => n.split(/[\\/]/).pop()!.replace(/\.(safetensors|gguf)$/i, '');
const NOTE: Record<QwenModel['loader'], string> = { unet: '', gguf: 'GGUF', nunchaku: 'Nunchaku' };

export function useQwenModel(): [string, (v: string) => void] {
  const [v, setV] = useState(() => { try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; } });
  const set = (x: string) => { setV(x); try { localStorage.setItem(KEY, x); } catch { /* private window */ } };
  return [v, set];
}

export function QwenModelChip({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [list, setList] = useState<QwenModels | null>(null);
  useEffect(() => { void fetchModels().then(setList); }, []);
  // Forget a pick the engine no longer lists.
  // (An empty list means the engine did not answer: keep the pick.)
  useEffect(() => { if (list?.models.length && value && !list.models.some((m) => m.name === value)) onChange(''); }, [list, value]);
  const def = list?.models.find((m) => m.isDefault);
  const options = [
    { value: '', label: def ? `Default: ${short(def.name)}` : 'Default' },
    ...(list?.models ?? []).filter((m) => !m.isDefault).map((m) => ({
      value: m.name, label: short(m.name),
      note: [NOTE[m.loader], m.loader === 'nunchaku' && !list!.nunchakuLoras ? 'no LoRAs or Draft' : ''].filter(Boolean).join(' · ') || undefined,
    })),
  ];
  if (options.length < 2) return null;
  return <ChipMenu icon="sparkle" value={value} onChange={onChange} title="Qwen-Image model" options={options} />;
}
