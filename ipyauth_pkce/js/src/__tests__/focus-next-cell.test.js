/**
 * Feature: focus next cell after sign-in
 *
 * After a successful login the widget should move the notebook selection off
 * the auth cell (so the user does not accidentally re-run sign-in). This is
 * done via the JupyterLab command registry captured by the lab plugin, after
 * first re-anchoring selection on the cell that contains the widget (found
 * from the view's DOM node).
 *
 * focusNextCell must degrade gracefully: no registry, missing command, or a
 * throwing execute() must never propagate an error, and must return false.
 */
import { setCommandRegistry, focusNextCell, findCellNode } from '../app_commands.js';

// Build a fake widget view whose el is nested inside a .jp-Cell node.
function makeViewInCell() {
    const cell = document.createElement('div');
    cell.className = 'jp-Cell jp-CodeCell';
    cell.tabIndex = -1;
    const output = document.createElement('div');
    output.className = 'jp-OutputArea';
    const el = document.createElement('div');
    output.appendChild(el);
    cell.appendChild(output);
    document.body.appendChild(cell);
    return { view: { el }, cell };
}

describe('findCellNode', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('walks up to the enclosing .jp-Cell node', () => {
        const { view, cell } = makeViewInCell();
        expect(findCellNode(view.el)).toBe(cell);
    });

    it('returns null when there is no enclosing cell', () => {
        const orphan = document.createElement('div');
        expect(findCellNode(orphan)).toBeNull();
    });

    it('returns null for null input', () => {
        expect(findCellNode(null)).toBeNull();
    });
});

describe('focusNextCell (post-login cell focus)', () => {
    afterEach(() => {
        setCommandRegistry(null);
        document.body.innerHTML = '';
    });

    it('returns false and does nothing when no registry is set', () => {
        setCommandRegistry(null);
        expect(focusNextCell({ el: document.createElement('div') })).toBe(false);
    });

    it('focuses the auth cell, enters command mode, then moves the cursor down', () => {
        const executed = [];
        setCommandRegistry({
            hasCommand: () => true,
            execute: (cmd) => executed.push(cmd),
        });
        const { view, cell } = makeViewInCell();
        const focusSpy = jest.spyOn(cell, 'focus');

        expect(focusNextCell(view)).toBe(true);
        expect(focusSpy).toHaveBeenCalledTimes(1);
        expect(executed).toEqual(['notebook:enter-command-mode', 'notebook:move-cursor-down']);
    });

    it('still moves down when the widget is not inside a cell (no crash)', () => {
        const executed = [];
        setCommandRegistry({
            hasCommand: () => true,
            execute: (cmd) => executed.push(cmd),
        });

        expect(focusNextCell({ el: document.createElement('div') })).toBe(true);
        expect(executed).toContain('notebook:move-cursor-down');
    });

    it('returns false when the move-cursor-down command is not registered', () => {
        const executed = [];
        setCommandRegistry({
            hasCommand: (cmd) => cmd !== 'notebook:move-cursor-down',
            execute: (cmd) => executed.push(cmd),
        });

        expect(focusNextCell({ el: document.createElement('div') })).toBe(false);
        expect(executed).toEqual([]);
    });

    it('swallows errors thrown by execute() and returns false', () => {
        setCommandRegistry({
            hasCommand: () => true,
            execute: () => {
                throw new Error('boom');
            },
        });

        expect(() => focusNextCell({ el: document.createElement('div') })).not.toThrow();
        expect(focusNextCell({ el: document.createElement('div') })).toBe(false);
    });
});
