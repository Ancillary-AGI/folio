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

const decodeXmlEntities = (value: string): string =>
  value.replace(/&(#x[0-9a-fA-F]+|#X[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (match, entity: string) => {
    switch (entity) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
      default: {
        const codePoint = entity.startsWith('#x') || entity.startsWith('#X')
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
      }
    }
  });

const attr = (tag: string, name: string): string | undefined => {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`));
  return match ? decodeXmlEntities(match[1]) : undefined;
};

/** Parse an EAGLE `.sch` string into components + nets.
 *
 * Multi-sheet designs are first-class: parts are shared across sheets, and
 * nets with the same name on several sheets are the *same* net (the classic
 * EAGLE way of wiring across pages), merged into one with every pinref.
 * The old reader looked at the first sheet only, silently dropping every
 * other sheet's parts and pins.
 */
export function parseEagleSchematic(text: string): EagleNetlist {
  if (!/<\s*eagle\b/i.test(text)) throw new Error('EAGLE: root must be an <eagle> document.');
  const sheetMatches = [...text.matchAll(/<\s*sheet\b[^>]*>([\s\S]*?)<\s*\/\s*sheet\s*>/gi)];
  if (sheetMatches.length === 0) throw new Error('EAGLE: no <sheet> found.');
  const components: EagleNetlist['components'] = [];
  const partNames = new Set<string>();
  const mergedNets = new Map<string, Array<{ ref: string; pin: string }>>();
  const anonymousNets: Array<{ name: string; nodes: Array<{ ref: string; pin: string }> }> = [];
  for (const sheetMatch of sheetMatches) {
    const sheet = sheetMatch[1];
    const partsMatch = sheet.match(/<\s*parts\b[^>]*>([\s\S]*?)<\s*\/\s*parts\s*>/i);
    const partsBlock = partsMatch ? partsMatch[1] : '';
    const partTags = partsBlock.match(/<\s*part\b[^>]*\/?>/gi) ?? [];
    for (const tag of partTags) {
      const ref = attr(tag, 'name');
      if (!ref) throw new Error('EAGLE: <part> without name.');
      if (partNames.has(ref)) throw new Error(`EAGLE: duplicate part ${ref} across sheets.`);
      partNames.add(ref);
      components.push({ ref, value: attr(tag, 'value') ?? '', footprint: attr(tag, 'package') ?? '' });
    }
    const netsMatch = sheet.match(/<\s*nets\b[^>]*>([\s\S]*?)<\s*\/\s*nets\s*>/i);
    const netsBlock = netsMatch ? netsMatch[1] : '';
    const netBlocks = [...netsBlock.matchAll(/<\s*net\b([^>]*)>([\s\S]*?)<\s*\/\s*net\s*>/gi)];
    for (const block of netBlocks) {
      const header = block[0].split('>')[0] + '>';
      const netName = attr(header, 'name') ?? '';
      const nodes: Array<{ ref: string; pin: string }> = [];
      const pinrefs = block[2].match(/<\s*pinref\b[^>]*\/?>/gi) ?? [];
      for (const pinref of pinrefs) {
        const ref = attr(pinref, 'part');
        const pin = attr(pinref, 'pin');
        if (!ref || !pin) throw new Error(`EAGLE: net ${netName} has a pinref without part/pin.`);
        nodes.push({ ref, pin });
      }
      // Same net name on multiple sheets is one net; an unnamed net is its own.
      if (netName) {
        const list = mergedNets.get(netName) ?? [];
        list.push(...nodes);
        mergedNets.set(netName, list);
      } else {
        anonymousNets.push({ name: netName, nodes });
      }
    }
  }
  // Every pinref must reference a part the design actually declares.
  const nets: EagleNetlist['nets'] = [];
  let code = 1;
  for (const [name, nodes] of mergedNets) {
    const unknown = nodes.find((node) => !partNames.has(node.ref));
    if (unknown) throw new Error(`EAGLE: net ${name} references unknown part ${unknown.ref}.`);
    nets.push({ code: String(code), name, nodes });
    code += 1;
  }
  for (const { name, nodes } of anonymousNets) {
    const unknown = nodes.find((node) => !partNames.has(node.ref));
    if (unknown) throw new Error(`EAGLE: net ${name} references unknown part ${unknown.ref}.`);
    nets.push({ code: String(code), name, nodes });
    code += 1;
  }
  if (components.length === 0 && nets.length === 0) {
    throw new Error('EAGLE: sheet has no parts or nets.');
  }
  return { components, nets };
}

/**
 * Serialize the shared interchange back to EAGLE XML (same subset as above).
 * Lives here — not in a separate file — so import/export cannot drift apart.
 */
const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function serializeEagleSchematic(net: EagleNetlist): string {
  if (net.components.length === 0 && net.nets.length === 0) {
    throw new Error('EAGLE: nothing to serialize (no parts or nets).');
  }
  const known = new Set(net.components.map((c) => c.ref));
  for (const n of net.nets) {
    if (!n.name) throw new Error('EAGLE: net without name.');
    for (const node of n.nodes) {
      if (!known.has(node.ref)) throw new Error(`EAGLE: net ${n.name} references unknown part ${node.ref}.`);
      if (!node.pin) throw new Error(`EAGLE: net ${n.name} has a node without pin.`);
    }
  }
  const parts = net.components
    .map((c) => `    <part name="${escapeXml(c.ref)}" library="" deviceset="" device="" value="${escapeXml(c.value)}" package="${escapeXml(c.footprint)}"/>`)
    .join('\n');
  const nets = net.nets
    .map((n) => {
      const refs = n.nodes.map((x) => `      <pinref part="${escapeXml(x.ref)}" pin="${escapeXml(x.pin)}"/>`).join('\n');
      return `   <net name="${escapeXml(n.name)}" class="0">\n    <segment>\n${refs}\n    </segment>\n   </net>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>\n<eagle version="9.6.2">\n<drawing>\n<schematic>\n<sheets>\n<sheet>\n<parts>\n${parts}\n</parts>\n<nets>\n${nets}\n</nets>\n</sheet>\n</sheets>\n</schematic>\n</drawing>\n</eagle>\n`;
}
