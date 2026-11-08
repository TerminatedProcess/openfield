/**
 * The Qwen-Image diffusion models a take can pick (the Image and Director
 * "Qwen model" chip): stock, fine-tunes, GGUF and Nunchaku quantizations, as
 * ComfyUI lists them. Only names from these lists are accepted, so a request
 * can never name a path; ComfyUI would refuse any other value anyway.
 */
import { comboOptions } from './comfy.js';
import { NUNCHAKU_LORA_NODE, QWEN_IMAGE_STOCK, qwenImageDefault, qwenLoaderFor, type QwenLoader } from './graphs/stills.js';

export interface QwenModel {
  name: string;
  loader: QwenLoader;
  /** The one a take runs when it names none (OPENFIELD_QWEN_IMAGE_MODEL, else stock). */
  isDefault: boolean;
}

export interface QwenModels {
  models: QwenModel[];
  /** ComfyUI-QwenImageLoraLoader is installed: LoRAs (and Draft) work on Nunchaku models. */
  nunchakuLoras: boolean;
}

/** Qwen-Image by name; the Edit models share the family but not the job. */
const isQwenImage = (n: string) => /qwen/i.test(n) && !/edit/i.test(n);

let cache: { at: number; value: QwenModels } | null = null;

export async function listQwenModels(fresh = false): Promise<QwenModels> {
  if (!fresh && cache && Date.now() - cache.at < 30_000) return cache.value;
  const [unets, ggufs, nunchaku, stack] = await Promise.all([
    comboOptions('UNETLoader', 'unet_name'),
    comboOptions('UnetLoaderGGUF', 'unet_name'),
    comboOptions('NunchakuQwenImageDiTLoader', 'model_name'),
    comboOptions(NUNCHAKU_LORA_NODE, 'lora_name_1'),
  ]);
  const def = qwenImageDefault();
  const names = [...new Set([...unets, ...ggufs])].filter((n) => isQwenImage(n) || n === def || n === QWEN_IMAGE_STOCK);
  const models = names
    // A Nunchaku file only loads once ComfyUI-nunchaku is installed.
    .filter((n) => qwenLoaderFor(n) !== 'nunchaku' || nunchaku.includes(n))
    .map((name) => ({ name, loader: qwenLoaderFor(name), isDefault: name === def }))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
  const value = { models, nunchakuLoras: stack.length > 0 };
  cache = { at: Date.now(), value };
  return value;
}

/**
 * The model a still request names, checked against the engine's lists; '' or
 * missing means the default. Refuses LoRAs (and Draft, which is a LoRA) on a
 * Nunchaku model when the LoRA stack node is missing.
 */
export async function pickQwenModel(raw: unknown, withLoras: boolean): Promise<string | undefined> {
  if (raw == null || raw === '') return undefined;
  if (typeof raw !== 'string') throw new Error('qwenModel must be a model name');
  let list = await listQwenModels();
  if (!list.models.some((m) => m.name === raw)) list = await listQwenModels(true);
  if (!list.models.some((m) => m.name === raw)) {
    throw new Error(`The engine has no Qwen-Image model named ${raw}. Put it in ComfyUI's models/diffusion_models folder${qwenLoaderFor(raw) === 'nunchaku' ? ' and install ComfyUI-nunchaku' : ''}.`);
  }
  if (withLoras && qwenLoaderFor(raw) === 'nunchaku' && !list.nunchakuLoras) {
    throw new Error(`${raw} is a Nunchaku model: LoRAs and Draft on it need the ComfyUI-QwenImageLoraLoader node pack. Use Quality without LoRAs, or install it.`);
  }
  return raw;
}
