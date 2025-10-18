import React, { useState } from 'react';
import { X } from 'lucide-react';

interface ComponentInstance {
  id: string;
  reference: string;
  component: {
    name: string;
    category: string;
  };
  properties: Record<string, any>;
}

interface PropertiesPanelProps {
  component: ComponentInstance | null;
  onUpdate: (id: string, properties: Record<string, any>) => void;
  onClose: () => void;
}

export default function PropertiesPanel({ component, onUpdate, onClose }: PropertiesPanelProps) {
  const [properties, setProperties] = useState(component?.properties || {});

  if (!component) return null;

  const handleChange = (key: string, value: string) => {
    const updated = { ...properties, [key]: value };
    setProperties(updated);
  };

  const handleSave = () => {
    onUpdate(component.id, properties);
    onClose();
  };

  return (
    <div className="absolute top-0 right-0 w-80 h-full bg-white border-l border-gray-200 shadow-lg">
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900">Properties</h3>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <X size={20} className="text-gray-500" />
        </button>
      </div>

      <div className="p-4 space-y-4 overflow-y-auto h-[calc(100%-8rem)]">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Reference
          </label>
          <input
            type="text"
            value={component.reference}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50"
            disabled
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Component Type
          </label>
          <input
            type="text"
            value={component.component.name}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50"
            disabled
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Category
          </label>
          <input
            type="text"
            value={component.component.category}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50"
            disabled
          />
        </div>

        <div className="pt-4 border-t border-gray-200">
          <h4 className="text-sm font-semibold text-gray-900 mb-3">Component Properties</h4>
          {Object.entries(properties).map(([key, value]) => (
            <div key={key} className="mb-3">
              <label className="block text-sm font-medium text-gray-700 mb-1 capitalize">
                {key.replace(/_/g, ' ')}
              </label>
              <input
                type="text"
                value={value as string}
                onChange={(e) => handleChange(key, e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-200 bg-white">
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
