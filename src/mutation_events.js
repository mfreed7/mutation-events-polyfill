// Copyright (c) 2023, Mason Freed
// All rights reserved.
//
// This source code is licensed under the BSD-style license found in the
// LICENSE file in the root directory of this source tree.

// This is a polyfill of the Mutation Events:
//   - DOMCharacterDataModified
//   - DOMNodeInserted
//   - DOMNodeInsertedIntoDocument
//   - DOMNodeRemoved
//   - DOMNodeRemovedFromDocument
//   - DOMSubtreeModified
//
// Usage:
// To use this polyfill, simply load it before any calls to `addEventListener`
// for Mutation Events:
//
//   ```html
//   <script src="mutation_events.js"></script>
//   <div id=target></div>
//   <script>
//   target.addEventListener('DOMNodeInserted',() => {});
//   </script>
//   ```
//
// The implementation uses Mutation Observer, which should be well supported
// by all evergreen browsers.
//
// There is no standard for Mutation Events, and indeed there are some
// differences between rendering engines. This polyfill is based on the
// behavior of Chrome v115, which differs from Safari and Firefox in a
// few ways:
//   1. Firefox does not fire DOMNodeInsertedIntoDocument or
//      DOMNodeRemovedFromDocument. Chrome and Safari do. This polyfill does.
//   2. Firefox fires DOMSubtreeModified events when attributes are modified
//      via target.setAttribute(), but not when changed directly via
//      target.attributes[0].value=. Chrome and Safari do not fire events
//      in either of those cases, and neither does this polyfill.
//   3. Chrome and Safari fire two sets of DOMSubtreeModified events when
//      replaceChildren() is called, but the second set is fired at different
//      times. Firefox only fires a single set of DOMSubtreeModified events.
//      This polyfill fires events as fired by Chrome.
//   4. Generally, Firefox fires bubble listeners before capture listeners
//      on the target node, which seems broken anyway. This polyfill fires
//      capture before bubble.
//
// ## Known Issues
//
// There are necessary differences between the behavior of Mutation Events
// and this polyfill using Mutation Observer. Primarily, the difference is in
// the timing: Mutation Events are synchronous, and happen *during* the
// mutation, while Mutation Observers are fired at microtask timing. One place
// where this leads to observable differences is during the DOMNodeRemoved
// event. Real DOMNodeRemoved events are fired before the node is removed from
// its parent, while this polyfill fires those after the removal is complete.
// That leads to the event needing to be fired two places - on the removed
// node and *also* on the observed target, because ordinarily the event bubbles
// from the former to the latter.

// Mutation events, for a listener on `target`:
//  DOMNodeInserted: fired whenever a node is inserted into a new parent. This
//                   event bubbles up through the *NEW* parent.
//  DOMNodeRemoved: fired whenever a node is removed from a parent. This event
//                  bubbles up through the *OLD* parent.
//  DOMSubtreeModified: fired whenever any node in the SUBTREE of `target` is
//                  modified, including: a) node inserted, b) node removed,
//                  c) attributes added, d) attributes removed, or e) character
//                  data modified. This event is also fired when attributes are
//                  added or removed from `target`. It is not fired when
//                  existing attributes are changed.
//  DOMNodeInsertedIntoDocument: fired whenever a node is inserted. This event
//                               does not bubble, but is fired on every sub-node
//                               in the inserted tree, plus the (new) parent of
//                               the inserted tree.
//  DOMNodeRemovedFromDocument: fired whenever a node is removed. This event
//                               does not bubble, but is fired on every sub-node
//                               in the removed tree, plus the (old) parent of
//                               the removed tree.
//  DOMCharacterDataModified: fired whenever a text/comment node has its data
//                            modified.

(function() {
  // Check if Mutation Events are supported by the browser
  if ("MutationEvent" in window) {
    return;
  }
  // Only run once
  if (window.mutationEventsPolyfillInstalled) {
    return;
  }
  window.mutationEventsPolyfillInstalled = true;

  const mutationEvents = new Set([
    'DOMCharacterDataModified',
    'DOMNodeInserted',
    'DOMNodeInsertedIntoDocument',
    'DOMNodeRemoved',
    'DOMNodeRemovedFromDocument',
    'DOMSubtreeModified',
  ]);
  // Fire non-standard events so that deprecation warnings aren't fired in
  // the browser.
  const polyfillEventNameExtension = 'Polyfilled';

  const baseEventObj = {
    attrChange: 0, bubbles: true, cancelable: false, newValue: '', prevValue: '', relatedNode: null
  }
  function dispatchMutationEvent(type, target, options, fakeTarget) {
    let newEvent = Object.assign({}, baseEventObj);
    if (options) {
      newEvent = Object.assign(newEvent, options);
    }
    const event = new Event(type + polyfillEventNameExtension,newEvent);
    event.attrChange = newEvent.attrChange;
    event.newValue = newEvent.newValue;
    event.prevValue = newEvent.prevValue;
    event.relatedNode = newEvent.relatedNode;
    if (fakeTarget) {
      Object.defineProperty(event, 'target', {writable: false, value: fakeTarget});
    }
    target.dispatchEvent(event);
  }

  function walk(n,action) {
    const walker = document.createTreeWalker(n, NodeFilter.SHOW_ALL);
    do {
      action(walker.currentNode);
    } while (walker.nextNode());
  }

  const documentsToObservers = new Map();
  const listeningNodes = new Set();

  function handleMutations(mutations) {
    const subtreeModified = [];
    mutations.forEach(function (mutation) {
      const target = mutation.target;
      const type = mutation.type;
      // console.log('target:', target, mutation);
      if (type === "attributes") {
        // Attribute changes only fire DOMSubtreeModified, and only if the attribute
        // is being added or removed, and not just changed.
        if (mutation.oldValue === null || target.getAttribute(mutation.attributeName) === null) {
          dispatchMutationEvent('DOMSubtreeModified', target, {attributeName: mutation.attributeName});
        }
      } else if (type === "characterData") {
        dispatchMutationEvent('DOMCharacterDataModified', target, {prevValue: mutation.oldValue,newValue: target.textContent});
        subtreeModified.push(target);
      } else if (type === "childList") {
        mutation.removedNodes.forEach(n => {
          subtreeModified.push(target);
          dispatchMutationEvent('DOMNodeRemoved', n);
          // The actual DOMNodeRemoved event is fired *before* the node is
          // removed, which means it bubbles up to old parents. However,
          // Mutation Observer fires after the fact. So we need to fire the
          // regular DOMNodeRemoved event on the removed node, but then fire
          // another "fake" DOMNodeRemoved event on the parent, to simulate
          // bubbling.
          dispatchMutationEvent('DOMNodeRemoved', target, undefined, n);

          // Dispatch DOMNodeRemovedFromDocument on all removed nodes
          walk(n, (node) => dispatchMutationEvent('DOMNodeRemovedFromDocument', node, {bubbles: false}));
          // In the same way as for DOMNodeRemoved, we also fire DOMNodeRemovedFromDocument
          // on the parent node.
          dispatchMutationEvent('DOMNodeRemovedFromDocument', target, {bubbles: false}, n);
        });
        mutation.addedNodes.forEach(n => {
          subtreeModified.push(target);
          dispatchMutationEvent('DOMNodeInserted', n);

          // Dispatch DOMNodeInsertedIntoDocument on all inserted nodes
          walk(n, (node) => dispatchMutationEvent('DOMNodeInsertedIntoDocument', node, {bubbles: false}));
        });
      }
    });
    for(let touchedNode of subtreeModified) {
      dispatchMutationEvent('DOMSubtreeModified', touchedNode);
    }
  }

  function getRootElement(el) {
    let rootNode = el.getRootNode();
    while (rootNode instanceof ShadowRoot) {
      rootNode = rootNode.host.getRootNode();
    }
    if (rootNode instanceof Document) {
      return rootNode.documentElement;
    }
    // Disconnected element - likely has problems.
    return rootNode;
  }

  const observerOptions = {subtree: true, childList: true, attributes: true, attributeOldValue: true, characterData: true, characterDataOldValue: true};
  function enableMutationEventPolyfill(target) {
    if (listeningNodes.has(target))
      return;
    listeningNodes.add(target);
    const rootElement = getRootElement(target);
    if (documentsToObservers.has(rootElement)) {
      documentsToObservers.get(rootElement).count++;
      return;
    }
    const observer = new MutationObserver(handleMutations);
    documentsToObservers.set(rootElement, {observer,count: 1});
    observer.observe(rootElement, observerOptions);
  }

  function disableMutationEventPolyfill(target) {
    if (!listeningNodes.has(target))
      return;
    listeningNodes.delete(target);
    const rootElement = getRootElement(target);
    if (!documentsToObservers.has(rootElement))
      return;
    if (--documentsToObservers.get(rootElement).count === 0) {
      const observer = documentsToObservers.get(rootElement).observer;
      documentsToObservers.delete(rootElement);
      observer.disconnect();
    }
  }

  // Monkeypatch addEventListener/removeEventListener
  const originalAddEventListener = Element.prototype.addEventListener;
  function getAugmentedListener(eventName, listener, options) {
    if (mutationEvents.has(eventName)) {
      return {fullEventName: eventName + polyfillEventNameExtension,
        augmentedListener: (event) => {
        // Remove polyfillEventNameExtension:
        Object.defineProperty(event, 'type', {writable: false, value: eventName});
        listener(event);
      }};
    }
    return {fullEventName: eventName,augmentedListener: listener};
  }
  Element.prototype.addEventListener = function(eventName, listener, options) {
    if (mutationEvents.has(eventName)) {
      enableMutationEventPolyfill(this);
      const {augmentedListener,fullEventName} = getAugmentedListener(...arguments);
      originalAddEventListener.apply(this, [fullEventName, augmentedListener, options]);
      return;
    }
    originalAddEventListener.apply(this, arguments);
  };
  const originalRemoveEventListener = window.removeEventListener;
  Element.prototype.removeEventListener = function(eventName, listener, options) {
    if (mutationEvents.has(eventName)) {
      disableMutationEventPolyfill(this);
      const {augmentedListener,fullEventName} = getAugmentedListener(...arguments);
      originalRemoveEventListener.apply(this, [fullEventName, augmentedListener, options]);
      return;
    }
    originalRemoveEventListener.apply(this, arguments);
  };

  console.log('Mutation Events polyfill installed.');
})();
