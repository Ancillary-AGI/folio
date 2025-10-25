import { Component } from '../../types';

export interface UserManual {
  id: string;
  title: string;
  productName: string;
  version: string;
  language: string;
  targetAudience: 'beginner' | 'intermediate' | 'advanced' | 'developer';
  content: {
    sections: Array<{
      id: string;
      title: string;
      content: string;
      level: number;
      order: number;
      estimatedReadTime: number; // minutes
    }>;
    metadata: {
      author: string;
      reviewers: string[];
      created: Date;
      modified: Date;
      published?: Date;
    };
  };
  navigation: {
    tableOfContents: Array<{
      title: string;
      level: number;
      sectionId: string;
      pageNumber?: number;
    }>;
    index: Map<string, string[]>; // term -> section IDs
    crossReferences: Array<{
      fromSection: string;
      toSection: string;
      type: 'see_also' | 'prerequisite' | 'next_step';
    }>;
  };
  multimedia: {
    screenshots: Array<{
      id: string;
      filename: string;
      caption: string;
      sectionId: string;
      altText: string;
    }>;
    videos: Array<{
      id: string;
      title: string;
      url: string;
      duration: number;
      sectionId: string;
      thumbnail: string;
    }>;
    diagrams: Array<{
      id: string;
      title: string;
      filename: string;
      sectionId: string;
      type: 'flowchart' | 'architecture' | 'ui_layout' | 'process';
    }>;
  };
  accessibility: {
    screenReaderCompatible: boolean;
    highContrastSupport: boolean;
    keyboardNavigation: boolean;
    altTexts: boolean;
    simplifiedVersion?: string; // manual ID for simplified version
  };
  translations: Array<{
    language: string;
    manualId: string;
    lastSync: Date;
    translator: string;
  }>;
}

export interface UserManualTemplate {
  id: string;
  name: string;
  audience: UserManual['targetAudience'];
  structure: Array<{
    title: string;
    level: number;
    required: boolean;
    template: string;
    variables: string[];
    estimatedReadTime: number;
  }>;
  styleGuide: {
    tone: 'formal' | 'conversational' | 'technical';
    terminology: Record<string, string>; // term -> definition
    formatting: {
      headingStyle: string;
      bodyFont: string;
      codeStyle: string;
      noteStyle: string;
      warningStyle: string;
    };
  };
}

export interface ManualFeedback {
  id: string;
  manualId: string;
  userId: string;
  sectionId?: string;
  rating: number; // 1-5
  feedback: string;
  suggestions: string[];
  timestamp: Date;
  userAgent: string;
  helpful: boolean;
}

export class UserManualManager {
  private manuals: Map<string, UserManual> = new Map();
  private templates: Map<string, UserManualTemplate> = new Map();
  private feedback: Map<string, ManualFeedback[]> = new Map();

  createUserManual(manual: Omit<UserManual, 'id'>): UserManual {
    const userManual: UserManual = {
      ...manual,
      id: `manual_${Date.now()}`
    };

    this.manuals.set(userManual.id, userManual);
    this.buildNavigationIndex(userManual);
    return userManual;
  }

  createManualTemplate(template: Omit<UserManualTemplate, 'id'>): UserManualTemplate {
    const manualTemplate: UserManualTemplate = {
      ...template,
      id: `template_${Date.now()}`
    };

    this.templates.set(manualTemplate.id, manualTemplate);
    return manualTemplate;
  }

  generateManualFromTemplate(templateId: string, variables: Record<string, any>): UserManual {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error('Template not found');
    }

    const sections = template.structure.map(struct => ({
      id: `section_${Date.now()}_${Math.random()}`,
      title: this.replaceVariables(struct.title, variables),
      content: this.replaceVariables(struct.template, variables),
      level: struct.level,
      order: struct.order || 0,
      estimatedReadTime: struct.estimatedReadTime
    }));

    // Build table of contents
    const tableOfContents = sections.map(section => ({
      title: section.title,
      level: section.level,
      sectionId: section.id
    }));

    // Build index
    const index = new Map<string, string[]>();
    sections.forEach(section => {
      const terms = this.extractIndexTerms(section.content);
      terms.forEach(term => {
        if (!index.has(term)) {
          index.set(term, []);
        }
        index.get(term)!.push(section.id);
      });
    });

    const manual: UserManual = {
      id: `manual_${Date.now()}`,
      title: variables.title || `${template.name} Manual`,
      productName: variables.productName || 'Product',
      version: variables.version || '1.0',
      language: variables.language || 'en',
      targetAudience: template.audience,
      content: {
        sections,
        metadata: {
          author: variables.author || 'System',
          reviewers: variables.reviewers || [],
          created: new Date(),
          modified: new Date()
        }
      },
      navigation: {
        tableOfContents,
        index,
        crossReferences: variables.crossReferences || []
      },
      multimedia: {
        screenshots: variables.screenshots || [],
        videos: variables.videos || [],
        diagrams: variables.diagrams || []
      },
      accessibility: {
        screenReaderCompatible: true,
        highContrastSupport: true,
        keyboardNavigation: true,
        altTexts: true,
        simplifiedVersion: variables.simplifiedVersion
      },
      translations: variables.translations || []
    };

    this.manuals.set(manual.id, manual);
    return manual;
  }

  private replaceVariables(text: string, variables: Record<string, any>): string {
    let result = text;

    Object.entries(variables).forEach(([key, value]) => {
      const regex = new RegExp(`\\$\\{${key}\\}`, 'g');
      result = result.replace(regex, String(value));
    });

    return result;
  }

  private extractIndexTerms(content: string): string[] {
    const terms = new Set<string>();

    // Extract important terms (simplified - in practice would use NLP)
    const words = content.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3 && !this.isStopWord(word));

    words.forEach(word => terms.add(word));

    return Array.from(terms);
  }

  private isStopWord(word: string): boolean {
    const stopWords = ['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'an', 'a'];
    return stopWords.includes(word);
  }

  private buildNavigationIndex(manual: UserManual): void {
    // Build index from all sections
    manual.navigation.index = new Map();

    manual.content.sections.forEach(section => {
      const terms = this.extractIndexTerms(section.title + ' ' + section.content);
      terms.forEach(term => {
        if (!manual.navigation.index.has(term)) {
          manual.navigation.index.set(term, []);
        }
        manual.navigation.index.get(term)!.push(section.id);
      });
    });
  }

  searchManual(manualId: string, query: string): Array<{
    sectionId: string;
    title: string;
    snippet: string;
    relevance: number;
  }> {
    const manual = this.manuals.get(manualId);
    if (!manual) return [];

    const queryTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 2);
    const results = new Map<string, { snippet: string; relevance: number }>();

    queryTerms.forEach(term => {
      // Search in index
      const sectionIds = manual.navigation.index.get(term) || [];

      sectionIds.forEach(sectionId => {
        if (!results.has(sectionId)) {
          results.set(sectionId, { snippet: '', relevance: 0 });
        }

        const result = results.get(sectionId)!;
        result.relevance += 1;

        // Find snippet
        const section = manual.content.sections.find(s => s.id === sectionId);
        if (section && !result.snippet) {
          const index = section.content.toLowerCase().indexOf(term);
          if (index !== -1) {
            const start = Math.max(0, index - 50);
            const end = Math.min(section.content.length, index + 50);
            result.snippet = `...${section.content.substring(start, end)}...`;
          }
        }
      });
    });

    return Array.from(results.entries())
      .map(([sectionId, data]) => {
        const section = manual.content.sections.find(s => s.id === sectionId);
        return {
          sectionId,
          title: section?.title || 'Unknown',
          snippet: data.snippet,
          relevance: data.relevance
        };
      })
      .sort((a, b) => b.relevance - a.relevance);
  }

  addFeedback(feedback: Omit<ManualFeedback, 'id'>): void {
    if (!this.feedback.has(feedback.manualId)) {
      this.feedback.set(feedback.manualId, []);
    }

    const feedbackItem: ManualFeedback = {
      ...feedback,
      id: `feedback_${Date.now()}`
    };

    this.feedback.get(feedback.manualId)!.push(feedbackItem);
  }

  getManualFeedback(manualId: string): ManualFeedback[] {
    return this.feedback.get(manualId) || [];
  }

  getFeedbackSummary(manualId: string): {
    averageRating: number;
    totalFeedback: number;
    helpfulPercentage: number;
    commonSuggestions: Array<{ suggestion: string; count: number }>;
  } {
    const feedback = this.getManualFeedback(manualId);

    if (feedback.length === 0) {
      return {
        averageRating: 0,
        totalFeedback: 0,
        helpfulPercentage: 0,
        commonSuggestions: []
      };
    }

    const averageRating = feedback.reduce((sum, f) => sum + f.rating, 0) / feedback.length;
    const helpfulPercentage = (feedback.filter(f => f.helpful).length / feedback.length) * 100;

    // Count common suggestions
    const suggestionCount = new Map<string, number>();
    feedback.forEach(f => {
      f.suggestions.forEach(suggestion => {
        suggestionCount.set(suggestion, (suggestionCount.get(suggestion) || 0) + 1);
      });
    });

    const commonSuggestions = Array.from(suggestionCount.entries())
      .map(([suggestion, count]) => ({ suggestion, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      averageRating,
      totalFeedback: feedback.length,
      helpfulPercentage,
      commonSuggestions
    };
  }

  createDefaultTemplates(): void {
    // Beginner User Manual Template
    this.createManualTemplate({
      name: 'Beginner User Manual',
      audience: 'beginner',
      structure: [
        {
          title: 'Welcome',
          level: 1,
          required: true,
          template: '# Welcome to ${productName}\n\n## What is ${productName}?\n\n${productDescription}\n\n## Key Features\n\n${keyFeatures}\n\n## System Requirements\n\n${requirements}',
          variables: ['productName', 'productDescription', 'keyFeatures', 'requirements'],
          estimatedReadTime: 5
        },
        {
          title: 'Getting Started',
          level: 1,
          required: true,
          template: '# Getting Started\n\n## Installation\n\nFollow these simple steps to install ${productName}:\n\n1. ${step1}\n2. ${step2}\n3. ${step3}\n\n## First Launch\n\n${firstLaunch}\n\n## Basic Setup\n\n${basicSetup}',
          variables: ['step1', 'step2', 'step3', 'firstLaunch', 'basicSetup'],
          estimatedReadTime: 10
        },
        {
          title: 'Your First Project',
          level: 1,
          required: true,
          template: '# Your First Project\n\n## Creating a New Project\n\n${createProject}\n\n## Adding Components\n\n${addComponents}\n\n## Making Connections\n\n${makeConnections}\n\n## Testing Your Design\n\n${testDesign}',
          variables: ['createProject', 'addComponents', 'makeConnections', 'testDesign'],
          estimatedReadTime: 15
        },
        {
          title: 'Basic Operations',
          level: 1,
          required: true,
          template: '# Basic Operations\n\n## Saving Your Work\n\n${savingWork}\n\n## Opening Projects\n\n${openingProjects}\n\n## Basic Editing\n\n${basicEditing}\n\n## Getting Help\n\n${gettingHelp}',
          variables: ['savingWork', 'openingProjects', 'basicEditing', 'gettingHelp'],
          estimatedReadTime: 10
        },
        {
          title: 'Troubleshooting',
          level: 1,
          required: true,
          template: '# Troubleshooting\n\n## Common Issues\n\n${commonIssues}\n\n## Error Messages\n\n${errorMessages}\n\n## Contact Support\n\n${contactSupport}',
          variables: ['commonIssues', 'errorMessages', 'contactSupport'],
          estimatedReadTime: 5
        }
      ],
      styleGuide: {
        tone: 'conversational',
        terminology: {
          'component': 'A building block used in your circuit design',
          'schematic': 'A diagram showing how components are connected',
          'simulation': 'Testing your design virtually before building it'
        },
        formatting: {
          headingStyle: 'clear, large, friendly',
          bodyFont: 'readable, sans-serif',
          codeStyle: 'highlighted, easy to copy',
          noteStyle: 'friendly tip boxes',
          warningStyle: 'gentle caution notices'
        }
      }
    });

    // Advanced User Manual Template
    this.createManualTemplate({
      name: 'Advanced User Manual',
      audience: 'advanced',
      structure: [
        {
          title: 'Advanced Features Overview',
          level: 1,
          required: true,
          template: '# Advanced Features\n\n## Prerequisites\n\nThis manual assumes you have:\n- Basic knowledge of ${domain}\n- Experience with ${prerequisites}\n\n## Advanced Capabilities\n\n${advancedCapabilities}',
          variables: ['domain', 'prerequisites', 'advancedCapabilities'],
          estimatedReadTime: 10
        },
        {
          title: 'Simulation and Analysis',
          level: 1,
          required: true,
          template: '# Simulation and Analysis\n\n## Multi-Physics Simulation\n\n${multiPhysics}\n\n## Advanced Analysis Tools\n\n${analysisTools}\n\n## Optimization Techniques\n\n${optimization}',
          variables: ['multiPhysics', 'analysisTools', 'optimization'],
          estimatedReadTime: 20
        },
        {
          title: 'Integration and APIs',
          level: 1,
          required: true,
          template: '# Integration and APIs\n\n## API Reference\n\n${apiReference}\n\n## Third-Party Integrations\n\n${integrations}\n\n## Custom Scripting\n\n${scripting}',
          variables: ['apiReference', 'integrations', 'scripting'],
          estimatedReadTime: 15
        },
        {
          title: 'Performance Tuning',
          level: 1,
          required: true,
          template: '# Performance Tuning\n\n## Memory Optimization\n\n${memoryOptimization}\n\n## Computation Acceleration\n\n${acceleration}\n\n## Large Project Handling\n\n${largeProjects}',
          variables: ['memoryOptimization', 'acceleration', 'largeProjects'],
          estimatedReadTime: 15
        },
        {
          title: 'Troubleshooting Advanced Issues',
          level: 1,
          required: true,
          template: '# Advanced Troubleshooting\n\n## Debug Tools\n\n${debugTools}\n\n## Performance Issues\n\n${performanceIssues}\n\n## Integration Problems\n\n${integrationProblems}',
          variables: ['debugTools', 'performanceIssues', 'integrationProblems'],
          estimatedReadTime: 10
        }
      ],
      styleGuide: {
        tone: 'technical',
        terminology: {
          'API': 'Application Programming Interface',
          'simulation': 'Computational modeling of physical systems',
          'optimization': 'Mathematical techniques to improve design performance'
        },
        formatting: {
          headingStyle: 'technical, hierarchical',
          bodyFont: 'monospace for code, serif for text',
          codeStyle: 'syntax highlighted, line numbered',
          noteStyle: 'technical notes and warnings',
          warningStyle: 'critical safety and performance warnings'
        }
      }
    });

    // Developer Manual Template
    this.createManualTemplate({
      name: 'Developer Manual',
      audience: 'developer',
      structure: [
        {
          title: 'Developer Environment Setup',
          level: 1,
          required: true,
          template: '# Development Environment\n\n## Prerequisites\n\n${prerequisites}\n\n## Installation\n\n${installation}\n\n## Development Tools\n\n${devTools}\n\n## Building from Source\n\n${building}',
          variables: ['prerequisites', 'installation', 'devTools', 'building'],
          estimatedReadTime: 15
        },
        {
          title: 'Architecture Overview',
          level: 1,
          required: true,
          template: '# Architecture\n\n## System Architecture\n\n${systemArchitecture}\n\n## Component Design\n\n${componentDesign}\n\n## Data Flow\n\n${dataFlow}\n\n## API Design\n\n${apiDesign}',
          variables: ['systemArchitecture', 'componentDesign', 'dataFlow', 'apiDesign'],
          estimatedReadTime: 20
        },
        {
          title: 'API Documentation',
          level: 1,
          required: true,
          template: '# API Reference\n\n## Core APIs\n\n${coreAPIs}\n\n## Plugin APIs\n\n${pluginAPIs}\n\n## Extension Points\n\n${extensionPoints}\n\n## Code Examples\n\n${codeExamples}',
          variables: ['coreAPIs', 'pluginAPIs', 'extensionPoints', 'codeExamples'],
          estimatedReadTime: 25
        },
        {
          title: 'Plugin Development',
          level: 1,
          required: true,
          template: '# Plugin Development\n\n## Plugin Architecture\n\n${pluginArchitecture}\n\n## Creating Plugins\n\n${creatingPlugins}\n\n## Plugin APIs\n\n${pluginAPIs}\n\n## Best Practices\n\n${bestPractices}',
          variables: ['pluginArchitecture', 'creatingPlugins', 'pluginAPIs', 'bestPractices'],
          estimatedReadTime: 20
        },
        {
          title: 'Testing and Debugging',
          level: 1,
          required: true,
          template: '# Testing and Debugging\n\n## Unit Testing\n\n${unitTesting}\n\n## Integration Testing\n\n${integrationTesting}\n\n## Debug Tools\n\n${debugTools}\n\n## Performance Profiling\n\n${profiling}',
          variables: ['unitTesting', 'integrationTesting', 'debugTools', 'profiling'],
          estimatedReadTime: 15
        }
      ],
      styleGuide: {
        tone: 'technical',
        terminology: {
          'API': 'Application Programming Interface',
          'SDK': 'Software Development Kit',
          'plugin': 'Modular software component',
          'extension': 'Additional functionality'
        },
        formatting: {
          headingStyle: 'technical, structured',
          bodyFont: 'monospace for code and commands',
          codeStyle: 'syntax highlighted, executable',
          noteStyle: 'developer notes and tips',
          warningStyle: 'security and compatibility warnings'
        }
      }
    });
  }

  getManual(id: string): UserManual | undefined {
    return this.manuals.get(id);
  }

  getTemplate(id: string): UserManualTemplate | undefined {
    return this.templates.get(id);
  }

  getAllManuals(): UserManual[] {
    return Array.from(this.manuals.values());
  }

  getAllTemplates(): UserManualTemplate[] {
    return Array.from(this.templates.values());
  }

  getManualsByAudience(audience: UserManual['targetAudience']): UserManual[] {
    return this.getAllManuals().filter(manual => manual.targetAudience === audience);
  }

  getManualsByLanguage(language: string): UserManual[] {
    return this.getAllManuals().filter(manual => manual.language === language);
  }

  getManualTranslations(manualId: string): UserManual['translations'] {
    const manual = this.manuals.get(manualId);
    return manual?.translations || [];
  }

  updateManualAccessibility(manualId: string, accessibility: Partial<UserManual['accessibility']>): boolean {
    const manual = this.manuals.get(manualId);
    if (!manual) return false;

    Object.assign(manual.accessibility, accessibility);
    return true;
  }
}

export const userManualManager = new UserManualManager();