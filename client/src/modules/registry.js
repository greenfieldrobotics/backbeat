// Module registry — the single place that lists the app's feature modules.
// To add a module: create modules/<name>/module.jsx and add it to this array.
import stash from './stash/module.jsx';
import gear from './gear/module.jsx';

export const modules = [stash, gear];
