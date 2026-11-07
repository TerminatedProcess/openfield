/**
 * Text encoders that can be swapped for another file in models/text_encoders/
 * (an abliterated build, another quantization), one variable per encoder. The
 * value is the name exactly as ComfyUI lists it, subfolder prefix included.
 * Read when a graph is built, like the LTX-2.5 overrides in ./ltxfiles.ts and
 * OPENFIELD_H3_TEXT_ENCODER in ./h3.ts; activeBundles() in server/models.ts
 * checks for the configured file instead of the stock one.
 */

export type EncoderSlot = 'qwen' | 'flux2' | 'zimage' | 'gemma3';

export const ENCODER_STOCK: Record<EncoderSlot, string> = {
  /** Qwen2.5-VL 7B: Qwen-Image stills and the Edit model (bundles qwen, edit). */
  qwen: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
  /** Mistral 3 Small: FLUX.2 stills (bundle flux2). */
  flux2: 'mistral_3_small_flux2_fp4_mixed.safetensors',
  /** Qwen3 4B: Z-Image Turbo, the Stage look frame (bundle stage-look). */
  zimage: 'qwen_3_4b.safetensors',
  /** Gemma 3 12B: LTX-2.3 and the Director shot-list planner (bundle ltx23). */
  gemma3: 'gemma_3_12B_it_fp4_mixed.safetensors',
};

export const ENCODER_ENV: Record<EncoderSlot, string> = {
  qwen: 'OPENFIELD_QWEN_TEXT_ENCODER',
  flux2: 'OPENFIELD_FLUX2_TEXT_ENCODER',
  zimage: 'OPENFIELD_ZIMAGE_TEXT_ENCODER',
  gemma3: 'OPENFIELD_GEMMA3_TEXT_ENCODER',
};

export const ENCODER_SLOTS = Object.keys(ENCODER_STOCK) as EncoderSlot[];

/** The configured encoder for a slot, or '' when the stock one is in use. */
export function encoderOverride(slot: EncoderSlot, env: NodeJS.ProcessEnv = process.env): string {
  return (env[ENCODER_ENV[slot]] ?? '').trim();
}

/** The text encoder graphs load for a slot. */
export function textEncoder(slot: EncoderSlot, env: NodeJS.ProcessEnv = process.env): string {
  return encoderOverride(slot, env) || ENCODER_STOCK[slot];
}

/** Drop every override, so graphs use the stock encoders (workflow export, tests). */
export function clearEncoderOverrides(env: NodeJS.ProcessEnv = process.env): void {
  for (const s of ENCODER_SLOTS) delete env[ENCODER_ENV[s]];
}
