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
// There are also necessary differences between the behavior of Mutation Events
// and this polyfill using Mutation Observer. Primarily, the difference is in
// the timing: Mutation Events are synchronous, and happen *during* the
// mutation, while Mutation Observers are fired at microtask timing. One place
// where this leads to observable differences is during the DOMNodeRemoved
// event. Real DOMNodeRemoved events are fired before the node is removed from
// its parent, while this polyfill fires those after the removal is complete.
// That leads to the event needing to be fired two places - on the removed
// node and *also* on the observed target, because ordinarily the event bubbles
// from the former to the latter.

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

  const mutationEvents = new Set([
    'DOMCharacterDataModified',
    'DOMNodeInserted',
    'DOMNodeInsertedIntoDocument',
    'DOMNodeRemoved',
    'DOMNodeRemovedFromDocument',
    'DOMSubtreeModified',
  ]);

  const baseEventObj = {
    attrChange: 0, bubbles: true, cancelable: false, newValue: '', prevValue: '', relatedNode: null
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
      //console.log(mutation);
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
        dispatchMutationEvent('DOMCharacterDataModified', target, {prevValue: mutation.oldValue,newValue: target.textContent});
        if (actualTarget !== target) {
          dispatchMutationEvent('DOMSubtreeModified', target);
        }
      }
    });
  }

  const observedTargetsToObservers = new Map();
  const observerOptions = {subtree: true, childList: true, attributes: true, attributeOldValue: true, characterData: true, characterDataOldValue: true};

  function enableMutationEventPolyfill(target) {
    if (observedTargetsToObservers.has(target)) {
      observedTargetsToObservers.get(target).count++;
      return;
    }
    const observer = new MutationObserver(handleMutations.bind(null,target));
    observedTargetsToObservers.set(target, {observer,count: 1});
    observer.observe(target.parentNode || target, observerOptions);
  }

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
    if (mutationEvents.has(eventName)) {
      enableMutationEventPolyfill(this);
    }
    originalAddEventListener.apply(this, arguments);
  };
  const originalRemoveEventListener = window.removeEventListener;
  window.removeEventListener = function(eventName, listener, options) {
    if (mutationEvents.has(eventName)) {
      disableMutationEventPolyfill(target);
    }
    originalRemoveEventListener.apply(window, arguments);
  };

  // This removes the observers without requiring a call to removeEventListener,
  // to make sure no more events are fired. This should be used only for testing.
  window.disableMutationEventPolyfillForTesting = (target) => {
    while (observedTargetsToObservers.has(target)) {
      disableMutationEventPolyfill(target);
    }
  }

  console.log('Mutation Events polyfill installed.');
})();
