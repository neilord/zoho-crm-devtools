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

  function openEditor(detail, attempt) {
    attempt = attempt || 0;
    var customFunctions = window.customFunctionsObj;
    if (customFunctions) {
      if (document.querySelector(EDITOR_WRAPPER_SELECTOR)) {
        customFunctions.leavePage('close');
      }
      customFunctions.renderEditorView(detail, '', '', 'edit');
      return;
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

    var router = window.Lyte && window.Lyte.Router;
    if (router && typeof router.transitionTo === 'function') {
      router.transitionTo(FUNCTIONS_ROUTE);
    }
    openEditor(data.detail);
  });
})();
