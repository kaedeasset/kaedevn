import { describe, it, expect } from 'vitest';
import { compile } from '../src/index.js';

describe('Map Command Compilation', () => {
  it('should compile @map_load with various arguments', () => {
    const source = `@map_load map-001 5 10 up fade 500`;
    const result = compile(source);

    expect(result.ops[0]).toEqual({
      op: 'MAP_LOAD',
      id: 'map-001',
      x: 5,
      y: 10,
      direction: 'up',
      fadeMs: 500
    });
  });

  it('should compile @map_load with only id', () => {
    const source = `@map_load village`;
    const result = compile(source);

    expect(result.ops[0]).toEqual({
      op: 'MAP_LOAD',
      id: 'village',
      x: undefined,
      y: undefined,
      direction: undefined
    });
  });

  it('should compile @map_exit', () => {
    const source = `@map_exit`;
    const result = compile(source);

    expect(result.ops[0]).toEqual({ op: 'MAP_EXIT' });
  });

  it('should compile @player_move', () => {
    const source = `@player_move right 3`;
    const result = compile(source);

    expect(result.ops[0]).toEqual({
      op: 'PLAYER_MOVE',
      direction: 'right',
      steps: 3
    });
  });

  it('should compile @event_move', () => {
    const source = `@event_move npc-01 15 20 1000`;
    const result = compile(source);

    expect(result.ops[0]).toEqual({
      op: 'EVENT_MOVE',
      eventId: 'npc-01',
      x: 15,
      y: 20,
      durationMs: 1000
    });
  });

  it('should compile @item_add', () => {
    const source = `@item_add potion 1`;
    const result = compile(source);

    expect(result.ops[0]).toEqual({
      op: 'ITEM_ADD',
      id: 'potion',
      amount: 1
    });
  });

  it('should compile @item_remove', () => {
    const source = `@item_remove sword 1`;
    const result = compile(source);

    expect(result.ops[0]).toEqual({
      op: 'ITEM_REMOVE',
      id: 'sword',
      amount: 1
    });
  });
});
