// Image metadata: what is generation data, and what a picture needs to be
// drawn. Canon, hydrated -- do not edit a delivered copy.
//
// Operator ruling 2026-11-01: metadata that identifies the IMAGE (its prompt,
// its generation settings) may stay; metadata that identifies the USER
// (location, device, system settings, timestamps) is stripped AND discarded.
// It is an allowlist: what is left of a file is what its picture needs plus
// the generation data, and anything not named here goes.
//
// TWO SURFACES APPLY THIS, AND THEY MUST AGREE:
//   - Technetium strips before upload (src/client/identityStrip.ts), because
//     Synapse keeps whatever it is handed and an encrypted room is never seen
//     by anything else. It KEEPS the generation carriers, so the tunnel still
//     has the prompt to tag from and to file privately for the creator.
//   - fourier-tunnel strips again on ingest (strip-generation.js takes the
//     generation data out, strip-identity.js keeps what the picture needs).
// If the two disagreed about what a prompt looks like, the client would
// discard a prompt the tunnel would have tagged from, or keep a field the
// tunnel then has to throw away. So the facts live once, here (D-tc01).
//
// The classifier below is lifted verbatim from fourier-tunnel
// strip-generation.js as of 09b0eb4; the keep lists from strip-identity.js.
// The tunnel's own identity-check.js deliberately keeps lists of its OWN: it
// is the judge of the stripper, and a judge that shares the stripper's lists
// shares its mistakes.
//
// Pure: no Buffer, no zlib, no DOM. Strings and plain arrays only, so both a
// browser bundle and Node's CommonJS (require of an ES module) load it.

// --- what counts as generation data -------------------------------------------

// How sure a verdict is. STRONG is a generator's own signal -- its keyword,
// its markers, its prompt syntax -- and is what earns a post the PUBLIC
// "ai-generated" tag. LOOSE is only the shape of a prompt: kept privately all
// the same, because a caption kept is recoverable and a prompt served is not,
// but it labels nothing in public.
export const NONE = 0, LOOSE = 1, STRONG = 2;

// PNG keywords that ARE generation data whatever they hold. Each is here
// because a named generator writes it, and no other software writes the name:
//   parameters            AUTOMATIC1111, Forge, SD.Next, Fooocus, SwarmUI
//   postprocessing,
//   extras                A1111's extras tab: the upscaler and its settings
//   prompt, workflow      ComfyUI (the API graph and the UI graph)
//   invokeai_metadata,
//   invokeai_graph,
//   invokeai_workflow     InvokeAI 3 and later
//   sd-metadata, Dream    InvokeAI 2
//   fooocus_scheme        Fooocus
//   parameters-json,
//   smproj                Stability Matrix
//   the rest              Easy Diffusion, which writes ONE CHUNK PER SETTING
export const PNG_EASYDIFFUSION_KEYS = [
  "negative_prompt", "use_stable_diffusion_model", "use_vae_model", "use_text_encoder_model",
  "use_lora_model", "lora_alpha", "use_hypernetwork_model", "hypernetwork_strength",
  "use_embedding_models", "use_embeddings_model", "use_controlnet_model", "control_filter_to_apply",
  "control_alpha", "use_face_correction", "use_upscale", "upscale_amount", "latent_upscaler_steps",
  "num_inference_steps", "guidance_scale", "distilled_guidance_scale", "prompt_strength",
  "sampler_name", "scheduler_name", "clip_skip",
];
export const PNG_GENERATOR_KEYS = new Set([
  "parameters", "postprocessing", "extras",
  "prompt", "workflow",
  "invokeai_metadata", "invokeai_graph", "invokeai_workflow",
  "sd-metadata", "Dream", "fooocus_scheme",
  "parameters-json", "smproj",
  ...PNG_EASYDIFFUSION_KEYS,
]);

// A keyword that NAMES generation content ("sd_prompt", "Workflow",
// "parameters_v2"). On its own it is a name, not a generator's signature, so
// it is LOOSE.
export const PNG_GENERATION_NAME = /prompt|workflow|parameters/i;

// Easy Diffusion's settings whose names are ordinary words: generation data
// in an Easy Diffusion file, which is known by the keys above.
export const PNG_EASYDIFFUSION_CONTEXT_KEYS = new Set(["seed", "width", "height", "tiling"]);

// Keywords ordinary software writes too (GIMP's "Comment", a screenshot
// tool's "Description"): generation data only when they hold a prompt, or
// when the file is NovelAI's.
export const PNG_SHARED_KEYS = new Set(["Comment", "Description"]);

// NovelAI's model name + hash and its timing: generation data in a NovelAI
// file. "Title" and "Software" name the tool, not the generation.
export const PNG_NOVELAI_KEYS = new Set(["Source", "Generation time"]);

// "Raw profile type <kind>": a whole metadata block, hex-encoded, in a PNG
// text chunk. It carries the GPS and the camera with whatever prompt it holds.
export const RAW_PROFILE = /^Raw profile type (exif|app1|xmp|iptc|8bim)$/i;

// JSON keys only a generator's metadata carries.
export const JSON_GENERATION_KEY =
  /"(?:prompt|positive_prompt|negative_prompt|uc|workflow|sui_image_params|class_type|widgets_values|generation_mode|sampler_name|cfg_scale|noise_schedule|invokeai_metadata|PositivePrompt|NegativePrompt|CfgScale)"\s*:/;

/**
 * STRONG markers: text no ordinary tool writes.
 * @param {unknown} text
 * @returns {boolean}
 */
export function hasGenerationMarkers(text) {
  if (typeof text !== "string" || !text) return false;
  if (/(?:^|\n)\s*Negative prompt:/.test(text)) return true;                       // A1111
  if (/\bSteps:\s*\d+\s*,/.test(text) && /\b(?:Sampler|CFG scale|Seed|Model hash|Size):\s*\S/.test(text)) return true;
  if (JSON_GENERATION_KEY.test(text)) return true;
  if (/\bJob ID:\s*[0-9a-f]{8}-[0-9a-f]{4}-/i.test(text)) return true;            // Midjourney
  if (/<(?:lora|lyco|hypernet|embedding):[^<>]+>/i.test(text)) return true;         // A1111 network syntax
  if (/(?:^|\n)\s*(?:Include in Image|Exclude from Image):/.test(text)) return true; // Mochi Diffusion
  return false;
}

/**
 * A BARE PROMPT, for the fields read AS a prompt (EXIF UserComment /
 * ImageDescription / XPComment, a PNG Comment or Description, a GIF comment):
 * STRONG for the markers, a decimal A1111 weight or the booru-tag words no
 * caption is written in; LOOSE for a comma-separated list of short terms or
 * the quality words, which are ordinary English.
 * @param {unknown} text
 * @returns {number}
 */
export function promptStrength(text) {
  if (typeof text !== "string") return NONE;
  const t = text.trim();
  if (!t) return NONE;
  if (hasGenerationMarkers(t)) return STRONG;
  if (/\([^()]{1,80}:\s*-?\d*\.\d+\s*\)/.test(t)) return STRONG;                   // (tag:1.2)
  if (/\b(?:1girl|1boy|absurdres)\b/i.test(t)) return STRONG;
  if (/\b(?:masterpiece|best[ _]quality)\b/i.test(t)) return LOOSE;
  if (/\([^()]{1,80}:\s*-?\d+\s*\)/.test(t)) return LOOSE;                          // (tag:2)
  const terms = t.split(",").map((s) => s.trim()).filter(Boolean);
  if (terms.length >= 4 && terms.every((s) => s.length <= 64 && s.split(/\s+/).length <= 6)) return LOOSE;
  return NONE;
}

/**
 * ImageMagick mirrors EXIF values into PNG text chunks named exif:<Tag>, and
 * renders a byte it cannot print as '.': a UNICODE UserComment arrives as
 * "UNICODE..m.a.s.t.e.r". This reads it back as the text it was.
 * @param {string} text
 * @returns {string}
 */
export function demirror(text) {
  let t = String(text).replace(/^(?:UNICODE|ASCII|JIS)[.\0]{0,3}/, "");
  if (t.length >= 4) {
    for (const parity of [0, 1]) {
      let dots = 0, total = 0;
      for (let k = parity; k < t.length; k += 2) { total++; if (t[k] === "." || t[k] === "\0") dots++; }
      if (dots / total >= 0.9) {
        let out = "";
        for (let k = 1 - parity; k < t.length; k += 2) out += t[k];
        t = out;
        break;
      }
    }
  }
  return t.replace(/\0+$/, "");
}

// The EXIF fields a generator writes its prompt into.
export const EXIF_PROMPT_FIELDS = new Set(["UserComment", "ImageDescription", "XPComment"]);

/**
 * The mirror of an EXIF field is judged the way the field itself is.
 * @param {string} keyword "exif:<Tag>"
 * @param {string} text
 * @returns {number}
 */
export function exifMirrorStrength(keyword, text) {
  const t = demirror(text);
  if (EXIF_PROMPT_FIELDS.has(keyword.slice(5))) return promptStrength(t);
  return hasGenerationMarkers(t) ? STRONG : NONE;
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function isJsonStructure(text) {
  const t = text.trim();
  if (!/^[[{]/.test(t)) return false;
  try { JSON.parse(t); return true; } catch { return false; }
}

/**
 * @param {string | undefined} software
 * @param {string | undefined} source
 * @returns {boolean}
 */
export function isNovelAI(software, source) {
  return /novelai/i.test(software || "") || /novelai/i.test(source || "");
}

/**
 * @typedef {{ novelai: boolean, easyDiffusion: boolean, comfyUI: boolean }} PngContext
 * @typedef {{ keyword: string, text: string | null }} PngText
 */

/**
 * What kind of file a PNG's text chunks say it is: the context its shared
 * keywords are judged in.
 * @param {PngText[]} texts
 * @returns {PngContext}
 */
export function pngContext(texts) {
  /** @param {string} k */
  const first = (k) => { const t = texts.find((x) => x.keyword === k && typeof x.text === "string"); return t && t.text ? t.text : ""; };
  return {
    novelai: isNovelAI(first("Software"), first("Source")),
    easyDiffusion: texts.some((t) => PNG_EASYDIFFUSION_KEYS.includes(t.keyword)),
    comfyUI: ["prompt", "workflow"].some((k) => /"class_type"|"nodes"\s*:/.test(first(k))),
  };
}

/**
 * How much of this PNG text chunk is generation data. `text` is null when the
 * chunk could not be decoded; a generator's own keyword counts regardless.
 * @param {string} keyword
 * @param {string | null} text
 * @param {PngContext} ctx
 * @returns {number}
 */
export function pngStrength(keyword, text, ctx) {
  if (PNG_GENERATOR_KEYS.has(keyword)) return STRONG;
  if (ctx.easyDiffusion && PNG_EASYDIFFUSION_CONTEXT_KEYS.has(keyword)) return STRONG;
  if (typeof text !== "string") return NONE;
  if (ctx.novelai && (PNG_SHARED_KEYS.has(keyword) || PNG_NOVELAI_KEYS.has(keyword))) return STRONG;
  if (PNG_SHARED_KEYS.has(keyword)) return promptStrength(text);
  if (keyword.startsWith("exif:")) return exifMirrorStrength(keyword, text);
  if (hasGenerationMarkers(text)) return STRONG;
  // ComfyUI's SaveImage writes every extra_pnginfo entry as a chunk of its
  // own, JSON-encoded; in a ComfyUI file a chunk of JSON is one of those.
  if (ctx.comfyUI && isJsonStructure(text)) return STRONG;
  return PNG_GENERATION_NAME.test(keyword) && text.trim() ? LOOSE : NONE;
}

/**
 * An EXIF UserComment as text: its 8-byte charset prefix read, UTF-16 in
 * whichever byte order yields more printable ASCII.
 * @param {Uint8Array} raw
 * @returns {string}
 */
export function decodeUserComment(raw) {
  const utf8 = (/** @type {Uint8Array} */ b) => new TextDecoder("utf-8").decode(b).replace(/\0+$/, "");
  if (raw.length < 8) return utf8(raw);
  const prefix = String.fromCharCode(...raw.subarray(0, 8));
  const body = raw.subarray(8);
  if (prefix === "UNICODE\0") {
    const even = body.subarray(0, body.length - (body.length % 2));
    const le = new TextDecoder("utf-16le").decode(even);
    const be = new TextDecoder("utf-16be").decode(even);
    const ascii = (/** @type {string} */ t) => (t.match(/[\x20-\x7e]/g) || []).length;
    return (ascii(be) >= ascii(le) ? be : le).replace(/\0+$/, "");
  }
  if (prefix === "JIS\0\0\0\0\0") return new TextDecoder("latin1").decode(body);
  if (prefix === "ASCII\0\0\0" || prefix === "\0\0\0\0\0\0\0\0") return utf8(body);
  return utf8(raw);
}

// --- what a picture needs to be drawn -----------------------------------------

// PNG: the image (IHDR PLTE IDAT IEND, APNG's acTL fcTL fdAT) and its colour
// and transparency. eXIf is rebuilt, never kept whole.
export const PNG_KEEP = new Set([
  "IHDR", "PLTE", "IDAT", "IEND", "acTL", "fcTL", "fdAT",
  "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "cICP", "mDCV", "cLLI", "sBIT", "bKGD", "hIST",
]);

// JPEG: the codec's own markers -- frames, tables, restart interval, scans.
export const JPEG_CODEC = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  0xc4, 0xcc, 0xdb, 0xdd, 0xdc, 0xde, 0xdf, 0xda,
]);
// What a dropped APPn segment was, by its identifier, for the log. Only names
// from this table are logged, so nothing a segment holds reaches a log.
export const JPEG_APP_NAMES = [
  ["http://ns.adobe.com/xap/1.0/\0", "XMP"],
  ["http://ns.adobe.com/xmp/extension/\0", "XMP extension"],
  ["Photoshop 3.0\0", "Photoshop resources"],
  ["MPF\0", "MPF"],
  ["JFXX\0", "JFIF thumbnail"],
  ["Exif\0", "Exif"],
  ["JP", "JUMBF"],
  ["Ducky", "Ducky"],
  ["FPXR\0", "FlashPix"],
];

// WebP: the bitstreams and alpha (also inside an animation frame); ANIM and
// one ICCP in an extended file. EXIF is rebuilt.
export const WEBP_IMAGE = new Set(["VP8 ", "VP8L", "ALPH"]);

// GIF application extensions a decoder acts on: the loop count (Netscape's
// and its clone), and an ICC profile.
export const GIF_APPS = new Set(["NETSCAPE2.0", "ANIMEXTS1.0", "ICCRGBG1012"]);
export const GIF_APP_NAMES = new Map([
  ["XMP DataXMP", "XMP"], ["ImageMagick", "ImageMagick"], ["MGK8BIM0000", "Photoshop resources"], ["MGKIPTC0000", "IPTC"],
]);

// AVIF (ISO base media): boxes holding only boxes, and how many bytes of their
// own come first (iinf's depends on its version).
export const ISO_CONTAINERS = new Map([
  ["meta", 4], ["iinf", -1], ["iprp", 0], ["ipco", 0], ["moov", 0], ["trak", 0], ["mdia", 0],
  ["minf", 0], ["stbl", 0], ["dinf", 0], ["edts", 0], ["stsd", 8],
  ["av01", 78], ["hvc1", 78], ["hev1", 78], ["avc1", 78],
]);
// Boxes whose contents describe how to decode, lay out or colour the picture.
export const ISO_LEAVES = new Set([
  "ftyp", "mdat", "free", "skip", "hdlr", "pitm", "iloc", "ipma", "idat", "iref", "grpl",
  "ispe", "pixi", "av1C", "hvcC", "avcC", "colr", "pasp", "irot", "imir", "clap", "auxC", "auxi", "lsel",
  "a1op", "a1lx", "clli", "mdcv", "cclv", "amve", "rloc", "ccst", "btrt", "tref",
  "elst", "vmhd", "stts", "stss", "stsc", "stsz", "stz2", "stco", "co64", "ctts", "sdtp", "sgpd", "sbgp",
]);
// Movie, track and media headers: kept, with their creation and modification
// times zeroed.
export const ISO_TIMED = new Set(["mvhd", "tkhd", "mdhd"]);
// Items that are pictures. Exif, XMP ("mime"), URIs and anything else go.
export const ISO_ITEM_TYPES = new Set(["av01", "hvc1", "hvt1", "avc1", "grid", "iovl", "iden", "tmap", "jpeg", "unci", "j2k1"]);
// Item names an encoder gives. Any other name is blanked.
export const ISO_ITEM_NAMES = new Set(["", "Color", "Alpha", "Grid", "GMap", "Tmap", "Depth"]);
// ftyp brands of HEIF that is not AVIF: an iPhone's HEIC. Browsers other than
// Safari cannot draw it, so it is refused rather than stripped.
export const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs"]);
export const AVIF_BRANDS = new Set(["avif", "avis"]);
