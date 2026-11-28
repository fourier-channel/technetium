import type { ProvenanceMap } from './provenanceMode'

// The key -> rows map provenance mode reads (spec sec 4-5: bundled at build
// time, deploy-fresh). Its source is the roadmap exporter, canon fourier-basis
// tools/status-export.py, which does not write it yet: until it does, this is
// empty and every box says plainly that nothing is recorded, rather than a
// second hand-kept copy of decisions the rows already hold (one fact, one
// place).
export const PROVENANCE_MAP: ProvenanceMap = Object.freeze({})
