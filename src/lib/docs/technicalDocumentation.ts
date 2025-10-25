import { Component } from '../../types';

export interface TechnicalDocument {
  id: string;
  title: string;
  type: 'api_reference' | 'user_guide' | 'developer_guide' | 'architecture' | 'requirements' | 'design_spec' | 'test_plan' | 'maintenance_manual';
  version: string;
  status: 'draft' | 'review' | 'approved' | 'published' | 'obsolete';
  content: {
    sections: Array<{
      id: string;
      title: string;
      content: string;
      level: number; // heading level
      order: number;
    }>;
    metadata: {
      author: string;
      reviewers: string[];
      created: Date;
      modified: Date;
      approved?: Date;
      published?: Date;
    };
  };
  tags: string[];
  relatedDocuments: string[]; // document IDs
  attachments: Array<{
    name: string;
    type: string;
    url: string;
    size: number;
  }>;
}

export interface DocumentationIndex {
  id: string;
  name: string;
  description: string;
  documents: Array<{
    documentId: string;
    title: string;
    type: string;
    version: string;
    status: string;
    lastModified: Date;
  }>;
  categories: Array<{
    name: string;
    documents: string[]; // document IDs
  }>;
  searchIndex: Map<string, string[]>; // term -> document IDs
}

export interface DocumentationTemplate {
  id: string;
  name: string;
  type: TechnicalDocument['type'];
  structure: Array<{
    title: string;
    level: number;
    required: boolean;
    template: string;
    variables: string[];
  }>;
}

export class TechnicalDocumentationManager {
  private documents: Map<string, TechnicalDocument> = new Map();
  private indices: Map<string, DocumentationIndex> = new Map();
  private templates: Map<string, DocumentationTemplate> = new Map();

  createDocument(document: Omit<TechnicalDocument, 'id'>): TechnicalDocument {
    const techDocument: TechnicalDocument = {
      ...document,
      id: `doc_${Date.now()}`
    };

    this.documents.set(techDocument.id, techDocument);
    return techDocument;
  }

  createDocumentationIndex(name: string, description: string): DocumentationIndex {
    const index: DocumentationIndex = {
      id: `index_${Date.now()}`,
      name,
      description,
      documents: [],
      categories: [],
      searchIndex: new Map()
    };

    this.indices.set(index.id, index);
    return index;
  }

  addDocumentToIndex(indexId: string, documentId: string): boolean {
    const index = this.indices.get(indexId);
    const document = this.documents.get(documentId);

    if (!index || !document) return false;

    // Remove existing entry if present
    index.documents = index.documents.filter(d => d.documentId !== documentId);

    // Add new entry
    index.documents.push({
      documentId,
      title: document.title,
      type: document.type,
      version: document.version,
      status: document.status,
      lastModified: document.content.metadata.modified
    });

    // Update search index
    this.updateSearchIndex(index, document);

    return true;
  }

  private updateSearchIndex(index: DocumentationIndex, document: TechnicalDocument): void {
    const terms = this.extractSearchTerms(document);

    terms.forEach(term => {
      if (!index.searchIndex.has(term)) {
        index.searchIndex.set(term, []);
      }
      const docs = index.searchIndex.get(term)!;
      if (!docs.includes(document.id)) {
        docs.push(document.id);
      }
    });
  }

  private extractSearchTerms(document: TechnicalDocument): string[] {
    const terms = new Set<string>();

    // Extract from title
    document.title.toLowerCase().split(/\s+/).forEach(word => {
      if (word.length > 2) terms.add(word);
    });

    // Extract from content
    document.content.sections.forEach(section => {
      section.title.toLowerCase().split(/\s+/).forEach(word => {
        if (word.length > 2) terms.add(word);
      });

      // Extract keywords from content (simplified)
      const contentWords = section.content.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 3);

      contentWords.forEach(word => terms.add(word));
    });

    // Add tags
    document.tags.forEach(tag => terms.add(tag.toLowerCase()));

    return Array.from(terms);
  }

  searchDocuments(indexId: string, query: string): Array<{
    documentId: string;
    title: string;
    type: string;
    relevance: number;
    snippets: string[];
  }> {
    const index = this.indices.get(indexId);
    if (!index) return [];

    const queryTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 2);
    const results = new Map<string, { relevance: number; snippets: string[] }>();

    queryTerms.forEach(term => {
      const documentIds = index.searchIndex.get(term) || [];

      documentIds.forEach(docId => {
        if (!results.has(docId)) {
          results.set(docId, { relevance: 0, snippets: [] });
        }

        const result = results.get(docId)!;
        result.relevance += 1;

        // Find snippets containing the term
        const document = this.documents.get(docId);
        if (document) {
          document.content.sections.forEach(section => {
            if (section.content.toLowerCase().includes(term) && result.snippets.length < 3) {
              const start = Math.max(0, section.content.toLowerCase().indexOf(term) - 50);
              const end = Math.min(section.content.length, start + 100);
              const snippet = section.content.substring(start, end);
              result.snippets.push(`...${snippet}...`);
            }
          });
        }
      });
    });

    // Convert to sorted array
    return Array.from(results.entries())
      .map(([documentId, data]) => {
        const doc = index.documents.find(d => d.documentId === documentId);
        return {
          documentId,
          title: doc?.title || 'Unknown',
          type: doc?.type || 'unknown',
          relevance: data.relevance,
          snippets: data.snippets
        };
      })
      .sort((a, b) => b.relevance - a.relevance);
  }

  createDocumentationTemplate(template: Omit<DocumentationTemplate, 'id'>): DocumentationTemplate {
    const docTemplate: DocumentationTemplate = {
      ...template,
      id: `template_${Date.now()}`
    };

    this.templates.set(docTemplate.id, docTemplate);
    return docTemplate;
  }

  generateDocumentFromTemplate(templateId: string, variables: Record<string, any>): TechnicalDocument {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error('Template not found');
    }

    const sections = template.structure.map(struct => ({
      id: `section_${Date.now()}_${Math.random()}`,
      title: this.replaceVariables(struct.title, variables),
      content: this.replaceVariables(struct.template, variables),
      level: struct.level,
      order: struct.order || 0
    }));

    const document: TechnicalDocument = {
      id: `doc_${Date.now()}`,
      title: variables.title || `${template.name} Document`,
      type: template.type,
      version: '1.0',
      status: 'draft',
      content: {
        sections,
        metadata: {
          author: variables.author || 'System',
          reviewers: variables.reviewers || [],
          created: new Date(),
          modified: new Date()
        }
      },
      tags: variables.tags || [],
      relatedDocuments: variables.relatedDocuments || [],
      attachments: variables.attachments || []
    };

    this.documents.set(document.id, document);
    return document;
  }

  private replaceVariables(text: string, variables: Record<string, any>): string {
    let result = text;

    Object.entries(variables).forEach(([key, value]) => {
      const regex = new RegExp(`\\$\\{${key}\\}`, 'g');
      result = result.replace(regex, String(value));
    });

    return result;
  }

  createDefaultTemplates(): void {
    // API Reference Template
    this.createDocumentationTemplate({
      name: 'API Reference',
      type: 'api_reference',
      structure: [
        {
          title: 'API Overview',
          level: 1,
          required: true,
          template: '# API Reference\n\n## Overview\n\n${apiDescription}\n\n## Base URL\n\n```\n${baseUrl}\n```\n\n## Authentication\n\n${authentication}',
          variables: ['apiDescription', 'baseUrl', 'authentication']
        },
        {
          title: 'Endpoints',
          level: 1,
          required: true,
          template: '# Endpoints\n\n## ${endpointName}\n\n### ${method} ${path}\n\n**Description:** ${description}\n\n**Parameters:**\n${parameters}\n\n**Response:**\n${response}\n\n**Example:**\n```json\n${example}\n```',
          variables: ['endpointName', 'method', 'path', 'description', 'parameters', 'response', 'example']
        },
        {
          title: 'Data Models',
          level: 1,
          required: true,
          template: '# Data Models\n\n## ${modelName}\n\n```typescript\n${modelDefinition}\n```\n\n**Properties:**\n${properties}',
          variables: ['modelName', 'modelDefinition', 'properties']
        }
      ]
    });

    // User Guide Template
    this.createDocumentationTemplate({
      name: 'User Guide',
      type: 'user_guide',
      structure: [
        {
          title: 'Introduction',
          level: 1,
          required: true,
          template: '# ${productName} User Guide\n\n## Welcome\n\n${introduction}\n\n## Key Features\n\n${features}\n\n## System Requirements\n\n${requirements}',
          variables: ['productName', 'introduction', 'features', 'requirements']
        },
        {
          title: 'Getting Started',
          level: 1,
          required: true,
          template: '# Getting Started\n\n## Installation\n\n${installation}\n\n## First Time Setup\n\n${setup}\n\n## Basic Usage\n\n${basicUsage}',
          variables: ['installation', 'setup', 'basicUsage']
        },
        {
          title: 'Advanced Features',
          level: 1,
          required: false,
          template: '# Advanced Features\n\n## ${featureName}\n\n${featureDescription}\n\n### How to Use\n\n${usageInstructions}\n\n### Examples\n\n${examples}',
          variables: ['featureName', 'featureDescription', 'usageInstructions', 'examples']
        },
        {
          title: 'Troubleshooting',
          level: 1,
          required: true,
          template: '# Troubleshooting\n\n## Common Issues\n\n${commonIssues}\n\n## Error Messages\n\n${errorMessages}\n\n## Support\n\n${support}',
          variables: ['commonIssues', 'errorMessages', 'support']
        }
      ]
    });

    // Architecture Document Template
    this.createDocumentationTemplate({
      name: 'System Architecture',
      type: 'architecture',
      structure: [
        {
          title: 'System Overview',
          level: 1,
          required: true,
          template: '# System Architecture\n\n## Overview\n\n${systemOverview}\n\n## Architecture Principles\n\n${principles}\n\n## High-Level Architecture\n\n![Architecture Diagram](${architectureDiagram})',
          variables: ['systemOverview', 'principles', 'architectureDiagram']
        },
        {
          title: 'Components',
          level: 1,
          required: true,
          template: '# System Components\n\n## ${componentName}\n\n**Purpose:** ${purpose}\n\n**Responsibilities:**\n${responsibilities}\n\n**Interfaces:**\n${interfaces}\n\n**Dependencies:**\n${dependencies}',
          variables: ['componentName', 'purpose', 'responsibilities', 'interfaces', 'dependencies']
        },
        {
          title: 'Data Architecture',
          level: 1,
          required: true,
          template: '# Data Architecture\n\n## Data Flow\n\n${dataFlow}\n\n## Data Storage\n\n${dataStorage}\n\n## Data Security\n\n${dataSecurity}',
          variables: ['dataFlow', 'dataStorage', 'dataSecurity']
        },
        {
          title: 'Deployment Architecture',
          level: 1,
          required: true,
          template: '# Deployment Architecture\n\n## Environments\n\n${environments}\n\n## Infrastructure\n\n${infrastructure}\n\n## Scaling Strategy\n\n${scaling}',
          variables: ['environments', 'infrastructure', 'scaling']
        }
      ]
    });

    // Requirements Document Template
    this.createDocumentationTemplate({
      name: 'Requirements Specification',
      type: 'requirements',
      structure: [
        {
          title: 'Introduction',
          level: 1,
          required: true,
          template: '# Requirements Specification\n\n## Purpose\n\n${purpose}\n\n## Scope\n\n${scope}\n\n## Definitions\n\n${definitions}\n\n## References\n\n${references}',
          variables: ['purpose', 'scope', 'definitions', 'references']
        },
        {
          title: 'Functional Requirements',
          level: 1,
          required: true,
          template: '# Functional Requirements\n\n## ${requirementId}: ${requirementTitle}\n\n**Description:** ${description}\n\n**Priority:** ${priority}\n\n**Acceptance Criteria:**\n${acceptanceCriteria}\n\n**Dependencies:** ${dependencies}',
          variables: ['requirementId', 'requirementTitle', 'description', 'priority', 'acceptanceCriteria', 'dependencies']
        },
        {
          title: 'Non-Functional Requirements',
          level: 1,
          required: true,
          template: '# Non-Functional Requirements\n\n## Performance\n\n${performance}\n\n## Security\n\n${security}\n\n## Usability\n\n${usability}\n\n## Reliability\n\n${reliability}',
          variables: ['performance', 'security', 'usability', 'reliability']
        },
        {
          title: 'Interface Requirements',
          level: 1,
          required: false,
          template: '# Interface Requirements\n\n## User Interfaces\n\n${userInterfaces}\n\n## External Interfaces\n\n${externalInterfaces}\n\n## Internal Interfaces\n\n${internalInterfaces}',
          variables: ['userInterfaces', 'externalInterfaces', 'internalInterfaces']
        }
      ]
    });
  }

  updateDocumentStatus(documentId: string, status: TechnicalDocument['status']): boolean {
    const document = this.documents.get(documentId);
    if (!document) return false;

    document.status = status;
    document.content.metadata.modified = new Date();

    if (status === 'approved') {
      document.content.metadata.approved = new Date();
    } else if (status === 'published') {
      document.content.metadata.published = new Date();
    }

    return true;
  }

  addDocumentRelation(documentId: string, relatedDocumentId: string): boolean {
    const document = this.documents.get(documentId);
    if (!document) return false;

    if (!document.relatedDocuments.includes(relatedDocumentId)) {
      document.relatedDocuments.push(relatedDocumentId);
    }

    return true;
  }

  getDocument(id: string): TechnicalDocument | undefined {
    return this.documents.get(id);
  }

  getDocumentationIndex(id: string): DocumentationIndex | undefined {
    return this.indices.get(id);
  }

  getTemplate(id: string): DocumentationTemplate | undefined {
    return this.templates.get(id);
  }

  getAllDocuments(): TechnicalDocument[] {
    return Array.from(this.documents.values());
  }

  getAllIndices(): DocumentationIndex[] {
    return Array.from(this.indices.values());
  }

  getAllTemplates(): DocumentationTemplate[] {
    return Array.from(this.templates.values());
  }

  getDocumentsByType(type: TechnicalDocument['type']): TechnicalDocument[] {
    return this.getAllDocuments().filter(doc => doc.type === type);
  }

  getDocumentsByStatus(status: TechnicalDocument['status']): TechnicalDocument[] {
    return this.getAllDocuments().filter(doc => doc.status === status);
  }

  getRelatedDocuments(documentId: string): TechnicalDocument[] {
    const document = this.documents.get(documentId);
    if (!document) return [];

    return document.relatedDocuments
      .map(id => this.documents.get(id))
      .filter(doc => doc !== undefined) as TechnicalDocument[];
  }
}

export const technicalDocumentationManager = new TechnicalDocumentationManager();