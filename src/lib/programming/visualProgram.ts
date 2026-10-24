/**
 * Pure sketch generator for the visual behaviour editor.
 *
 * Kept out of the React component so the block graph can be compiled and tested
 * without mounting React Flow. Function blocks are entry markers, not
 * statements, and every action block becomes a statement in the generated loop.
 */
import type { Node } from 'reactflow'

function generateNodeCode(node: Node): string {
  let code = '';

  switch (node.type) {
    case 'input':
      if (node.data.type === 'digital') {
        code += `  int ${node.id}_value = digitalRead(${node.data.pin});\n`;
      } else if (node.data.type === 'analog') {
        code += `  int ${node.id}_value = analogRead(${node.data.pin});\n`;
      }
      break;

    case 'output':
      if (node.data.type === 'digital') {
        code += `  digitalWrite(${node.data.pin}, HIGH);\n`;
      } else if (node.data.type === 'pwm') {
        code += `  analogWrite(${node.data.pin}, 128);\n`;
      }
      break;

    case 'process':
      if (node.data.operation === 'delay') {
        code += `  delay(${node.data.parameters?.ms || 1000});\n`;
      }
      break;

    case 'condition':
      code += `  if (condition) {\n`;
      code += `    // Condition body\n`;
      code += `  }\n`;
      break;

    case 'loop':
      if (node.data.loopType === 'for') {
        code += `  for (int i = 0; i < ${node.data.iterations || 10}; i++) {\n`;
        code += `    // Loop body\n`;
        code += `  }\n`;
      }
      break;
  }

  return code;
}

export function generateArduinoProgram(nodes: Node[]): string {
  let code = '// Generated Arduino Code\n\n';
  code += '#include <Servo.h>\n';
  code += '#include <DHT.h>\n\n';

  const servos = nodes.filter((node) => node.data.type === 'servo');
  servos.forEach((_servo, index) => {
    code += `Servo servo${index};\n`;
  });

  code += '\nvoid setup() {\n';
  code += '  Serial.begin(9600);\n';

  nodes.forEach((node) => {
    if (node.type === 'input' && node.data.type === 'digital') {
      code += `  pinMode(${node.data.pin}, INPUT);\n`;
    } else if (node.type === 'output' && node.data.type === 'digital') {
      code += `  pinMode(${node.data.pin}, OUTPUT);\n`;
    } else if (node.data.type === 'servo') {
      const servoIndex = servos.findIndex((servo) => servo.id === node.id);
      code += `  servo${servoIndex}.attach(${node.data.pin});\n`;
    }
  });

  code += '}\n\n';
  code += 'void loop() {\n';

  const seen = new Set<string>();
  for (const node of nodes) {
    if (node.type === 'function' || seen.has(node.id)) continue;
    seen.add(node.id);
    code += generateNodeCode(node);
  }

  code += '  delay(100); // Small delay to prevent overwhelming the system\n';
  code += '}\n';

  return code;
}
