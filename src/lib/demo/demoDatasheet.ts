/**
 * Sample datasheet text for the Parts demo.
 *
 * Parsed by the same `parseDatasheetText` path the importer uses, so the demo
 * exercises the real pin/electrical extraction and component synthesis rather
 * than a canned result.
 */
export const DEMO_DATASHEET_TEXT = `MPN: MCP3008-I/SL
Manufacturer: Microchip Technology
Description: 8-Channel 10-Bit ADC with SPI Interface
Supply Voltage: 2.7V to 5.5V

Pinout Table:
| 1 | CH0 | Analog Input |
| 2 | CH1 | Analog Input |
| 3 | CH2 | Analog Input |
| 4 | CH3 | Analog Input |
| 5 | CH4 | Analog Input |
| 6 | CH5 | Analog Input |
| 7 | CH6 | Analog Input |
| 8 | CH7 | Analog Input |
| 9 | DGND | Ground |
| 10 | CS | Input |
| 11 | DIN | Input |
| 12 | DOUT | Output |
| 13 | CLK | Input |
| 14 | AGND | Ground |
| 15 | VREF | Input |
| 16 | VDD | Power |
`
