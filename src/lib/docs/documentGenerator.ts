import { Component } from '../../types';

export interface DocumentTemplate {
  id: string;
  name: string;
  type: 'schematic' | 'pcb' | 'bom' | 'test' | 'assembly' | 'user_manual' | 'datasheet' | 'report';
  description: string;
  sections: Array<{
    id: string;
    title: string;
    content: string;
    required: boolean;
    order: number;
  }>;
  variables: Record<string, {
    type: 'text' | 'number' | 'date' | 'list' | 'table';
    defaultValue?: any;
    required: boolean;
    description: string;
  }>;
  styles: {
    fontFamily: string;
    fontSize: number;
    margins: { top: number; bottom: number; left: number; right: number };
    headerStyle: Record<string, any>;
    bodyStyle: Record<string, any>;
  };
  created: Date;
  modified: Date;
}

export interface GeneratedDocument {
  id: string;
  templateId: string;
  title: string;
  content: string;
  format: 'pdf' | 'docx' | 'html' | 'markdown';
  variables: Record<string, any>;
  metadata: {
    author: string;
    created: Date;
    modified: Date;
    version: string;
    status: 'draft' | 'review' | 'approved' | 'released';
  };
  sections: Array<{
    id: string;
    title: string;
    content: string;
    pageBreak?: boolean;
  }>;
}

export interface DocumentExportOptions {
  format: 'pdf' | 'docx' | 'html' | 'markdown';
  includeTableOfContents: boolean;
  includeHeaders: boolean;
  includeFooters: boolean;
  pageOrientation: 'portrait' | 'landscape';
  paperSize: 'a4' | 'letter' | 'legal';
  margins: { top: number; bottom: number; left: number; right: number };
}

export class DocumentGenerator {
  private templates: Map<string, DocumentTemplate> = new Map();
  private documents: Map<string, GeneratedDocument> = new Map();

  createTemplate(template: Omit<DocumentTemplate, 'id' | 'created' | 'modified'>): DocumentTemplate {
    const documentTemplate: DocumentTemplate = {
      ...template,
      id: `template_${Date.now()}`,
      created: new Date(),
      modified: new Date()
    };

    this.templates.set(documentTemplate.id, documentTemplate);
    return documentTemplate;
  }

  generateDocument(templateId: string, variables: Record<string, any>, title: string, author: string): GeneratedDocument {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error('Document template not found');
    }

    // Validate required variables
    const missingVars = Object.entries(template.variables)
      .filter(([key, config]) => config.required && !(key in variables))
      .map(([key]) => key);

    if (missingVars.length > 0) {
      throw new Error(`Missing required variables: ${missingVars.join(', ')}`);
    }

    // Generate content for each section
    const sections = template.sections
      .sort((a, b) => a.order - b.order)
      .map(section => ({
        id: section.id,
        title: this.replaceVariables(section.title, variables),
        content: this.replaceVariables(section.content, variables)
      }));

    // Combine sections into full document content
    const content = this.combineSections(sections, template);

    const document: GeneratedDocument = {
      id: `doc_${Date.now()}`,
      templateId,
      title,
      content,
      format: 'pdf',
      variables,
      metadata: {
        author,
        created: new Date(),
        modified: new Date(),
        version: '1.0',
        status: 'draft'
      },
      sections
    };

    this.documents.set(document.id, document);
    return document;
  }

  private replaceVariables(text: string, variables: Record<string, any>): string {
    let result = text;

    // Replace simple variables
    Object.entries(variables).forEach(([key, value]) => {
      const regex = new RegExp(`\\$\\{${key}\\}`, 'g');
      result = result.replace(regex, String(value));
    });

    // Handle conditional sections
    result = result.replace(/\{\{if\s+(\w+)\}\}([\s\S]*?)\{\{endif\}\}/g, (match, condition, content) => {
      return variables[condition] ? content : '';
    });

    // Handle loops
    result = result.replace(/\{\{for\s+(\w+)\s+in\s+(\w+)\}\}([\s\S]*?)\{\{endfor\}\}/g, (match, item, list, content) => {
      const listData = variables[list];
      if (!Array.isArray(listData)) return '';

      return listData.map(data => {
        let itemContent = content;
        if (typeof data === 'object') {
          Object.entries(data).forEach(([key, value]) => {
            itemContent = itemContent.replace(new RegExp(`\\$\\{${item}\\.${key}\\}`, 'g'), String(value));
          });
        } else {
          itemContent = itemContent.replace(new RegExp(`\\$\\{${item}\\}`, 'g'), String(data));
        }
        return itemContent;
      }).join('');
    });

    return result;
  }

  private combineSections(sections: GeneratedDocument['sections'], template: DocumentTemplate): string {
    let content = '';

    // Add title page
    content += `# ${template.name}\n\n`;
    content += `*Generated on ${new Date().toLocaleDateString()}*\n\n`;
    content += '---\n\n';

    // Add table of contents
    content += '## Table of Contents\n\n';
    sections.forEach((section, index) => {
      content += `${index + 1}. ${section.title}\n`;
    });
    content += '\n---\n\n';

    // Add sections
    sections.forEach((section, index) => {
      content += `## ${index + 1}. ${section.title}\n\n`;
      content += section.content + '\n\n';
      if (section.pageBreak) {
        content += '\\pagebreak\n\n';
      }
    });

    return content;
  }

  exportDocument(documentId: string, options: DocumentExportOptions): string {
    const document = this.documents.get(documentId);
    if (!document) {
      throw new Error('Document not found');
    }

    switch (options.format) {
      case 'pdf':
        return this.exportToPDF(document, options);
      case 'docx':
        return this.exportToDOCX(document, options);
      case 'html':
        return this.exportToHTML(document, options);
      case 'markdown':
        return document.content;
      default:
        throw new Error(`Unsupported export format: ${options.format}`);
    }
  }

  private exportToPDF(document: GeneratedDocument, options: DocumentExportOptions): string {
    // This would integrate with a PDF generation library like pdfmake or puppeteer
    // For now, return a placeholder
    return `PDF export of "${document.title}" - ${document.content.length} characters`;
  }

  private exportToDOCX(document: GeneratedDocument, options: DocumentExportOptions): string {
    // This would integrate with a DOCX generation library like docx
    // For now, return a placeholder
    return `DOCX export of "${document.title}" - ${document.sections.length} sections`;
  }

  private exportToHTML(document: GeneratedDocument, options: DocumentExportOptions): string {
    let html = `<!DOCTYPE html>
<html>
<head>
    <title>${document.title}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: ${options.margins.top}mm ${options.margins.right}mm ${options.margins.bottom}mm ${options.margins.left}mm; }
        h1 { color: #333; }
        h2 { color: #666; margin-top: 30px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>`;

    // Convert markdown-like content to HTML
    const htmlContent = document.content
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');

    html += `<h1>${document.title}</h1>`;
    html += `<p><em>Generated on ${document.metadata.created.toLocaleDateString()} by ${document.metadata.author}</em></p>`;
    html += `<p>${htmlContent}</p>`;
    html += '</body></html>';

    return html;
  }

  createDefaultTemplates(): void {
    // Schematic Document Template
    this.createTemplate({
      name: 'Schematic Documentation',
      type: 'schematic',
      description: 'Complete schematic documentation with component details and connections',
      sections: [
        {
          id: 'title_page',
          title: 'Title Page',
          content: '# ${projectName} Schematic\n\n**Document Version:** ${version}\n**Date:** ${date}\n**Author:** ${author}\n\n---',
          required: true,
          order: 1
        },
        {
          id: 'overview',
          title: 'System Overview',
          content: '## System Overview\n\n**Purpose:** ${purpose}\n\n**Key Features:**\n${features}\n\n**Block Diagram:**\n![Block Diagram](${blockDiagram})',
          required: true,
          order: 2
        },
        {
          id: 'components',
          title: 'Component List',
          content: '## Component List\n\n| Reference | Component | Value | Manufacturer | Part Number |\n|-----------|-----------|-------|--------------|-------------|\n{{for component in components}}${component.reference}|${component.name}|${component.value}|${component.manufacturer}|${component.partNumber}|\n{{endfor}}',
          required: true,
          order: 3
        },
        {
          id: 'schematics',
          title: 'Schematic Diagrams',
          content: '## Schematic Diagrams\n\n{{for sheet in schematicSheets}}### ${sheet.name}\n\n![${sheet.name}](${sheet.image})\n\n**Sheet ${sheet.number} of ${totalSheets}**\n\n{{endfor}}',
          required: true,
          order: 4
        },
        {
          id: 'connections',
          title: 'Signal Connections',
          content: '## Signal Connections\n\n### Power Nets\n${powerNets}\n\n### Signal Nets\n${signalNets}\n\n### Ground Nets\n${groundNets}',
          required: true,
          order: 5
        },
        {
          id: 'specifications',
          title: 'Electrical Specifications',
          content: '## Electrical Specifications\n\n**Power Supply:** ${powerSupply}\n**Operating Voltage:** ${operatingVoltage}\n**Current Consumption:** ${currentConsumption}\n**Signal Levels:** ${signalLevels}',
          required: false,
          order: 6
        }
      ],
      variables: {
        projectName: { type: 'text', required: true, description: 'Name of the project' },
        version: { type: 'text', required: true, description: 'Document version' },
        date: { type: 'date', required: true, description: 'Document creation date' },
        author: { type: 'text', required: true, description: 'Document author' },
        purpose: { type: 'text', required: true, description: 'System purpose and description' },
        features: { type: 'list', required: true, description: 'Key system features' },
        blockDiagram: { type: 'text', required: false, description: 'Path to block diagram image' },
        components: { type: 'table', required: true, description: 'List of components with details' },
        schematicSheets: { type: 'list', required: true, description: 'Schematic sheet information' },
        totalSheets: { type: 'number', required: true, description: 'Total number of schematic sheets' },
        powerNets: { type: 'text', required: true, description: 'Power net descriptions' },
        signalNets: { type: 'text', required: true, description: 'Signal net descriptions' },
        groundNets: { type: 'text', required: true, description: 'Ground net descriptions' },
        powerSupply: { type: 'text', required: true, description: 'Power supply specifications' },
        operatingVoltage: { type: 'text', required: true, description: 'Operating voltage range' },
        currentConsumption: { type: 'text', required: true, description: 'Current consumption specifications' },
        signalLevels: { type: 'text', required: true, description: 'Signal level specifications' }
      },
      styles: {
        fontFamily: 'Arial',
        fontSize: 12,
        margins: { top: 25, bottom: 25, left: 25, right: 25 },
        headerStyle: { fontSize: 16, bold: true },
        bodyStyle: { fontSize: 12, lineHeight: 1.5 }
      }
    });

    // BOM Document Template
    this.createTemplate({
      name: 'Bill of Materials',
      type: 'bom',
      description: 'Comprehensive bill of materials with procurement information',
      sections: [
        {
          id: 'header',
          title: 'Document Header',
          content: '# Bill of Materials\n\n**Project:** ${projectName}\n**Version:** ${version}\n**Date:** ${date}\n**Prepared by:** ${author}',
          required: true,
          order: 1
        },
        {
          id: 'summary',
          title: 'BOM Summary',
          content: '## Summary\n\n**Total Components:** ${totalComponents}\n**Unique Parts:** ${uniqueParts}\n**Total Cost:** $${totalCost}\n**Currency:** ${currency}',
          required: true,
          order: 2
        },
        {
          id: 'bom_table',
          title: 'Component Details',
          content: '## Component Details\n\n| Item | Quantity | Reference | Manufacturer | Part Number | Supplier | Unit Cost | Total Cost | Lead Time |\n|------|----------|-----------|--------------|-------------|----------|-----------|------------|-----------|\n{{for item in bomItems}}${item.itemNumber}|${item.quantity}|${item.reference}|${item.manufacturer}|${item.partNumber}|${item.supplier}|$${item.unitCost}|$${item.totalCost}|${item.leadTime} days|\n{{endfor}}',
          required: true,
          order: 3
        },
        {
          id: 'procurement',
          title: 'Procurement Information',
          content: '## Procurement Information\n\n{{for supplier in suppliers}}### ${supplier.name}\n\n**Contact:** ${supplier.contact}\n**Lead Time:** ${supplier.leadTime} days\n**Minimum Order:** ${supplier.minimumOrder}\n\n**Items:**\n{{for item in supplier.items}}- ${item.quantity}x ${item.partNumber} (${item.description})\n{{endfor}}\n\n{{endfor}}',
          required: true,
          order: 4
        }
      ],
      variables: {
        projectName: { type: 'text', required: true, description: 'Project name' },
        version: { type: 'text', required: true, description: 'BOM version' },
        date: { type: 'date', required: true, description: 'Document date' },
        author: { type: 'text', required: true, description: 'Document author' },
        totalComponents: { type: 'number', required: true, description: 'Total number of components' },
        uniqueParts: { type: 'number', required: true, description: 'Number of unique part numbers' },
        totalCost: { type: 'number', required: true, description: 'Total BOM cost' },
        currency: { type: 'text', required: true, description: 'Cost currency' },
        bomItems: { type: 'table', required: true, description: 'Detailed BOM items' },
        suppliers: { type: 'list', required: true, description: 'Supplier information and items' }
      },
      styles: {
        fontFamily: 'Calibri',
        fontSize: 11,
        margins: { top: 20, bottom: 20, left: 20, right: 20 },
        headerStyle: { fontSize: 14, bold: true },
        bodyStyle: { fontSize: 11, lineHeight: 1.2 }
      }
    });

    // Test Report Template
    this.createTemplate({
      name: 'Test Report',
      type: 'report',
      description: 'Comprehensive test execution report with results and analysis',
      sections: [
        {
          id: 'cover',
          title: 'Cover Page',
          content: '# Test Report\n\n**Project:** ${projectName}\n**Test Phase:** ${testPhase}\n**Date:** ${date}\n**Tested by:** ${tester}\n**Reviewed by:** ${reviewer}',
          required: true,
          order: 1
        },
        {
          id: 'executive_summary',
          title: 'Executive Summary',
          content: '## Executive Summary\n\n**Test Objective:** ${testObjective}\n\n**Overall Result:** ${overallResult}\n\n**Key Findings:**\n${keyFindings}\n\n**Recommendations:**\n${recommendations}',
          required: true,
          order: 2
        },
        {
          id: 'test_summary',
          title: 'Test Summary',
          content: '## Test Summary\n\n| Test Category | Total Tests | Passed | Failed | Blocked | Pass Rate |\n|---------------|-------------|--------|--------|---------|-----------|\n{{for category in testCategories}}${category.name}|${category.total}|${category.passed}|${category.failed}|${category.blocked}|${category.passRate}%|\n{{endfor}}\n\n**Total Execution Time:** ${totalTime} hours',
          required: true,
          order: 3
        },
        {
          id: 'detailed_results',
          title: 'Detailed Test Results',
          content: '## Detailed Test Results\n\n{{for test in testResults}}### ${test.name}\n\n**Status:** ${test.status}\n**Duration:** ${test.duration} minutes\n**Tested by:** ${test.tester}\n\n**Description:** ${test.description}\n\n**Steps:**\n${test.steps}\n\n**Expected Result:** ${test.expectedResult}\n\n**Actual Result:** ${test.actualResult}\n\n{{if test.defects}}**Defects:**\n{{for defect in test.defects}}- ${defect.id}: ${defect.description} (${defect.severity})\n{{endfor}}{{endif}}\n\n---\n\n{{endfor}}',
          required: true,
          order: 4
        },
        {
          id: 'defect_summary',
          title: 'Defect Summary',
          content: '## Defect Summary\n\n### Defect Distribution by Severity\n\n| Severity | Count | Percentage |\n|----------|-------|------------|\n{{for severity in defectSeverities}}${severity.level}|${severity.count}|${severity.percentage}%|\n{{endfor}}\n\n### Top Defect Categories\n\n| Category | Count | Percentage |\n|----------|-------|------------|\n{{for category in defectCategories}}${category.name}|${category.count}|${category.percentage}%|\n{{endfor}}',
          required: true,
          order: 5
        },
        {
          id: 'conclusion',
          title: 'Conclusion and Recommendations',
          content: '## Conclusion\n\n${conclusion}\n\n## Recommendations\n\n${detailedRecommendations}\n\n## Next Steps\n\n${nextSteps}',
          required: true,
          order: 6
        }
      ],
      variables: {
        projectName: { type: 'text', required: true, description: 'Project name' },
        testPhase: { type: 'text', required: true, description: 'Test phase (unit, integration, system, etc.)' },
        date: { type: 'date', required: true, description: 'Test execution date' },
        tester: { type: 'text', required: true, description: 'Test execution team' },
        reviewer: { type: 'text', required: true, description: 'Test review team' },
        testObjective: { type: 'text', required: true, description: 'Overall test objective' },
        overallResult: { type: 'text', required: true, description: 'Overall test result' },
        keyFindings: { type: 'list', required: true, description: 'Key test findings' },
        recommendations: { type: 'list', required: true, description: 'High-level recommendations' },
        testCategories: { type: 'table', required: true, description: 'Test results by category' },
        totalTime: { type: 'number', required: true, description: 'Total test execution time' },
        testResults: { type: 'list', required: true, description: 'Detailed test results' },
        defectSeverities: { type: 'table', required: true, description: 'Defects by severity level' },
        defectCategories: { type: 'table', required: true, description: 'Defects by category' },
        conclusion: { type: 'text', required: true, description: 'Test conclusion' },
        detailedRecommendations: { type: 'list', required: true, description: 'Detailed recommendations' },
        nextSteps: { type: 'list', required: true, description: 'Next steps and actions' }
      },
      styles: {
        fontFamily: 'Times New Roman',
        fontSize: 12,
        margins: { top: 25, bottom: 25, left: 25, right: 25 },
        headerStyle: { fontSize: 14, bold: true, color: '#000080' },
        bodyStyle: { fontSize: 12, lineHeight: 1.5 }
      }
    });
  }

  getTemplate(id: string): DocumentTemplate | undefined {
    return this.templates.get(id);
  }

  getDocument(id: string): GeneratedDocument | undefined {
    return this.documents.get(id);
  }

  getAllTemplates(): DocumentTemplate[] {
    return Array.from(this.templates.values());
  }

  getAllDocuments(): GeneratedDocument[] {
    return Array.from(this.documents.values());
  }

  getTemplatesByType(type: DocumentTemplate['type']): DocumentTemplate[] {
    return this.getAllTemplates().filter(template => template.type === type);
  }

  updateDocumentStatus(documentId: string, status: GeneratedDocument['metadata']['status']): boolean {
    const document = this.documents.get(documentId);
    if (!document) return false;

    document.metadata.status = status;
    document.metadata.modified = new Date();
    return true;
  }
}

export const documentGenerator = new DocumentGenerator();