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

  function handleMutations(listeningElement, mutations) {
    mutations.forEach(function (mutation) {
      const target = mutation.target;
      const type = mutation.type;
      console.log(listeningElement,target,mutation);
      const is_contained = listeningElement === target || listeningElement.contains(target);
      if (type === "childList") {
        let fireSubtreeModified = false;
        mutation.removedNodes.forEach(n => {
          fireSubtreeModified = fireSubtreeModified || n === listeningElement || target === listeningElement;
          if (target === listeningElement) {
            dispatchMutationEvent('DOMNodeRemoved', n);
            // The actual DOMNodeRemoved event is fired *before* the node is
            // removed, which means it bubbles up to old parents. However,
            // Mutation Observer fires after the fact. So we need to fire the
            // regular DOMNodeRemoved event on the target, but then fire
            // another "fake" DOMNodeRemoved event on the target.
            dispatchMutationEvent('DOMNodeRemoved', listeningElement, undefined, n);
            // This should be conditional on being in the document before!
            if (!n.isConnected) {
              dispatchMutationEvent('DOMNodeRemovedFromDocument', listeningElement, {bubbles: false});
            }
          }
        });
        if (fireSubtreeModified && listeningElement===target) {
          dispatchMutationEvent('DOMSubtreeModified', listeningElement, {relatedNode: target});
        }
        let firedInserted = false;
        mutation.addedNodes.forEach(n => {
          if (n === listeningElement || target === listeningElement) {
            firedInserted = true;
            dispatchMutationEvent('DOMNodeInserted', n);
            // This should be conditional on not being in the document before!
            if (n === listeningElement && listeningElement.isConnected) {
              dispatchMutationEvent('DOMNodeInsertedIntoDocument', listeningElement, {bubbles: false});
            }
          }
        });
        if (firedInserted && listeningElement===target) {
          dispatchMutationEvent('DOMSubtreeModified', listeningElement, {relatedNode: target});
        }
      } else if (type === "attributes" && is_contained) {
        // Attribute changes only fire DOMSubtreeModified, and only if the attribute
        // is being added or removed, and not just changed.
        if (mutation.oldValue === null || target.getAttribute(mutation.attributeName) === null) {
          dispatchMutationEvent('DOMSubtreeModified', target, {attributeName: mutation.attributeName});
        }
      } else if (type === "characterData" && is_contained) {
        dispatchMutationEvent('DOMCharacterDataModified', target, {prevValue: mutation.oldValue,newValue: target.textContent});
        if (listeningElement !== target) {
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
  function getAugmentedListener(eventName, listener, options) {
    if (mutationEvents.has(eventName)) {
      return {fullEventName: eventName + polyfillEventNameExtension,
        augmentedListener: (event) => {
        // Remove polyfillEventNameExtension and Capturing/Bubbling:
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
