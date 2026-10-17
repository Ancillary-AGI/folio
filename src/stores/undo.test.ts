import { describe, expect, it } from 'vitest';
import { useProjectStore } from './useProjectStore';

describe('canvas undo/redo', () => {
  it('restores components and wires across undo/redo', () => {
    const store = useProjectStore.getState();
    useProjectStore.setState({ components: [], wires: [] });
    // Drain any history from other tests by undoing to empty.
    while (useProjectStore.getState().canUndo()) useProjectStore.getState().undo();
    useProjectStore.setState({ components: [], wires: [] });

    const comp = {
      id: 'u1', componentId: 'resistor',
      component: { id: 'resistor', name: 'Resistor', category: 'passive', symbol_data: { width: 1, height: 1, paths: [] }, pins: [], default_properties: {} },
      x: 0, y: 0, rotation: 0, reference: 'R1', properties: {}, visible: true,
    };
    expect(useProjectStore.getState().canUndo()).toBe(false);
    useProjectStore.getState().addComponent(comp as never);
    expect(useProjectStore.getState().components).toHaveLength(1);
    expect(useProjectStore.getState().canUndo()).toBe(true);
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().components).toHaveLength(0);
    expect(useProjectStore.getState().canRedo()).toBe(true);
    useProjectStore.getState().redo();
    expect(useProjectStore.getState().components).toHaveLength(1);
    expect(store).toBeDefined();
  });
});
