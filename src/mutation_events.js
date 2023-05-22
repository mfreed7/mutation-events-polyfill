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

  const baseEventObj = {
    attrChange: 0, bubbles: true, cancelable: false, eventPhase: 2, newValue: '', prevValue: '', relatedNode: null
  }
  function dispatchMutationEvent(type, target, options, fakeTarget) {
    let newEvent = Object.assign({}, baseEventObj);
    if (options) {
      newEvent = Object.assign(newEvent, options);
    }
    const event = new Event(type,newEvent);
    event.attrChange = newEvent.attrChange;
    event.newValue = newEvent.newValue;
    event.prevValue = newEvent.prevValue;
    event.relatedNode = newEvent.relatedNode;
    if (fakeTarget) {
      Object.defineProperty(event, 'target', {writable: false, value: fakeTarget});
    }
    target.dispatchEvent(event);
  }

  function handleMutations(actualTarget, mutations) {
    mutations.forEach(function (mutation) {
      const target = mutation.target;
      const type = mutation.type;

      // Set options based on mutation type
      console.log(mutation);
      const is_contained = actualTarget === target || actualTarget.contains(target);

      if (type === "childList") {
        let firedRemoved = false;
        mutation.removedNodes.forEach(n => {
          if (n === actualTarget || target === actualTarget) {
            firedRemoved = true;
            dispatchMutationEvent('DOMNodeRemoved', n);
            if (target === actualTarget) {
              // The actual DOMNodeRemoved event is fired *before* the node is
              // removed, which means it bubbles up to old parents. However,
              // Mutation Observer fires after the fact. So we need to fire a
              // DOMNodeRemoved on the disconnected node, *plus* fire a fake
              // one at actualTarget with a "fake" target of the removed node.
              dispatchMutationEvent('DOMNodeRemoved', actualTarget, undefined, n);
            }
            // This should be conditional on being in the document before!
            if (n === actualTarget && !actualTarget.isConnected) {
              dispatchMutationEvent('DOMNodeRemovedFromDocument', actualTarget, {bubbles: false});
            }
          }
        });
        if (firedRemoved && actualTarget===target) {
          dispatchMutationEvent('DOMSubtreeModified', actualTarget, {relatedNode: target});
        }
        let firedInserted = false;
        mutation.addedNodes.forEach(n => {
          if (n === actualTarget || target === actualTarget) {
            firedInserted = true;
            dispatchMutationEvent('DOMNodeInserted', n);
            // This should be conditional on not being in the document before!
            if (n === actualTarget && actualTarget.isConnected) {
              dispatchMutationEvent('DOMNodeInsertedIntoDocument', actualTarget, {bubbles: false});
            }
          }
        });
        if (firedInserted && actualTarget===target) {
          dispatchMutationEvent('DOMSubtreeModified', actualTarget, {relatedNode: target});
        }
      } else if (type === "attributes" && is_contained) {
        // Attribute changes only fire DOMSubtreeModified, and only if the attribute
        // is being added or removed, and not just changed.
        if (mutation.oldValue === null || target.getAttribute(mutation.attributeName) === null) {
          dispatchMutationEvent('DOMSubtreeModified', target, {attributeName: mutation.attributeName});
        }
      } else if (type === "characterData" && is_contained) {
        const options = {
          prevValue: mutation.oldValue,
          newValue: target.textContent,
        };
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
    if (mutationEvents.includes(eventName)) {
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
