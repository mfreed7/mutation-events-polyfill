// Copyright (c) 2023, Mason Freed
// All rights reserved.
//
// This source code is licensed under the BSD-style license found in the
// LICENSE file in the root directory of this source tree.

(function() {
  // Check if Mutation Events are supported by the browser
  if ("MutationEvent" in window) {
    window.disableMutationEventPolyfillForTesting = () => {};
    return;
  }
  // Only run once
  if (window.mutationEventsPolyfillInstalled) {
    return;
  }
  window.mutationEventsPolyfillInstalled = true;

  const mutationEvents = [
    'DOMCharacterDataModified',
    'DOMNodeInserted',
    'DOMNodeInsertedIntoDocument',
    'DOMNodeRemoved',
    'DOMNodeRemovedFromDocument',
    'DOMSubtreeModified',
  ];

  function dispatchMutationEvent(type, target, options, fakeTarget) {
    const event = new Event(type,options);
    if (fakeTarget) {
      Object.defineProperty(event, 'target', {writable: false, value: fakeTarget});
    }
    target.dispatchEvent(event);
  }

  function handleMutations(actualTarget, mutations) {
    mutations.forEach(function (mutation) {
      const target = mutation.target;
      const type = mutation.type;
      let options = {
        bubbles: true,
        cancelable: true,
        relatedNode: null,
        prevValue: null,
        newValue: null,
        attributeName: null,
        attrChange: null,
      };

      // Set options based on mutation type
      console.log(mutation);
      const is_contained = actualTarget === target || actualTarget.contains(target);

      if (type === "childList") {
        let firedRemoved = false;
        mutation.removedNodes.forEach(n => {
          if (n === actualTarget || target === actualTarget) {
            firedRemoved = true;
            dispatchMutationEvent('DOMNodeRemoved', n, options);
            if (target === actualTarget) {
              // The actual DOMNodeRemoved event is fired *before* the node is
              // removed, which means it bubbles up to old parents. However,
              // Mutation Observer fires after the fact. So we need to fire a
              // DOMNodeRemoved on the disconnected node, *plus* fire a fake
              // one at actualTarget with a "fake" target of the removed node.
              dispatchMutationEvent('DOMNodeRemoved', actualTarget, options, n);
            }
            // This should be conditional on being in the document before!
            if (n === actualTarget && !actualTarget.isConnected) {
              dispatchMutationEvent('DOMNodeRemovedFromDocument', actualTarget, options);
            }
          }
        });
        if (firedRemoved && actualTarget===target) {
          options.relatedNode = target; // FIX ME! options should be a function that sets defaults and takes overrides
          dispatchMutationEvent('DOMSubtreeModified', actualTarget, options);
        }
        let firedInserted = false;
        mutation.addedNodes.forEach(n => {
          if (n === actualTarget || target === actualTarget) {
            firedInserted = true;
            dispatchMutationEvent('DOMNodeInserted', n, options);
            // This should be conditional on not being in the document before!
            if (n === actualTarget && actualTarget.isConnected) {
              dispatchMutationEvent('DOMNodeInsertedIntoDocument', actualTarget, options);
            }
          }
        });
        if (firedInserted && actualTarget===target) {
          options.relatedNode = target; // FIX ME! options should be a function that sets defaults and takes overrides
          dispatchMutationEvent('DOMSubtreeModified', actualTarget, options);
        }
      } else if (type === "attributes" && is_contained) {
        // Attribute changes only fire DOMSubtreeModified, and only if the attribute
        // is being added or removed, and not just changed.
        options.attributeName = mutation.attributeName;
        options.prevValue = mutation.oldValue;
        options.newValue = target.getAttribute(mutation.attributeName);
        if (options.prevValue === null || options.newValue === null) {
          dispatchMutationEvent('DOMSubtreeModified', target, options);
        }
      } else if (type === "characterData" && is_contained) {
        options.prevValue = mutation.oldValue;
        options.newValue = target.textContent;
        dispatchMutationEvent('DOMCharacterDataModified', target, options);
        if (actualTarget !== target) {
          dispatchMutationEvent('DOMSubtreeModified', target, options);
        }
      }
    });
  }

  const observedTargetsToObservers = new Map();
  const observerOptions = {subtree: true, childList: true, attributes: true, attributeOldValue: true, characterData: true, characterDataOldValue: true};

  // Create a function to start observing mutations
  function enableMutationEventPolyfill(target) {
    if (observedTargetsToObservers.has(target)) {
      observedTargetsToObservers.get(target).count++;
      return;
    }
    const observer = new MutationObserver(handleMutations.bind(null,target));
    observedTargetsToObservers.set(target, {observer,count: 1});
    observer.observe(target.parentNode || target, observerOptions);
  }

  // Create a function to stop observing mutations
  function disableMutationEventPolyfill(target) {
    if (!observedTargetsToObservers.has(target))
      return;
    if (--observedTargetsToObservers.get(target).count === 0) {
      const observer = observedTargetsToObservers.get(target).observer;
      observedTargetsToObservers.delete(target);
      observer.disconnect();
    }
  }

  // Monkeypatch addEventListener/removeEventListener
  const originalAddEventListener = Element.prototype.addEventListener;
  Element.prototype.addEventListener = function(eventName, listener, options) {
    console.log(`addEventListener for ${eventName}`);
    if (mutationEvents.includes(eventName)) {
      console.log(`Polyfilled ${eventName} listener on ${this}!`);
      enableMutationEventPolyfill(this);
    }
    originalAddEventListener.apply(this, arguments);
  };
  const originalRemoveEventListener = window.removeEventListener;
  window.removeEventListener = function(eventName, listener, options) {
    if (mutationEvents.includes(eventName)) {
      disableMutationEventPolyfill(target);
    }
    originalRemoveEventListener.apply(window, arguments);
  };

  // This removes the observers without requiring a call to removeEventListener,
  // to make sure no more events are fired.
  window.disableMutationEventPolyfillForTesting = (target) => {
    while (observedTargetsToObservers.has(target)) {
      disableMutationEventPolyfill(target);
    }
  }

  console.log('Installed Mutation Events polyfill');
})();
