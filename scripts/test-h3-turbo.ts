/**
 * H3 turbo presets, no GPU or engine needed: `npm run test:h3-turbo`.
 *
 * The page's list (src/presets.ts) and the server's (server/graphs/h3.ts) must
 * name the same presets and files; the Video page offers only what ComfyUI
 * lists; the server refuses an unknown preset or a missing LoRA in words.
 */
import assert from 'assert/strict';
import { H3_REF_TURBO_FILE, H3_TURBO, H3_TURBO_FILES, H3_TURBO_UNETS, availableH3Turbo } from '../src/presets.js';
import { H3_MODELS, H3_REF_TURBO_LORA, H3_TEXT_ENCODER_ENV, H3_TURBO_PRESETS, buildH3Graph, h3TextEncoder, turboProblem } from '../server/graphs/h3.js';
import { BUNDLES, activeBundles } from '../server/models.js';
import { estimate, type EstimateTake } from '../server/estimate.js';

let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok    ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name}\n        ${e instanceof Error ? e.message : e}`);
  }
}

const V11 = H3_TURBO_FILES['v11-4'];
const FASTH3V2 = H3_TURBO_UNETS['fasth3v2-8'];

check('page and server name the same presets, files and steps', () => {
  assert.deepEqual(H3_TURBO.map((t) => t.key), H3_TURBO_PRESETS.map((p) => p.id));
  for (const p of H3_TURBO_PRESETS) {
    assert.equal(H3_TURBO_FILES[p.id], p.fl2vaLora, p.id);
    assert.equal(H3_TURBO_UNETS[p.id], p.unet, p.id);
    assert.ok(!!p.fl2vaLora !== !!p.unet, `${p.id}: exactly one of fl2vaLora / unet`);
    assert.equal(H3_TURBO.find((t) => t.key === p.id)?.steps, p.steps, p.id);
  }
  assert.equal(H3_REF_TURBO_FILE, H3_REF_TURBO_LORA);
});

check('the page offers only the presets whose LoRA ComfyUI lists, under that exact name', () => {
  assert.deepEqual(availableH3Turbo([]), []);
  assert.deepEqual(availableH3Turbo(['other.safetensors', V11]).map((t) => t.key), ['v11-4']);
  assert.deepEqual(availableH3Turbo([`sub\\${V11}`]), [], 'a file in a subfolder is another name to ComfyUI');
  assert.deepEqual(availableH3Turbo([], [FASTH3V2]).map((t) => t.key), ['fasth3v2-8'], 'a whole-model preset is found among the diffusion models');
  assert.deepEqual(availableH3Turbo([FASTH3V2]), [], 'not among the LoRAs');
});

check('the server lets a listed preset run, and refuses a missing LoRA or an unknown id in words', () => {
  const have = (loras: string[], unets: string[] = []) => ({ loras: new Set(loras), unets: new Set(unets) });
  assert.equal(turboProblem('v11-4', false, have([V11])), null);
  assert.match(turboProblem('v10-8', false, have([V11]))!, /needs minimax_h3_fl2v_turbo_8step.*models\/loras.*h3-turbo/);
  assert.match(turboProblem('v11-4', true, have([V11]))!, /ref2v/, 'Refs mode needs the ref2v distill');
  assert.match(turboProblem('warp-9', false, have([V11]))!, /Unknown H3 turbo preset "warp-9"/);
  assert.match(turboProblem('fasth3-6', false, have([V11]))!, /does not download this one/, 'no bundle has the FastH3 file');
  assert.equal(turboProblem('fasth3v2-8', false, have([], [FASTH3V2])), null);
  assert.match(turboProblem('fasth3v2-8', false, have([V11]))!, /needs fastvideo_fasth3_8step_v2.*models\/diffusion_models/);
  assert.match(turboProblem('fasth3v2-8', true, have([], [FASTH3V2]))!, /ref2v/, 'Refs mode falls back to the ref2v distill');
});

check('the estimate keeps H3 turbo and full sampling apart, and LTX-2.5 as it was', () => {
  const take = (settings: Record<string, unknown>, render_seconds: number): EstimateTake =>
    ({ kind: 'video', status: 'done', render_seconds, settings: JSON.stringify({ width: 896, height: 512, seconds: 5, ...settings }) });
  const list = [
    take({ videoModel: 'h3' }, 1116), take({ videoModel: 'h3' }, 1100),
    take({ videoModel: 'h3', h3Turbo: 'v11-4' }, 247), take({ videoModel: 'h3', h3Turbo: 'v11-4' }, 250),
    take({ videoModel: 'ltx25' }, 90),
  ];
  const q = { kind: 'video', model: 'h3', w: '896', h: '512', seconds: '5' };
  assert.deepEqual(estimate({ ...q, turbo: 'v11-4' }, list), { seconds: 250, samples: 2 });
  assert.deepEqual(estimate({ ...q, turbo: 'none' }, list), { seconds: 1116, samples: 2 });
  assert.deepEqual(estimate({ ...q, turbo: 'v10-8' }, list), { seconds: null, samples: 0 });
  assert.deepEqual(estimate({ ...q, model: 'ltx25' }, list), { seconds: 90, samples: 1 });
});

check('a turbo graph loads its LoRA and runs its steps', () => {
  const g = buildH3Graph({ prompt: 'p', width: 832, height: 480, lengthFrames: 124, seed: 1, steps: 20, startImage: 's.png', turbo: 'v11-4' }) as Record<string, { inputs: Record<string, unknown> }>;
  const json = JSON.stringify(g);
  assert.ok(json.includes(V11));
  assert.equal(g.sched.inputs.steps, 4);
});

check('FastH3 V2 swaps the model, runs 8 steps at shift 10/3, and keeps a hand-picked LoRA', () => {
  type G = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
  const args = { prompt: 'p', width: 832, height: 480, lengthFrames: 124, seed: 1, steps: 20, startImage: 's.png', turbo: 'fasth3v2-8' };
  const g = buildH3Graph(args) as G;
  assert.equal(g.u.inputs.unet_name, FASTH3V2);
  assert.equal(g.sched.inputs.steps, 8);
  assert.equal(g.sched.inputs.scheduler, 'simple');
  assert.equal(g.sampler.inputs.sampler_name, 'res_multistep');
  assert.deepEqual([g.shift.inputs.shift_video, g.shift.inputs.shift_audio], [10, 3]);
  assert.deepEqual(g.shift.inputs.model, ['u', 0]);
  assert.equal(g.lora, undefined, 'no distill LoRA');
  const withMine = buildH3Graph({ ...args, extraLora: 'mine.safetensors', extraLoraStrength: 0.7 }) as G;
  assert.equal(withMine.u.inputs.unet_name, FASTH3V2);
  assert.equal(withMine.lora.inputs.lora_name, 'mine.safetensors');
  assert.equal(withMine.lora.inputs.strength_model, 0.7);
  assert.deepEqual(withMine.shift.inputs.model, ['lora', 0], 'the shift reads the LoRA-patched model');
  // A distill preset still wins over a hand-picked LoRA, as before.
  const distilled = buildH3Graph({ ...args, turbo: 'v11-4', extraLora: 'mine.safetensors' }) as G;
  assert.equal(distilled.lora.inputs.lora_name, V11);
});

const CUSTOM_ENCODER = 'h3\\qwen3vl_32b_heretic_minimax_h3_nvfp4.safetensors';
const encoderOf = (g: Record<string, unknown>) => (g as Record<string, { inputs: Record<string, unknown> }>).c.inputs.clip_name;
const graphArgs = { prompt: 'p', width: 832, height: 480, lengthFrames: 124, seed: 1, steps: 20, startImage: 's.png' };

check('the text encoder is stock unless OPENFIELD_H3_TEXT_ENCODER names another', () => {
  assert.equal(h3TextEncoder({}), H3_MODELS.clip);
  assert.equal(h3TextEncoder({ [H3_TEXT_ENCODER_ENV]: '  ' }), H3_MODELS.clip);
  assert.equal(h3TextEncoder({ [H3_TEXT_ENCODER_ENV]: ` ${CUSTOM_ENCODER} ` }), CUSTOM_ENCODER);
});

check('an H3 graph loads the configured encoder, in both modes', () => {
  const saved = process.env[H3_TEXT_ENCODER_ENV];
  try {
    delete process.env[H3_TEXT_ENCODER_ENV];
    assert.equal(encoderOf(buildH3Graph(graphArgs)), H3_MODELS.clip);
    process.env[H3_TEXT_ENCODER_ENV] = CUSTOM_ENCODER;
    assert.equal(encoderOf(buildH3Graph(graphArgs)), CUSTOM_ENCODER);
    assert.equal(encoderOf(buildH3Graph({ ...graphArgs, startImage: undefined, refImages: ['r.png'] })), CUSTOM_ENCODER);
  } finally {
    if (saved === undefined) delete process.env[H3_TEXT_ENCODER_ENV];
    else process.env[H3_TEXT_ENCODER_ENV] = saved;
  }
});

check('activeBundles() checks for the configured encoder and never offers it for download', () => {
  assert.equal(activeBundles({}), BUNDLES);
  const h3 = activeBundles({ [H3_TEXT_ENCODER_ENV]: CUSTOM_ENCODER }).find((b) => b.id === 'h3')!;
  const enc = h3.files.find((f) => f.dir === 'text_encoders')!;
  assert.equal(enc.file, CUSTOM_ENCODER);
  assert.equal(enc.override, H3_TEXT_ENCODER_ENV);
  assert.equal(enc.gb, 0);
  assert.ok(!h3.files.some((f) => f.file === H3_MODELS.clip));
  // The manifest itself (and docs/MODELS.md, generated from it) keeps the stock file.
  assert.ok(BUNDLES.find((b) => b.id === 'h3')!.files.some((f) => f.file === H3_MODELS.clip));
});

console.log(failed ? `\n${failed} failed` : '\nall passed');
if (failed) process.exit(1);
