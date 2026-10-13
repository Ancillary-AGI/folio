/**
 * EAGLE schematic interchange (XML `.sch` nets/part/net segment subset).
 *
 * EAGLE stores a schematic as XML: `drawing/schematic/sheets/sheet` holds
 * `parts` (name/value/package) and `nets` (name → segment → pinref part/pin).
 * This module reads that subset into the same `{ components, nets }` shape as
 * the KiCad interchange, so one bridge serves both flows. No binary, no GUI
 * layout — fail-loud on malformed XML, part-less pinrefs, and empty sheets.
 */

export interface EagleNetlist {
  components: Array<{ ref: string; value: string; footprint: string }>;
  nets: Array<{ code: string; name: string; nodes: Array<{ ref: string; pin: string }> }>;
}

const attr = (tag: string, name: string): string | undefined => {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`));
  return match ? match[1] : undefined;
};

/** Parse an EAGLE `.sch` string into components + nets. */
export function parseEagleSchematic(text: string): EagleNetlist {
  if (!/<\s*eagle\b/i.test(text)) throw new Error('EAGLE: root must be an <eagle> document.');
  const sheetMatch = text.match(/<\s*sheet\b[^>]*>([\s\S]*?)<\s*\/\s*sheet\s*>/i);
  if (!sheetMatch) throw new Error('EAGLE: no <sheet> found.');
  const sheet = sheetMatch[1];
  const components: EagleNetlist['components'] = [];
  const partsMatch = sheet.match(/<\s*parts\b[^>]*>([\s\S]*?)<\s*\/\s*parts\s*>/i);
  const partsBlock = partsMatch ? partsMatch[1] : '';
  const partTags = partsBlock.match(/<\s*part\b[^>]*\/?>/gi) ?? [];
  const partNames = new Set<string>();
  for (const tag of partTags) {
    const ref = attr(tag, 'name');
    if (!ref) throw new Error('EAGLE: <part> without name.');
    partNames.add(ref);
    components.push({ ref, value: attr(tag, 'value') ?? '', footprint: attr(tag, 'package') ?? '' });
  }
  const nets: EagleNetlist['nets'] = [];
  const netsMatch = sheet.match(/<\s*nets\b[^>]*>([\s\S]*?)<\s*\/\s*nets\s*>/i);
  const netsBlock = netsMatch ? netsMatch[1] : '';
  const netBlocks = [...netsBlock.matchAll(/<\s*net\b([^>]*)>([\s\S]*?)<\s*\/\s*net\s*>/gi)];
  let code = 1;
  for (const block of netBlocks) {
    const header = block[0].split('>')[0] + '>';
    const netName = attr(header, 'name') ?? '';
    const nodes: Array<{ ref: string; pin: string }> = [];
    const pinrefs = block[2].match(/<\s*pinref\b[^>]*\/?>/gi) ?? [];
    for (const pinref of pinrefs) {
      const ref = attr(pinref, 'part');
      const pin = attr(pinref, 'pin');
      if (!ref || !pin) throw new Error(`EAGLE: net ${netName} has a pinref without part/pin.`);
      if (!partNames.has(ref)) throw new Error(`EAGLE: net ${netName} references unknown part ${ref}.`);
      nodes.push({ ref, pin });
    }
    nets.push({ code: String(code), name: netName, nodes });
    code += 1;
  }
  if (components.length === 0 && nets.length === 0) {
    throw new Error('EAGLE: sheet has no parts or nets.');
  }
  return { components, nets };
}
