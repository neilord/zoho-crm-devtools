/**
 * Main-world bridge for "Edit in CRM".
 *
 * The isolated content script injects this file as a page <script> (it is listed
 * in the manifest `web_accessible_resources`), so it runs in the page's own
 * JavaScript world and can reach Zoho globals the content script cannot:
 * `Lyte.Router` and `customFunctionsObj`. It stays passive until the overlay
 * posts a matching `window.postMessage`, then drives Zoho's router and function
 * editor exactly as Zoho's own UI would. It never touches `chrome.*`.
 *
 * This is plain JS on purpose: it executes in the untyped page world and is
 * delivered verbatim from `public/`, which sidesteps the bundler's broken
 * `world: "MAIN"` loader (its relative import resolves against the page origin).
 *
 * The message source/action below must stay in sync with
 * `src/content/functions/messaging.ts`.
 */
(function () {
  'use strict';

  var MESSAGE_SOURCE = 'zcdt-function-search';
  var FUNCTIONS_ROUTE = 'crm.settings.section.functions.myFunctions';
  var EDITOR_WRAPPER_SELECTOR = 'crm-deluge-editor-wrapper';
  var MAX_EDITOR_WAIT_ATTEMPTS = 10;
  var EDITOR_WAIT_INTERVAL_MS = 1000;

  // Waits for both `Lyte.Router` and `customFunctionsObj` together, then
  // transitions and renders in the same attempt. Zoho may still be bootstrapping
  // right after a fresh install or page load, so treating the transition as a
  // one-shot fired up front (independent of this retry loop) risks navigating
  // before the route is ready and then rendering the editor into whatever is
  // on screen once `customFunctionsObj` shows up seconds later, leaving a blank
  // screen instead of the functions view.
  function openEditor(detail, attempt) {
    attempt = attempt || 0;
    var router = window.Lyte && window.Lyte.Router;
    var customFunctions = window.customFunctionsObj;

    if (router && typeof router.transitionTo === 'function' && customFunctions) {
      try {
        router.transitionTo(FUNCTIONS_ROUTE);
        if (document.querySelector(EDITOR_WRAPPER_SELECTOR)) {
          customFunctions.leavePage('close');
        }
        customFunctions.renderEditorView(JSON.stringify(detail), '', '', 'edit');
        return;
      } catch (error) {
        // `Lyte.Router`/`customFunctionsObj` existing doesn't mean everything
        // they depend on has finished loading: Zoho's dashboard bootstrap can
        // still be missing internal pieces (its own router-transition hooks,
        // its CodeMirror chunk) this early, which throws deep inside Zoho's
        // own code instead of signaling not-ready the way a missing
        // `customFunctionsObj` does. There is no fixed list of these internal
        // globals to check for up front, so treat any failed attempt the same
        // as not-ready and retry, rather than leaving a half-rendered editor
        // stuck once Zoho's own code throws.
        console.warn('Zoho CRM DevTools: editor attempt failed, retrying', error);
      }
    }

    if (attempt < MAX_EDITOR_WAIT_ATTEMPTS) {
      window.setTimeout(function () {
        openEditor(detail, attempt + 1);
      }, EDITOR_WAIT_INTERVAL_MS);
    } else {
      console.info('Zoho CRM DevTools: function editor was unavailable.');
    }
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window) {
      return;
    }
    var data = event.data;
    if (!data || data.source !== MESSAGE_SOURCE || data.action !== 'editInCrm') {
      return;
    }

    openEditor(data.detail);
  });
})();
