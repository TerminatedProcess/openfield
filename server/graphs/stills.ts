/**
 * Stills graph builders — two models, each with a DRAFT and QUALITY mode.
 *
 *  qwen  — Qwen-Image fp8. DRAFT = Lightning 8-step LoRA (fast, softer);
 *          QUALITY = no LoRA, 50 steps, CFG 2.5 (the model's real output).
 *          QUALITY is also the only mode where `negative` does anything, since
 *          a negative prompt needs CFG > 1 to have any effect.
 *  flux2 — FLUX.2 dev fp8mixed, the open-weights photorealism lead.
 *          DRAFT = Turbo LoRA @ 8 steps; QUALITY = 20 steps, FluxGuidance 4.
 *          Graph shape from the official image_flux2_fp8 template.
 *          Reference images (cast pictures or your own) go in as
 *          ReferenceLatents, the FLUX.2 multi-reference recipe: identity and
 *          wardrobe carry over while the frame, light and skin stay photographic.
 *
 * Your own LoRAs chain after the model (and after the draft distill).
 */

import { textEncoder } from './encoders.js';

/** The Qwen-Image diffusion model the qwen bundle ships. */
export const QWEN_IMAGE_STOCK = 'qwen_image_fp8_e4m3fn.safetensors';
/**
 * The default Qwen-Image diffusion model when a take names none: another file in
 * models/diffusion_models/ (a fine-tune, another quantization), named as
 * ComfyUI lists it. Checked for, never downloaded.
 */
export const QWEN_IMAGE_ENV = 'OPENFIELD_QWEN_IMAGE_MODEL';

/** The configured Qwen-Image model, or '' when the stock one is in use. */
export function qwenImageOverride(env: NodeJS.ProcessEnv = process.env): string {
  return (env[QWEN_IMAGE_ENV] ?? '').trim();
}

/** The Qwen-Image model a take runs when it names none. */
export function qwenImageDefault(env: NodeJS.ProcessEnv = process.env): string {
  return qwenImageOverride(env) || QWEN_IMAGE_STOCK;
}

/**
 * How a Qwen-Image file loads, from its name: .gguf through ComfyUI-GGUF,
 * Nunchaku (SVDQuant) through ComfyUI-nunchaku, anything else through UNETLoader.
 * Nunchaku's loader lists every diffusion model, so the name is the only signal.
 */
export type QwenLoader = 'unet' | 'gguf' | 'nunchaku';
export function qwenLoaderFor(name: string): QwenLoader {
  if (/\.gguf$/i.test(name)) return 'gguf';
  if (/nunchaku|svdq/i.test(name)) return 'nunchaku';
  return 'unet';
}

/** Node classes each loader needs; LoRAs on a Nunchaku model need ComfyUI-QwenImageLoraLoader too. */
export const QWEN_LOADER_NODE: Record<QwenLoader, string> = {
  unet: 'UNETLoader', gguf: 'UnetLoaderGGUF', nunchaku: 'NunchakuQwenImageDiTLoader',
};
export const NUNCHAKU_LORA_NODE = 'NunchakuQwenImageLoraStackV3';

function qwenImageLoader(name: string): Record<string, unknown> {
  switch (qwenLoaderFor(name)) {
    case 'gguf': return { class_type: 'UnetLoaderGGUF', inputs: { unet_name: name } };
    // cpu_offload auto: on below 15 GB of VRAM.
    case 'nunchaku': return { class_type: 'NunchakuQwenImageDiTLoader', inputs: { model_name: name, cpu_offload: 'auto', num_blocks_on_gpu: 1, use_pin_memory: 'disable' } };
    default: return { class_type: 'UNETLoader', inputs: { unet_name: name, weight_dtype: 'default' } };
  }
}

export interface StillsParams {
  model: 'qwen' | 'flux2';
  quality: 'draft' | 'quality';
  prompt: string;
  width: number;
  height: number;
  seed: number;
  /**
   * Things to keep OUT of the image. This is the only place exclusions work:
   * Qwen draws whatever you negate in the POSITIVE prompt ("no rope" renders a
   * rope), because the encoder embeds the noun and the sampler renders it. Only
   * effective in QUALITY mode, which runs CFG 2.5; DRAFT is CFG 1.0 and ignores
   * the negative entirely.
   */
  negative?: string;
  /** Your own LoRAs (server/loras.ts checked the family), applied in order. */
  loras?: { name: string; strength: number }[];
  /** FLUX.2 only: reference pictures, input tokens, each a ReferenceLatent. */
  refImages?: string[];
  /** Qwen only: the diffusion model, as ComfyUI lists it. Default: qwenImageDefault(). */
  qwenModel?: string;
}

/** Chain LoraLoaderModelOnly nodes after `from`; returns the last model output. */
function chainLoras(g: Record<string, unknown>, from: [string, number], loras: StillsParams['loras']): [string, number] {
  let model = from;
  (loras ?? []).forEach((l, i) => {
    g[`ulora${i}`] = { class_type: 'LoraLoaderModelOnly', inputs: { model, lora_name: l.name, strength_model: l.strength } };
    model = [`ulora${i}`, 0];
  });
  return model;
}

const QWEN_LIGHTNING = 'Qwen-Image-Lightning-8steps-V1.0.safetensors';

function qwenGraph(p: StillsParams): Record<string, unknown> {
  const draft = p.quality === 'draft';
  const name = p.qwenModel || qwenImageDefault();
  const nunchaku = qwenLoaderFor(name) === 'nunchaku';
  const g0: Record<string, unknown> = {};
  // A Nunchaku model takes LoRAs only through one stack node (the draft distill first).
  const stack = [...(draft ? [{ name: QWEN_LIGHTNING, strength: 1 }] : []), ...(p.loras ?? [])];
  const model: [string, number] = nunchaku
    ? (stack.length ? ['lora', 0] : ['u', 0])
    : chainLoras(g0, [draft ? 'lora' : 'u', 0], p.loras);
  const g: Record<string, unknown> = {
    u: qwenImageLoader(name),
    c: { class_type: 'CLIPLoader', inputs: { clip_name: textEncoder('qwen'), type: 'qwen_image', device: 'default' } },
    v: { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_vae.safetensors' } },
    pos: { class_type: 'CLIPTextEncode', inputs: { clip: ['c', 0], text: p.prompt } },
    neg: { class_type: 'CLIPTextEncode', inputs: { clip: ['c', 0], text: p.negative ?? '' } },
    lat: { class_type: 'EmptySD3LatentImage', inputs: { width: p.width, height: p.height, batch_size: 1 } },
    k: {
      class_type: 'KSampler',
      inputs: {
        model, positive: ['pos', 0], negative: ['neg', 0], latent_image: ['lat', 0],
        seed: p.seed,
        steps: draft ? 8 : 50,
        cfg: draft ? 1.0 : 2.5,
        sampler_name: 'euler', scheduler: 'simple', denoise: 1.0,
      },
    },
    d: { class_type: 'VAEDecode', inputs: { samples: ['k', 0], vae: ['v', 0] } },
    save: { class_type: 'SaveImage', inputs: { images: ['d', 0], filename_prefix: 'OpenField_still' } },
  };
  if (nunchaku && stack.length) {
    const inputs: Record<string, unknown> = { model: ['u', 0], lora_count: stack.length, cpu_offload: 'auto', toggle_all: true };
    stack.forEach((l, i) => Object.assign(inputs, { [`enabled_${i + 1}`]: true, [`lora_name_${i + 1}`]: l.name, [`lora_strength_${i + 1}`]: l.strength }));
    g.lora = { class_type: NUNCHAKU_LORA_NODE, inputs };
  } else if (draft) {
    g.lora = {
      class_type: 'LoraLoaderModelOnly',
      inputs: { model: ['u', 0], lora_name: QWEN_LIGHTNING, strength_model: 1.0 },
    };
  }
  return { ...g, ...g0 };
}

function flux2Graph(p: StillsParams): Record<string, unknown> {
  const draft = p.quality === 'draft';
  const steps = draft ? 8 : 20;
  const g0: Record<string, unknown> = {};
  const model = chainLoras(g0, [draft ? 'lora' : 'u', 0], p.loras);
  let cond: [string, number] = ['pos', 0];
  (p.refImages ?? []).forEach((image, i) => {
    Object.assign(g0, {
      [`ri${i}`]: { class_type: 'LoadImage', inputs: { image } },
      [`rs${i}`]: { class_type: 'ImageScaleToTotalPixels', inputs: { image: [`ri${i}`, 0], upscale_method: 'lanczos', megapixels: 1.0, resolution_steps: 16 } },
      [`re${i}`]: { class_type: 'VAEEncode', inputs: { pixels: [`rs${i}`, 0], vae: ['v', 0] } },
      [`rl${i}`]: { class_type: 'ReferenceLatent', inputs: { conditioning: cond, latent: [`re${i}`, 0] } },
    });
    cond = [`rl${i}`, 0];
  });
  const g: Record<string, unknown> = {
    u: { class_type: 'UNETLoader', inputs: { unet_name: 'flux2_dev_fp8mixed.safetensors', weight_dtype: 'default' } },
    c: { class_type: 'CLIPLoader', inputs: { clip_name: textEncoder('flux2'), type: 'flux2', device: 'default' } },
    v: { class_type: 'VAELoader', inputs: { vae_name: 'flux2-vae.safetensors' } },
    pos: { class_type: 'CLIPTextEncode', inputs: { clip: ['c', 0], text: p.prompt } },
    fg: { class_type: 'FluxGuidance', inputs: { conditioning: cond, guidance: 4 } },
    guider: { class_type: 'BasicGuider', inputs: { model, conditioning: ['fg', 0] } },
    sched: { class_type: 'Flux2Scheduler', inputs: { steps, width: p.width, height: p.height } },
    sampler: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    noise: { class_type: 'RandomNoise', inputs: { noise_seed: p.seed } },
    lat: { class_type: 'EmptyFlux2LatentImage', inputs: { width: p.width, height: p.height, batch_size: 1 } },
    sca: {
      class_type: 'SamplerCustomAdvanced',
      inputs: { noise: ['noise', 0], guider: ['guider', 0], sampler: ['sampler', 0], sigmas: ['sched', 0], latent_image: ['lat', 0] },
    },
    d: { class_type: 'VAEDecode', inputs: { samples: ['sca', 0], vae: ['v', 0] } },
    save: { class_type: 'SaveImage', inputs: { images: ['d', 0], filename_prefix: 'OpenField_still' } },
  };
  if (draft) {
    g.lora = {
      class_type: 'LoraLoaderModelOnly',
      inputs: { model: ['u', 0], lora_name: 'Flux2TurboComfyv2.safetensors', strength_model: 1.0 },
    };
  }
  return { ...g, ...g0 };
}

export function buildStillsGraph(p: StillsParams): Record<string, unknown> {
  return p.model === 'flux2' ? flux2Graph(p) : qwenGraph(p);
}
