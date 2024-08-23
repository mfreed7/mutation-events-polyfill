// Copyright (c) 2024, Mason Freed
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
// See the readme for documentation and implementation details:
//   https://github.com/mfreed7/mutation-events-polyfill#readme

(function() {
  // Only run once
  if (window.mutationEventsPolyfillInstalled) {
    return;
  }
  window.mutationEventsPolyfillInstalled = true;
  // If the feature is already natively supported, use it instead.
  const nativeFeatureSupported = "MutationEvent" in window;
  if (nativeFeatureSupported && !window.mutationEventsUsePolyfillAlways) {
    return;
  }

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

  // Helper function to avoid errors when has doesn't exist
  function hasTarget(elem, target) {
    return elem && elem.has && elem.has(target)
  }

  const observerOptions = {subtree: true, childList: true, attributes: true, attributeOldValue: true, characterData: true, characterDataOldValue: true};
  function enableMutationEventPolyfill(target) {
    if (hasTarget(listeningNodes, target))
      return;
    listeningNodes.add(target);
    const rootElement = getRootElement(target);
    if (hasTarget(documentsToObservers, rootElement)) {
      documentsToObservers.get(rootElement).count++;
      return;
    }
    const observer = new MutationObserver(handleMutations);
    documentsToObservers.set(rootElement, {observer,count: 1});
    observer.observe(rootElement, observerOptions);
  }

  function disableMutationEventPolyfill(target) {
    if (!hasTarget(listeningNodes, target))
      return;
    listeningNodes.delete(target);
    const rootElement = getRootElement(target);
    if (!hasTarget(documentsToObservers, rootElement))
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
    if (hasTarget(mutationEvents, eventName)) {
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
    if (hasTarget(mutationEvents, eventName)) {
      enableMutationEventPolyfill(this);
      const {augmentedListener,fullEventName} = getAugmentedListener(eventName, listener, options);
      originalAddEventListener.apply(this, [fullEventName, augmentedListener, options]);
      return;
    }
    originalAddEventListener.call(this, eventName, listener, options);
  };
  const originalRemoveEventListener = window.removeEventListener;
  Element.prototype.removeEventListener = function(eventName, listener, options) {
    if (hasTarget(mutationEvents, eventName)) {
      disableMutationEventPolyfill(this);
      const {augmentedListener,fullEventName} = getAugmentedListener(eventName, listener, options);
      originalRemoveEventListener.apply(this, [fullEventName, augmentedListener, options]);
      return;
    }
    originalRemoveEventListener.call(this, eventName, listener, options);
  };

  // This makes things like MutationEvent.MODIFICATION not throw.
  window.MutationEvent = class extends CustomEvent {
    constructor(type,dict) {
      if (type !== "MagicString") {
        throw("Illegal constructor");
      }
      super('',dict);
    }
    initMutationEvent(...args) {
      this.initCustomEvent(...args);
    }
    static MODIFICATION = 1;
    static ADDITION = 2;
    static REMOVAL = 3;
  }
  window.initMutationEvent = () => new MutationEvent();
  const originalCreateEvent = Document.prototype.createEvent;
  Document.prototype.createEvent = function(type,...args) {
    if (type === "MutationEvent") {
      return new MutationEvent("MagicString");
    }
    return originalCreateEvent.call(this,type,...args);
  };

  console.log(`Mutation Events polyfill installed (native feature: ${nativeFeatureSupported ? "supported" : "not present"}).`);

})();
