// Bridge between the JupyterLab application and the widget.
//
// The ipywidgets view runs inside a notebook output area and has no direct
// handle to the JupyterLab application. The lab plugin's activate() receives
// the app (and thus its command registry), so we stash the command registry
// here at activation time.
//
// Moving the notebook selection off the auth cell after sign-in is subtle:
// `notebook:move-cursor-down` moves relative to whatever cell is *currently
// active*, which is unreliable after the user has clicked a button inside the
// widget's output area. To be deterministic we first re-anchor selection on
// the cell that actually contains this widget (found from the view's DOM
// node), then move down from there.
//
// Everything here degrades gracefully: outside JupyterLab, or if the pieces
// are missing, the helpers are no-ops and never throw.

let commandRegistry = null;

/**
 * Called by the lab plugin at activation with app.commands.
 * @param {object} commands - JupyterLab CommandRegistry (app.commands)
 */
export const setCommandRegistry = (commands) => {
    commandRegistry = commands || null;
};

/** True if the registry can run the given command. */
const canRun = (name) =>
    !!commandRegistry &&
    typeof commandRegistry.execute === 'function' &&
    (typeof commandRegistry.hasCommand !== 'function' || commandRegistry.hasCommand(name));

/**
 * Walk up from a starting element to the enclosing notebook cell node.
 * @param {Element|null} startEl
 * @returns {Element|null} the `.jp-Cell` element, or null.
 */
export const findCellNode = (startEl) => {
    let el = startEl;
    while (el && el.classList) {
        if (el.classList.contains('jp-Cell')) {
            return el;
        }
        el = el.parentElement;
    }
    return null;
};

/**
 * Move the notebook selection to the cell *after* the one containing this
 * widget, so the user does not accidentally re-run the auth cell after
 * signing in.
 *
 * @param {object} view - the ipywidgets DOMWidgetView (needs view.el).
 * @returns {boolean} true if the selection was moved, false otherwise.
 */
export const focusNextCell = (view) => {
    if (!canRun('notebook:move-cursor-down')) {
        console.debug('ipyauth: notebook:move-cursor-down unavailable — skipping focus move');
        return false;
    }

    try {
        // Re-anchor selection on the auth cell before moving down. Focusing the
        // cell node makes JupyterLab treat it as the active cell; without this,
        // "move down" starts from wherever the last click left the selection.
        const cellNode = view && view.el ? findCellNode(view.el) : null;
        if (cellNode) {
            if (typeof cellNode.scrollIntoView === 'function') {
                cellNode.scrollIntoView({ block: 'nearest' });
            }
            // A cell node is focusable in JupyterLab (tabindex). Focusing it
            // selects the cell in the notebook model.
            if (typeof cellNode.focus === 'function') {
                cellNode.focus();
            }
        } else {
            console.debug('ipyauth: could not locate the auth cell node from the widget');
        }

        // Leave edit mode so the selection moves between cells rather than
        // editing text within the current cell.
        if (canRun('notebook:enter-command-mode')) {
            commandRegistry.execute('notebook:enter-command-mode');
        }
        commandRegistry.execute('notebook:move-cursor-down');
        return true;
    } catch (err) {
        console.debug('ipyauth: could not move focus to the next cell', err);
        return false;
    }
};

export default { setCommandRegistry, focusNextCell, findCellNode };
