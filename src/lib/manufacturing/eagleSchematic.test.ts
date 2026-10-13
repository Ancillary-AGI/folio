import { describe, expect, it } from 'vitest';
import { parseEagleSchematic } from './eagleSchematic';

const SCH = `<?xml version="1.0" encoding="utf-8"?>
<eagle version="9.6.2">
<drawing>
<schematic>
<sheets>
<sheet>
<parts>
<part name="R1" library="rcl" deviceset="R" device="" value="10k" package="0805"/>
<part name="C1" library="rcl" deviceset="C" device="" value="100n" package="0603"/>
</parts>
<nets>
<net name="N$1" class="0">
<segment>
<pinref part="R1" pin="1"/>
<pinref part="C1" pin="1"/>
</segment>
</net>
<net name="GND" class="0">
<segment>
<pinref part="R1" pin="2"/>
</segment>
<segment>
<pinref part="C1" pin="2"/>
</segment>
</net>
</nets>
</sheet>
</sheets>
</schematic>
</drawing>
</eagle>
`;

describe('EAGLE schematic import', () => {
  it('parses parts and nets across segments into the shared shape', () => {
    const parsed = parseEagleSchematic(SCH);
    expect(parsed.components).toEqual([
      { ref: 'R1', value: '10k', footprint: '0805' },
      { ref: 'C1', value: '100n', footprint: '0603' },
    ]);
    expect(parsed.nets).toHaveLength(2);
    expect(parsed.nets[0]).toEqual({
      code: '1', name: 'N$1',
      nodes: [{ ref: 'R1', pin: '1' }, { ref: 'C1', pin: '1' }],
    });
    expect(parsed.nets[1].nodes).toEqual([
      { ref: 'R1', pin: '2' },
      { ref: 'C1', pin: '2' },
    ]);
  });
  it('rejects non-EAGLE documents and empty sheets', () => {
    expect(() => parseEagleSchematic('<netlist/>')).toThrow(/<eagle>/);
    expect(() => parseEagleSchematic('<eagle><drawing/></eagle>')).toThrow(/sheet/);
    expect(() => parseEagleSchematic('<eagle><sheet></sheet></eagle>')).toThrow(/no parts or nets/);
  });
  it('rejects dangling pinrefs and part-less parts', () => {
    expect(() => parseEagleSchematic(SCH.replace('part="R1" pin="1"', 'part="R9" pin="1"'))).toThrow(/unknown part R9/);
    expect(() => parseEagleSchematic(SCH.replace('name="R1"', ''))).toThrow(/without name/);
    expect(() => parseEagleSchematic(SCH.replace('part="R1" pin="2"', 'part="R1"'))).toThrow(/without part\/pin/);
  });
});
